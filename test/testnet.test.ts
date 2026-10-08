import test from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { Database } from "../src/database";
import { migrate } from "../src/migrate";
import {
  baseUnits,
  canonical,
  signedTransaction,
  Stellar,
  TESTNET,
} from "../src/stellar";

test("wallet signature validation binds body, network and signer", () => {
  const alice = S.Keypair.random(),
    bob = S.Keypair.random();
  const tx = new S.TransactionBuilder(new S.Account(alice.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: TESTNET,
  })
    .addOperation(S.Operation.manageData({ name: "proof", value: "nonce" }))
    .setTimeout(60)
    .build();
  const unsigned = tx.toXDR();
  tx.sign(alice);
  assert.equal(
    signedTransaction(unsigned, tx.toXDR(), alice.publicKey()).source,
    alice.publicKey(),
  );
  assert.throws(() => signedTransaction(unsigned, tx.toXDR(), bob.publicKey()));
  const wrongNetwork = S.TransactionBuilder.fromXDR(
    unsigned,
    S.Networks.PUBLIC,
  );
  wrongNetwork.sign(alice);
  assert.throws(() =>
    signedTransaction(unsigned, wrongNetwork.toXDR(), alice.publicKey()),
  );
  const different = new S.TransactionBuilder(
    new S.Account(alice.publicKey(), "1"),
    { fee: "100", networkPassphrase: TESTNET },
  )
    .addOperation(S.Operation.manageData({ name: "proof", value: "changed" }))
    .setTimeout(60)
    .build();
  different.sign(alice);
  assert.throws(() =>
    signedTransaction(unsigned, different.toXDR(), alice.publicKey()),
  );
  assert.equal(baseUnits("225.50"), "2255000000");
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
});

