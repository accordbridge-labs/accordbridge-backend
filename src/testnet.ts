import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import * as S from "@stellar/stellar-sdk";
import { z } from "zod";
import { approvedWork } from "./work";
import { Database } from "./database";
import { AuthRequest, SessionGuard } from "./auth";
import { parse } from "./schemas";
import {
  addressValue,
  baseUnits,
  bytesValue,
  canonical,
  integerValue,
  sha256,
  signedTransaction,
  Stellar,
  TESTNET,
} from "./stellar";

const addressSchema = z
  .string()
  .refine(
    (value) => S.StrKey.isValidEd25519PublicKey(value),
    "Use a Stellar G-address",
  );
const actionSchema = z.enum([
  "deploy",
  "accept",
  "faucet",
  "fund",
  "release",
  "refund",
]);

@Controller("testnet")
@UseGuards(SessionGuard)
export class TestnetController {
  constructor(
    private readonly db: Database,
    private readonly stellar: Stellar,
  ) {}
  @Get("wallet") async wallet(@Req() req: AuthRequest) {
    const result = await this.db.pool.query(
      "SELECT address FROM testnet_wallets WHERE user_id=$1",
      [req.user.id],
    );
    let enabled = false;
    try {
      this.stellar.config;
      enabled = true;
    } catch {}
    return {
      address: result.rows[0]?.address ?? null,
      networkPassphrase: TESTNET,
      enabled,
    };
  }
  @Post("wallet/challenge") async challenge(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.stellar.config;
    const { address } = parse(
      z.object({ address: addressSchema }).strict(),
      body,
    );
    const existing = await this.db.pool.query(
      "SELECT address FROM testnet_wallets WHERE user_id=$1",
      [req.user.id],
    );
    if (existing.rows.length)
      throw new ConflictException(
        "This account already has a verified testnet wallet.",
      );
    const id = randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    // Sequence zero and zero fee: a proof-of-control challenge, never broadcast.
    const xdr = new S.TransactionBuilder(new S.Account(address, "-1"), {
      fee: "0",
      networkPassphrase: TESTNET,
    })
      .addOperation(
        S.Operation.manageData({
          name: "accordbridge.testnet.wallet-proof",
          value: randomBytes(32),
        }),
      )
      .setTimebounds(0, expiresAt)
      .build()
      .toXDR();
    await this.db.pool.query(
      "INSERT INTO testnet_wallet_challenges(id,user_id,address,xdr,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5))",
      [id, req.user.id, address, xdr, expiresAt],
    );
    return { id, xdr, networkPassphrase: TESTNET };
  }
  @Post("wallet/verify") async verify(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(
      z
        .object({ id: z.string().uuid(), signedXdr: z.string().max(20000) })
        .strict(),
      body,
    );
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT * FROM testnet_wallet_challenges WHERE id=$1 AND user_id=$2 AND expires_at>now() AND consumed=false FOR UPDATE",
          [data.id, req.user.id],
        )
      ).rows[0];
      if (!row)
        throw new BadRequestException(
          "Wallet challenge is missing, expired, or already used.",
        );
      signedTransaction(row.xdr, data.signedXdr, row.address);
      const existing = (
        await client.query(
          "SELECT user_id FROM testnet_wallets WHERE user_id=$1 OR address=$2",
          [req.user.id, row.address],
        )
      ).rows;
      if (existing.length)
        throw new ConflictException("The account or wallet is already linked.");
      const linked = await client.query(
        "INSERT INTO testnet_wallets(user_id,address) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",
        [req.user.id, row.address],
      );
      if (!linked.rowCount)
        throw new ConflictException("The account or wallet is already linked.");
      await client.query(
        "UPDATE testnet_wallet_challenges SET consumed=true WHERE id=$1",
        [data.id],
      );
      return { address: row.address };
    });
  }
  private async project(id: string, userId: string) {
    const project = (
      await this.db.pool.query(
        "SELECT * FROM projects WHERE id=$1 AND (client_id=$2 OR freelancer_id=$2)",
        [id, userId],
      )
    ).rows[0];
    if (!project) throw new NotFoundException("Project not found.");
    return project;
  }
  @Get("projects/:id") async status(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const project = await this.project(id, req.user.id);
    const escrow = (
      await this.db.pool.query(
        "SELECT * FROM testnet_escrows WHERE project_id=$1",
        [id],
      )
    ).rows[0];
    const wallets = (
      await this.db.pool.query(
        "SELECT user_id,address FROM testnet_wallets WHERE user_id=ANY($1::uuid[])",
        [[project.client_id, project.freelancer_id]],
      )
    ).rows;
    const intents = (
      await this.db.pool.query(
        'SELECT id,action,hash,state,user_id AS "userId",expires_at AS "expiresAt" FROM testnet_intents WHERE project_id=$1 ORDER BY created_at DESC',
        [id],
      )
    ).rows;
    return {
      network: "testnet",
      tokenSymbol: "ABUSD",
      tokenHasMonetaryValue: false,
      approvedSubmissionId: await approvedWork(this.db.pool, id),
      feePercent: 0,
      clientWallet:
        wallets.find((item) => item.user_id === project.client_id)?.address ??
        null,
      freelancerWallet:
        wallets.find((item) => item.user_id === project.freelancer_id)
          ?.address ?? null,
      escrow: escrow
        ? {
            contractId: escrow.contract_id,
            termsHash: escrow.terms_hash,
            amountBaseUnits: escrow.amount_base_units,
            tokenContract: escrow.token_contract,
            state: escrow.chain_state,
            checkedAt: escrow.checked_at,
          }
        : null,
      intents,
    };
  }
  @Post("projects/:id/prepare") async prepare(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(
      z
        .object({ action: actionSchema, version: z.number().int().positive() })
        .strict(),
      body,
    );
    const config = this.stellar.config;
    return this.db.transaction(async (client) => {
      const project = (
        await client.query(
          "SELECT * FROM projects WHERE id=$1 AND (client_id=$2 OR freelancer_id=$2) FOR UPDATE",
          [id, req.user.id],
        )
      ).rows[0];
      if (!project) throw new NotFoundException("Project not found.");
      if (project.current_version !== data.version)
        throw new ConflictException(
          "Agreement changed. Refresh before signing.",
        );
      const wallets = (
        await client.query(
          "SELECT user_id,address FROM testnet_wallets WHERE user_id=ANY($1::uuid[])",
          [[project.client_id, project.freelancer_id]],
        )
      ).rows;
      const clientAddress = wallets.find(
        (item) => item.user_id === project.client_id,
      )?.address;
      const freelancerAddress = wallets.find(
        (item) => item.user_id === project.freelancer_id,
      )?.address;
      const actor = wallets.find(
        (item) => item.user_id === req.user.id,
      )?.address;
      if (!actor || !clientAddress || !freelancerAddress)
        throw new ConflictException(
          "Both participants must verify a testnet wallet first.",
        );
      if (
        ["deploy", "fund", "release"].includes(data.action) &&
        req.user.id !== project.client_id
      )
        throw new ForbiddenException(
          "Only the client can perform this action.",
        );
      if (data.action === "release" && !(await approvedWork(client, id)))
        throw new ConflictException(
          "Approve the latest work submission before preparing release.",
        );
      const pending = (
        await client.query(
          "SELECT * FROM testnet_intents WHERE project_id=$1 AND state IN ('prepared','submitted')",
          [id],
        )
      ).rows[0];
      if (pending) {
        if (
          pending.user_id !== req.user.id ||
          pending.action !== data.action ||
          pending.state !== "prepared"
        )
          throw new ConflictException(
            "A transaction is pending. Check its result before requesting another.",
          );
        return {
          id: pending.id,
          xdr: pending.xdr,
          hash: pending.hash,
          address: actor,
          networkPassphrase: TESTNET,
          expiresAt: Number(pending.expires_at),
          fee: S.TransactionBuilder.fromXDR(pending.xdr, TESTNET).fee,
        };
      }
      let escrow = (
        await client.query(
          "SELECT * FROM testnet_escrows WHERE project_id=$1",
          [id],
        )
      ).rows[0];
      let operation: ReturnType<typeof S.Operation.invokeContractFunction>;
      if (data.action === "deploy") {
        if (escrow?.contract_id)
          throw new ConflictException("The escrow is already deployed.");
        const accepted = (
          await client.query(
            "SELECT count(*)::int AS count FROM acceptances WHERE project_id=$1 AND version=$2",
            [id, data.version],
          )
        ).rows[0].count;
        if (accepted !== 2)
          throw new ConflictException(
            "Both participants must accept the current agreement.",
          );
        const agreement = (
          await client.query(
            "SELECT agreement FROM agreement_versions WHERE project_id=$1 AND version=$2",
            [id, data.version],
          )
        ).rows[0].agreement;
        const amount = baseUnits(agreement.milestones[0].amount);
        const terms = sha256(
          canonical({
            projectId: id,
            version: data.version,
            milestone: 0,
            agreement,
            client: clientAddress,
            freelancer: freelancerAddress,
            network: TESTNET,
            token: config.token,
            amount,
            feePercent: 0,
          }),
        );
        if (!escrow) {
          await client.query(
            "INSERT INTO testnet_escrows(project_id,agreement_version,client_address,freelancer_address,token_contract,wasm_hash,amount_base_units,terms_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              id,
              data.version,
              clientAddress,
              freelancerAddress,
              config.token,
              config.wasmHash,
              amount,
              terms,
            ],
          );
          escrow = {
            client_address: clientAddress,
            freelancer_address: freelancerAddress,
            token_contract: config.token,
            wasm_hash: config.wasmHash,
            amount_base_units: amount,
            terms_hash: terms,
          };
        }
        operation = S.Operation.createCustomContract({
          address: S.Address.fromString(actor),
          wasmHash: Buffer.from(escrow.wasm_hash, "hex"),
          salt: randomBytes(32),
          constructorArgs: [
            addressValue(escrow.client_address),
            addressValue(escrow.freelancer_address),
            addressValue(escrow.token_contract),
            integerValue(escrow.amount_base_units),
            bytesValue(escrow.terms_hash),
          ],
        });
      } else {
        if (!escrow?.contract_id)
          throw new ConflictException("Deploy and confirm the escrow first.");
        await this.stellar.wasm(escrow.contract_id, escrow.wasm_hash);
        await this.stellar.wasm(escrow.token_contract, config.tokenWasmHash);
        const contract = new S.Contract(
          data.action === "faucet" ? escrow.token_contract : escrow.contract_id,
        );
        operation =
          data.action === "accept"
            ? contract.call(
                "accept",
                addressValue(actor),
                bytesValue(escrow.terms_hash),
              )
            : data.action === "refund"
              ? contract.call("request_refund", addressValue(actor))
              : data.action === "faucet"
                ? contract.call("faucet", addressValue(actor))
                : contract.call(data.action);
      }
      let prepared;
      try {
        prepared = await this.stellar.prepare(actor, operation);
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ServiceUnavailableException
        )
          throw error;
        throw new BadRequestException(
          "Testnet preparation failed. Check wallet funding, token balance, and escrow permissions.",
        );
      }
      const intentId = randomUUID();
      await client.query(
        "INSERT INTO testnet_intents(id,project_id,user_id,action,xdr,hash,expires_at,min_ledger) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          intentId,
          id,
          req.user.id,
          data.action,
          prepared.xdr,
          prepared.hash,
          prepared.expiresAt,
          prepared.minLedger,
        ],
      );
      // Locks the snapshot before any transaction is handed to a wallet; not proof of funding.
      await client.query(
        "UPDATE projects SET funding_started=true WHERE id=$1",
        [id],
      );
      return {
        id: intentId,
        ...prepared,
        address: actor,
        networkPassphrase: TESTNET,
      };
    });
  }
  @Post("projects/:id/submit") async submit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    await this.project(id, req.user.id);
    this.stellar.config;
    const data = parse(
      z
        .object({
          intentId: z.string().uuid(),
          signedXdr: z.string().max(60000),
        })
        .strict(),
      body,
    );
    const intent = (
      await this.db.pool.query(
        "SELECT i.*,w.address FROM testnet_intents i JOIN testnet_wallets w ON w.user_id=i.user_id WHERE i.id=$1 AND i.project_id=$2 AND i.user_id=$3",
        [data.intentId, id, req.user.id],
      )
    ).rows[0];
    if (!intent || !["prepared", "submitted"].includes(intent.state))
      throw new ConflictException(
        "Transaction intent is missing or already resolved.",
      );
    if (intent.action === "release" && !(await approvedWork(this.db.pool, id)))
      throw new ConflictException(
        "Approve the latest work submission before submitting release.",
      );
    const tx = signedTransaction(intent.xdr, data.signedXdr, intent.address);
    // Save the hash/state BEFORE contacting RPC. Network failure remains reconcilable.
    await this.db.pool.query(
      "UPDATE testnet_intents SET state='submitted' WHERE id=$1 AND state='prepared'",
      [intent.id],
    );
    try {
      await this.stellar.network();
      await this.stellar.server.sendTransaction(tx);
    } catch {
      return {
        hash: intent.hash,
        state: "unknown",
        message:
          "Submission outcome unknown. Check this transaction; do not create another payment.",
      };
    }
    return { hash: intent.hash, state: "submitted" };
  }
  @Post("projects/:id/check") async check(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    await this.project(id, req.user.id);
    this.stellar.config;
    await this.stellar.network();
    await this.db.transaction(async (client) => {
      await client.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const pending = (
        await client.query(
          "SELECT * FROM testnet_intents WHERE project_id=$1 AND state IN ('prepared','submitted')",
          [id],
        )
      ).rows[0];
      let confirmedLedger = 0;
      if (pending) {
        const result = await this.stellar.available(() =>
          this.stellar.server.getTransaction(pending.hash),
        );
        if (result.status === "SUCCESS") {
          confirmedLedger = result.ledger;
          if (pending.action === "deploy") {
            const contract = S.scValToNative(result.returnValue!);
            await client.query(
              "UPDATE testnet_escrows SET contract_id=$2 WHERE project_id=$1",
              [id, contract],
            );
          }
          await client.query(
            "UPDATE testnet_intents SET state='confirmed' WHERE id=$1",
            [pending.id],
          );
        } else if (result.status === "FAILED")
          await client.query(
            "UPDATE testnet_intents SET state='failed' WHERE id=$1",
            [pending.id],
          );
        else if (
          result.latestLedgerCloseTime > Number(pending.expires_at) &&
          result.oldestLedger <= Number(pending.min_ledger)
        )
          await client.query(
            "UPDATE testnet_intents SET state='expired' WHERE id=$1",
            [pending.id],
          );
      }
      const escrow = (
        await client.query(
          "SELECT * FROM testnet_escrows WHERE project_id=$1",
          [id],
        )
      ).rows[0];
      if (escrow?.contract_id) {
        await this.stellar.wasm(escrow.contract_id, escrow.wasm_hash);
        const stateRead = await this.stellar.read(
          escrow.contract_id,
          "state",
          escrow.client_address,
        );
        const state = stateRead.value;
        if (
          state.client !== escrow.client_address ||
          state.freelancer !== escrow.freelancer_address ||
          state.token !== escrow.token_contract ||
          state.amount.toString() !== escrow.amount_base_units ||
          Buffer.from(state.terms).toString("hex") !== escrow.terms_hash
        )
          throw new ServiceUnavailableException(
            "On-chain terms do not match the frozen agreement.",
          );
        await this.stellar.wasm(
          escrow.token_contract,
          this.stellar.config.tokenWasmHash,
        );
        const balanceRead = await this.stellar.read(
          escrow.token_contract,
          "balance",
          escrow.client_address,
          addressValue(escrow.contract_id),
        );
        if (
          stateRead.ledger !== balanceRead.ledger ||
          stateRead.ledger <
            Math.max(confirmedLedger, escrow.chain_state?.ledger ?? 0)
        )
          throw new ServiceUnavailableException(
            "Ledger snapshot changed or is behind confirmation. Check again; do not resubmit.",
          );
        const balance = balanceRead.value;
        if (state.status === 1 && balance < BigInt(escrow.amount_base_units))
          throw new ServiceUnavailableException(
            "Escrow balance is below the agreed funding amount.",
          );
        const snapshot = {
          ledger: stateRead.ledger,
          status: state.status,
          clientAccepted: state.client_accepted,
          freelancerAccepted: state.freelancer_accepted,
          clientRefund: state.client_refund,
          freelancerRefund: state.freelancer_refund,
          balanceBaseUnits: balance.toString(),
        };
        await client.query(
          "UPDATE testnet_escrows SET chain_state=$2,checked_at=now() WHERE project_id=$1",
          [id, snapshot],
        );
      }
    });
    return this.status(id, req);
  }
}
