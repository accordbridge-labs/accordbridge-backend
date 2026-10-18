import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "@stellar/stellar-sdk";
import { TestnetReadiness } from "../src/readiness";
import { sha256, Stellar, TESTNET } from "../src/stellar";

function fixture() {
  const escrowCode = Buffer.from("synthetic escrow bytecode");
  const tokenCode = Buffer.from("synthetic token bytecode");
  const config = {
    wasmHash: sha256(escrowCode),
    tokenWasmHash: sha256(tokenCode),
    token: S.StrKey.encodeContract(Buffer.alloc(32, 3)),
  };
  let calls = 0;
  const server = {
    getNetwork: async () => {
      calls++;
      return { passphrase: TESTNET };
    },
    getLedgerEntries: async (...keys: S.xdr.LedgerKey[]) => ({
      latestLedger: 123,
      entries: keys.map((key, i) => ({
        key,
        val:
          i === 1
            ? S.xdr.LedgerEntryData.contractData(
                new S.xdr.ContractDataEntry({
                  ext: S.xdr.ExtensionPoint.v0(),
                  contract: S.Address.fromString(config.token).toScAddress(),
                  key: S.xdr.ScVal.scvLedgerKeyContractInstance(),
                  durability: S.xdr.ContractDataDurability.persistent,
                  val: S.xdr.ScVal.scvContractInstance(
                    new S.xdr.ScContractInstance({
                      executable:
                        S.xdr.ContractExecutable.contractExecutableWasm(
                          config.tokenWasmHash,
                        ),
                      storage: null,
                    }),
                  ),
                }),
              )
            : S.xdr.LedgerEntryData.contractCode(
                new S.xdr.ContractCodeEntry({
                  ext: S.xdr.ContractCodeEntryExt.v0(),
                  hash: i === 0 ? config.wasmHash : config.tokenWasmHash,
                  code: i === 0 ? escrowCode : tokenCode,
                }),
              ),
      })),
    }),
  };
  const stellar = { config, server } as unknown as Stellar;
  return {
    config,
    server,
    stellar,
    calls: () => calls,
    service: new TestnetReadiness(stellar),
  };
}

test("readiness verifies code and shares one cached probe across callers", async (t) => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => f.service.check()),
  );
  assert.equal(results[0].status, "ready");
  assert.equal(f.calls(), 1);
  assert.equal((await f.service.check()).checkedAt, results[0].checkedAt);
  assert.equal(JSON.stringify(results[0]).includes(f.config.token), false);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(results[0].expiresAt) + 1,
  });
  await f.service.check();
  assert.equal(f.calls(), 2);
});

test("missing configuration makes no RPC calls", async () => {
  const f = fixture();
  Object.defineProperty(f.stellar, "config", {
    get() {
      throw new Error("secret config");
    },
  });
  assert.equal((await f.service.check()).status, "not_configured");
  assert.equal(f.calls(), 0);
});

test("wrong network stops before ledger reads", async () => {
  const f = fixture();
  f.server.getNetwork = async () => ({ passphrase: S.Networks.PUBLIC });
  f.server.getLedgerEntries = async () => {
    assert.fail("must not read mainnet");
  };
  assert.equal((await f.service.check()).status, "wrong_network");
});

test("missing or archived entries are unavailable, never ready", async () => {
  const f = fixture();
  f.server.getLedgerEntries = async () => ({ latestLedger: 123, entries: [] });
  assert.equal((await f.service.check()).status, "entry_unavailable");
});

test("altered bytecode is rejected", async () => {
  const f = fixture();
  f.config.wasmHash = "a".repeat(64);
  assert.equal((await f.service.check()).status, "code_mismatch");
});

test("RPC timeout is sanitized and cached", async () => {
  const f = fixture();
  f.server.getNetwork = async () => {
    throw new Error("timeout containing private infrastructure data");
  };
  const result = await f.service.check();
  assert.equal(result.status, "rpc_unavailable");
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.deepEqual(await f.service.check(), result);
});

test("token instance pointing to a different executable is rejected", async () => {
  const f = fixture();
  const read = f.server.getLedgerEntries;
  f.server.getLedgerEntries = async (...keys) => {
    const result = await read(...keys);
    const entry = result.entries[1];
    assert.equal(entry.val.type, "contractData");
    if (entry.val.type !== "contractData") throw new Error("Invalid fixture");
    const data = entry.val.contractData;
    entry.val = S.xdr.LedgerEntryData.contractData(
      new S.xdr.ContractDataEntry({
        ext: data.ext,
        contract: data.contract,
        key: data.key,
        durability: data.durability,
        val: S.xdr.ScVal.scvContractInstance(
          new S.xdr.ScContractInstance({
            executable: S.xdr.ContractExecutable.contractExecutableWasm(
              "f".repeat(64),
            ),
            storage: null,
          }),
        ),
      }),
    );
    return result;
  };
  assert.equal((await f.service.check()).status, "code_mismatch");
});