test("testnet API permissions, signature proof and unknown-outcome protection (mock RPC)", async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Isolated test database required");
  process.env.STELLAR_TESTNET_ENABLED = "true";
  process.env.STELLAR_ESCROW_WASM_HASH = "1".repeat(64);
  process.env.STELLAR_TEST_TOKEN_WASM_HASH = "2".repeat(64);
  process.env.STELLAR_TEST_TOKEN_CONTRACT = S.StrKey.encodeContract(
    Buffer.alloc(32, 3),
  );
  const app = await createApp();
  const db = app.get(Database);
  await migrate(db);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const stellar = app.get(Stellar);
  Object.assign(stellar.server, {
    getNetwork: async () => ({ passphrase: TESTNET }),
    getAccount: async (address: string) => new S.Account(address, "1"),
    prepareTransaction: async (tx: S.Transaction) => tx,
    getLatestLedger: async () => ({ sequence: 123 }),
    sendTransaction: async () => {
      throw new Error("simulated connection loss");
    },
    getTransaction: async () => ({
      status: "NOT_FOUND",
      latestLedgerCloseTime: Math.floor(Date.now() / 1000),
      oldestLedger: 100,
    }),
  });
  const users: string[] = [];
  let project = "";
  async function request(
    path: string,
    method: string,
    body: unknown,
    cookie = "",
  ) {
    const result = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: process.env.FRONTEND_ORIGIN!,
        "x-accordbridge-request": "1",
        cookie,
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    return {
      status: result.status,
      body: await result.json(),
      cookie: result.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const alice = S.Keypair.random(),
    bob = S.Keypair.random();
  try {
    const a = await request("/auth/register", "POST", {
      name: "Test client",
      email: `${randomUUID()}@example.test`,
      password: "testnet-api-test-password",
    });
    users.push(a.body.user.id);
    const b = await request("/auth/register", "POST", {
      name: "Test freelancer",
      email: `${randomUUID()}@example.test`,
      password: "testnet-api-test-password",
    });
    users.push(b.body.user.id);
    for (const [account, key] of [
      [a, alice],
      [b, bob],
    ] as const) {
      const challenge = await request(
        "/testnet/wallet/challenge",
        "POST",
        { address: key.publicKey() },
        account.cookie,
      );
      assert.equal(challenge.status, 201);
      const unsigned = challenge.body.xdr;
      const wrong = S.TransactionBuilder.fromXDR(unsigned, TESTNET);
      wrong.sign(S.Keypair.random());
      assert.equal(
        (
          await request(
            "/testnet/wallet/verify",
            "POST",
            { id: challenge.body.id, signedXdr: wrong.toXDR() },
            account.cookie,
          )
        ).status,
        400,
      );
      const signed = S.TransactionBuilder.fromXDR(unsigned, TESTNET);
      signed.sign(key);
      assert.equal(
        (
          await request(
            "/testnet/wallet/verify",
            "POST",
            { id: challenge.body.id, signedXdr: signed.toXDR() },
            account.cookie,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/testnet/wallet/verify",
            "POST",
            { id: challenge.body.id, signedXdr: signed.toXDR() },
            account.cookie,
          )
        ).status,
        400,
      );
    }
    const agreement = {
      title: "Testnet integration",
      description: "Synthetic milestone",
      exclusions: "No live funds",
      revisions: 2,
      reviewDays: 7,
      milestones: [
        {
          name: "Design",
          amount: "150",
          scope: "Page layout",
          criteria: "Responsive design",
          dueDate: "2026-12-01",
        },
      ],
    };
    const created = await request(
      "/projects",
      "POST",
      { counterpartyId: users[1], role: "client", agreement },
      a.cookie,
    );
    project = created.body.id;
    await request(
      `/projects/${project}/publish`,
      "POST",
      { expectedVersion: 0, expectedRevision: 1 },
      a.cookie,
    );
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/prepare`,
          "POST",
          { action: "deploy", version: 1 },
          a.cookie,
        )
      ).status,
      409,
    );
    for (const user of [a, b])
      await request(
        `/projects/${project}/accept`,
        "POST",
        { version: 1 },
        user.cookie,
      );
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/prepare`,
          "POST",
          { action: "deploy", version: 1 },
          b.cookie,
        )
      ).status,
      403,
    );
    const prepared = await request(
      `/testnet/projects/${project}/prepare`,
      "POST",
      { action: "deploy", version: 1 },
      a.cookie,
    );
    assert.equal(prepared.status, 201);
    const retry = await request(
      `/testnet/projects/${project}/prepare`,
      "POST",
      { action: "deploy", version: 1 },
      a.cookie,
    );
    assert.equal(retry.body.id, prepared.body.id);
    const locked = await request(
      `/projects/${project}/draft`,
      "PUT",
      { agreement, expectedVersion: 1, expectedRevision: 0 },
      a.cookie,
    );
    assert.equal(locked.status, 409);
    const signed = S.TransactionBuilder.fromXDR(prepared.body.xdr, TESTNET);
    signed.sign(alice);
    const outcome = await request(
      `/testnet/projects/${project}/submit`,
      "POST",
      { intentId: prepared.body.id, signedXdr: signed.toXDR() },
      a.cookie,
    );
    assert.equal(outcome.body.state, "unknown");
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/prepare`,
          "POST",
          { action: "deploy", version: 1 },
          a.cookie,
        )
      ).status,
      409,
    );
    await request(`/testnet/projects/${project}/check`, "POST", {}, a.cookie);
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}`,
          "GET",
          undefined,
          a.cookie,
        )
      ).body.intents[0].state,
      "submitted",
    );
    Object.assign(stellar.server, {
      getTransaction: async () => ({
        status: "NOT_FOUND",
        latestLedgerCloseTime: prepared.body.expiresAt + 1,
        oldestLedger: 100,
      }),
    });
    await request(`/testnet/projects/${project}/check`, "POST", {}, a.cookie);
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}`,
          "GET",
          undefined,
          a.cookie,
        )
      ).body.intents[0].state,
      "expired",
    );
    const frozen = (
      await db.pool.query("SELECT * FROM testnet_escrows WHERE project_id=$1", [
        project,
      ])
    ).rows[0];
    await db.pool.query(
      "UPDATE testnet_escrows SET contract_id=$2 WHERE project_id=$1",
      [project, process.env.STELLAR_TEST_TOKEN_CONTRACT],
    );
    let balanceLedger = 201;
    Object.assign(stellar, {
      wasm: async () => {},
      read: async (_contract: string, method: string) =>
        method === "state"
          ? {
              ledger: 200,
              value: {
                client: frozen.client_address,
                freelancer: frozen.freelancer_address,
                token: frozen.token_contract,
                amount: BigInt(frozen.amount_base_units),
                terms: Buffer.from(frozen.terms_hash, "hex"),
                status: 1,
                client_accepted: true,
                freelancer_accepted: true,
                client_refund: false,
                freelancer_refund: false,
              },
            }
          : { ledger: balanceLedger, value: BigInt(frozen.amount_base_units) },
    });
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/check`,
          "POST",
          {},
          a.cookie,
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}`,
          "GET",
          undefined,
          a.cookie,
        )
      ).body.escrow.state,
      null,
    );
    balanceLedger = 200;
    const consistent = await request(
      `/testnet/projects/${project}/check`,
      "POST",
      {},
      a.cookie,
    );
    assert.equal(consistent.status, 201);
    assert.equal(consistent.body.escrow.state.status, 1);
    assert.equal(consistent.body.escrow.state.ledger, 200);
    const workPath = `/projects/${project}/work`;
    const delivery = {
      version: 1,
      expectedLatestId: null as string | null,
      notes: "First delivery",
      links: ["https://example.test/design"],
    };
    assert.equal((await request(workPath, "GET", undefined)).status, 401);
    const outsider = await request("/auth/register", "POST", {
      name: "Outsider",
      email: `${randomUUID()}@example.test`,
      password: "testnet-api-test-password",
    });
    users.push(outsider.body.user.id);
    assert.equal(
      (await request(workPath, "GET", undefined, outsider.cookie)).status,
      404,
    );
    assert.equal(
      (await request(workPath + "/submissions", "POST", delivery, a.cookie))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          workPath + "/submissions",
          "POST",
          { ...delivery, links: ["javascript:alert(1)"] },
          b.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/prepare`,
          "POST",
          { action: "release", version: 1 },
          a.cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          workPath + "/submissions",
          "POST",
          { ...delivery, links: ["not-a-url"] },
          b.cookie,
        )
      ).status,
      400,
    );
    await db.pool.query(
      "UPDATE testnet_escrows SET checked_at=now()-interval '6 minutes' WHERE project_id=$1",
      [project],
    );
    assert.equal(
      (await request(workPath + "/submissions", "POST", delivery, b.cookie))
        .status,
      409,
    );
    await request(`/testnet/projects/${project}/check`, "POST", {}, a.cookie);
    const concurrent = await Promise.all([
      request(workPath + "/submissions", "POST", delivery, b.cookie),
      request(workPath + "/submissions", "POST", delivery, b.cookie),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    let history = (await request(workPath, "GET", undefined, a.cookie)).body
      .submissions;
    assert.equal(history.length, 1);
    assert.equal(
      Date.parse(history[0].reviewDueAt) - Date.parse(history[0].submittedAt),
      7 * 86400000,
    );
    const first = history[0].id;
    const revise = {
      submissionId: first,
      decision: "revision_requested",
      feedback: "Fix the agreed mobile layout",
    };
    assert.equal(
      (await request(workPath + "/reviews", "POST", revise, b.cookie)).status,
      403,
    );
    assert.equal(
      (
        await request(
          workPath + "/reviews",
          "POST",
          { ...revise, feedback: " " },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await request(workPath + "/reviews", "POST", revise, a.cookie)).status,
      201,
    );
    assert.equal(
      (await request(workPath + "/reviews", "POST", revise, a.cookie)).status,
      201,
    );
    const second = (
      await request(
        workPath + "/submissions",
        "POST",
        {
          ...delivery,
          expectedLatestId: first,
          notes: "Revised mobile layout",
        },
        b.cookie,
      )
    ).body.id;
    assert.equal(
      (
        await request(
          workPath + "/reviews",
          "POST",
          { ...revise, decision: "approved" },
          a.cookie,
        )
      ).status,
      409,
    );
    await request(
      workPath + "/reviews",
      "POST",
      { ...revise, submissionId: second },
      a.cookie,
    );
    const third = (
      await request(
        workPath + "/submissions",
        "POST",
        { ...delivery, expectedLatestId: second, notes: "Final delivery" },
        b.cookie,
      )
    ).body.id;
    assert.equal(
      (
        await request(
          workPath + "/reviews",
          "POST",
          { ...revise, submissionId: third },
          a.cookie,
        )
      ).status,
      409,
    );
    const approval = {
      submissionId: third,
      decision: "approved",
      feedback: "Meets the criteria",
    };
    assert.equal(
      (await request(workPath + "/reviews", "POST", approval, a.cookie)).status,
      201,
    );
    assert.equal(
      (
        await request(
          workPath + "/reviews",
          "POST",
          { ...approval, feedback: "Overwrite" },
          a.cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          workPath + "/submissions",
          "POST",
          { ...delivery, expectedLatestId: third },
          b.cookie,
        )
      ).status,
      409,
    );
    history = (await request(workPath, "GET", undefined, b.cookie)).body
      .submissions;
    assert.deepEqual(
      history.map((item: { sequence: number }) => item.sequence),
      [3, 2, 1],
    );
    assert.equal(history[2].notes, "First delivery");
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}`,
          "GET",
          undefined,
          a.cookie,
        )
      ).body.approvedSubmissionId,
      third,
    );
    assert.equal(
      (
        await request(
          `/testnet/projects/${project}/prepare`,
          "POST",
          { action: "release", version: 1 },
          a.cookie,
        )
      ).status,
      201,
    );
  } finally {
    if (project)
      await db.pool.query("DELETE FROM projects WHERE id=$1", [project]);
    if (users.length)
      await db.pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    await app.close();
  }
});
