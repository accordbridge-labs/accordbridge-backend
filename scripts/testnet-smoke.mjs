import * as S from "@stellar/stellar-sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createApp } from "../dist/src/app.js";
import { Database } from "../dist/src/database.js";
import { migrate } from "../dist/src/migrate.js";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("A separate test database is required");
const manifest = JSON.parse(
  readFileSync("../accordbridge-contracts/deployments/testnet.json", "utf8"),
);
if (manifest.networkPassphrase !== S.Networks.TESTNET)
  throw new Error("Only Stellar testnet is supported");
process.env.STELLAR_TESTNET_ENABLED = "true";
process.env.STELLAR_ESCROW_WASM_HASH = manifest.escrowWasmHash;
process.env.STELLAR_TEST_TOKEN_CONTRACT = manifest.tokenContract;
process.env.STELLAR_TEST_TOKEN_WASM_HASH = manifest.tokenWasmHash;
// These are generated test fixtures, never a user's wallet or a backend signing key.
const fixture = JSON.parse(
  readFileSync(
    "../accordbridge-contracts/.local/testnet-fixtures.json",
    "utf8",
  ),
);
const clientKey = S.Keypair.fromSecret(fixture.client),
  freelancerKey = S.Keypair.fromSecret(fixture.freelancer);
const app = await createApp();
const db = app.get(Database);
await migrate(db);
await app.listen(0, "127.0.0.1");
const base = await app.getUrl();
const users = [];
let projectId;
let success = false;
async function request(path, body, cookie = "", method = "POST") {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      origin: process.env.FRONTEND_ORIGIN,
      "x-accordbridge-request": "1",
      "content-type": "application/json",
      cookie,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(`API ${path} returned ${response.status}: ${data.message}`),
      { status: response.status },
    );
  return {
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function account(name, key) {
  const result = await request("/auth/register", {
    name,
    email: `${randomUUID()}@example.test`,
    password: "generated-fixture-testnet-only-password",
  });
  users.push(result.data.user.id);
  const challenge = await request(
    "/testnet/wallet/challenge",
    { address: key.publicKey() },
    result.cookie,
  );
  const proof = S.TransactionBuilder.fromXDR(
    challenge.data.xdr,
    S.Networks.TESTNET,
  );
  proof.sign(key);
  await request(
    "/testnet/wallet/verify",
    { id: challenge.data.id, signedXdr: proof.toXDR() },
    result.cookie,
  );
  return { ...result.data.user, cookie: result.cookie, key };
}
const records = [];
async function action(actor, actionName) {
  const prepared = (
    await request(
      `/testnet/projects/${projectId}/prepare`,
      { action: actionName, version: 1 },
      actor.cookie,
    )
  ).data;
  const transaction = S.TransactionBuilder.fromXDR(
    prepared.xdr,
    S.Networks.TESTNET,
  );
  transaction.sign(actor.key);
  await request(
    `/testnet/projects/${projectId}/submit`,
    { intentId: prepared.id, signedXdr: transaction.toXDR() },
    actor.cookie,
  );
  console.log(`API submitted ${actionName}: ${prepared.hash}`);
  for (let count = 0; count < 35; count++) {
    let status;
    try {
      status = (
        await request(`/testnet/projects/${projectId}/check`, {}, actor.cookie)
      ).data;
    } catch (error) {
      if (error.status !== 503) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue; // Retry only reconciliation, never signing or submission.
    }
    const intent = status.intents.find((item) => item.id === prepared.id);
    if (intent.state === "confirmed") {
      records.push({ action: actionName, hash: prepared.hash });
      return status;
    }
    if (["failed", "expired"].includes(intent.state))
      throw new Error(`Transaction ${prepared.hash} ${intent.state}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Unknown outcome: ${prepared.hash}. Reconcile before retrying.`,
  );
}
try {
  const client = await account("Testnet client", clientKey);
  const freelancer = await account("Testnet freelancer", freelancerKey);
  const agreement = {
    title: "Real testnet API smoke",
    description: "Synthetic integration check",
    exclusions: "Real money",
    revisions: 2,
    reviewDays: 7,
    milestones: [
      {
        name: "Test design",
        amount: "150",
        scope: "Testnet funds only",
        criteria: "Funding reconciles",
        dueDate: "2026-12-01",
      },
    ],
  };
  projectId = (
    await request(
      "/projects",
      { counterpartyId: freelancer.id, role: "client", agreement },
      client.cookie,
    )
  ).data.id;
  await request(
    `/projects/${projectId}/publish`,
    { expectedVersion: 0, expectedRevision: 1 },
    client.cookie,
  );
  for (const actor of [client, freelancer])
    await request(
      `/projects/${projectId}/accept`,
      { version: 1 },
      actor.cookie,
    );
  await action(client, "deploy");
  await action(client, "faucet");
  await action(client, "accept");
  await action(freelancer, "accept");
  const funded = await action(client, "fund");
  if (
    funded.escrow.state.status !== 1 ||
    funded.escrow.state.balanceBaseUnits !== "1500000000"
  )
    throw new Error("Confirmed funding did not reconcile");
  const reviewFlow = process.argv.includes("--review-release");
  let completed;
  if (reviewFlow) {
    const submit = async (expectedLatestId, notes) =>
      (
        await request(
          `/projects/${projectId}/work/submissions`,
          {
            version: 1,
            expectedLatestId,
            notes,
            links: ["https://example.test/synthetic-delivery"],
          },
          freelancer.cookie,
        )
      ).data.id;
    const first = await submit(null, "Synthetic first delivery");
    await request(
      `/projects/${projectId}/work/reviews`,
      {
        submissionId: first,
        decision: "revision_requested",
        feedback: "Correct the agreed spacing",
      },
      client.cookie,
    );
    const revised = await submit(first, "Synthetic revised delivery");
    await request(
      `/projects/${projectId}/work/reviews`,
      {
        submissionId: revised,
        decision: "approved",
        feedback: "Meets the agreed criteria",
      },
      client.cookie,
    );
    completed = await action(client, "release");
    if (
      completed.escrow.state.status !== 2 ||
      completed.escrow.state.balanceBaseUnits !== "0"
    )
      throw new Error("Approved work release did not reconcile");
  } else {
    const partialRefund = await action(client, "refund");
    if (partialRefund.escrow.state.status !== 1)
      throw new Error("One participant refunded unilaterally");
    const refunded = await action(freelancer, "refund");
    if (
      refunded.escrow.state.status !== 3 ||
      refunded.escrow.state.balanceBaseUnits !== "0"
    )
      throw new Error("Mutual refund did not reconcile");
    completed = refunded;
  }
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(
    reviewFlow
      ? "docs/evidence/testnet-work-review.json"
      : "docs/evidence/testnet-api.json",
    JSON.stringify(
      {
        network: "testnet",
        escrow: completed.escrow.contractId,
        escrowWasmHash: manifest.escrowWasmHash,
        tokenContract: manifest.tokenContract,
        amountBaseUnits: "1500000000",
        finalStatus: reviewFlow ? "released" : "refunded",
        ...(reviewFlow
          ? { submissionRevisionAndApprovalRecorded: true }
          : { onePartyRefundDidNotMoveTokens: true }),
        transactions: records,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  success = true;
  console.log("Real-signature API flow completed and reconciled on testnet.");
} finally {
  if (success) {
    if (projectId)
      await db.pool.query("DELETE FROM projects WHERE id=$1", [projectId]);
    if (users.length)
      await db.pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
  } else
    console.error(
      "Failed test fixtures retained in the test database for investigation.",
    );
  await app.close();
}
