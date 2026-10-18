import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import * as S from "@stellar/stellar-sdk";
import { SessionGuard } from "./auth";
import { sha256, Stellar, TESTNET } from "./stellar";

export type ReadinessStatus =
  | "ready"
  | "not_configured"
  | "wrong_network"
  | "entry_unavailable"
  | "code_mismatch"
  | "rpc_unavailable";
export interface ReadinessResult {
  status: ReadinessStatus;
  checkedAt: string;
  expiresAt: string;
  network: "testnet";
  mainnetPayments: false;
}

// Shared per process: simultaneous callers join one bounded probe. Failures are
// cached too, so an outage does not create a retry storm against the public RPC.
@Injectable()
export class TestnetReadiness {
  private cached?: ReadinessResult;
  private inFlight?: Promise<ReadinessResult>;
  constructor(private readonly stellar: Stellar) {}

  check(): Promise<ReadinessResult> {
    if (this.cached && Date.now() < Date.parse(this.cached.expiresAt))
      return Promise.resolve(this.cached);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.probe().then((status) => {
      const now = Date.now();
      this.cached = {
        status,
        checkedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 30000).toISOString(),
        network: "testnet",
        mainnetPayments: false,
      };
      this.inFlight = undefined;
      return this.cached;
    });
    return this.inFlight;
  }

  private async probe(): Promise<ReadinessStatus> {
    let config: Stellar["config"];
    try {
      config = this.stellar.config;
    } catch {
      return "not_configured";
    }
    try {
      if ((await this.stellar.server.getNetwork()).passphrase !== TESTNET)
        return "wrong_network";
      const codeKey = (hash: string) =>
        S.xdr.LedgerKey.contractCode(
          new S.xdr.LedgerKeyContractCode({ hash: Buffer.from(hash, "hex") }),
        );
      const keys = [
        codeKey(config.wasmHash),
        new S.Contract(config.token).getFootprint(),
        codeKey(config.tokenWasmHash),
      ];
      // One ledger read checks the instance and both executables together.
      const result = await this.stellar.server.getLedgerEntries(...keys);
      const entries = keys.map((key) =>
        result.entries.find((entry) =>
          Buffer.from(entry.key.toXDR()).equals(key.toXDR()),
        ),
      );
      if (entries.some((entry) => !entry)) return "entry_unavailable";
      const [escrow, token, tokenCode] = entries.map((entry) => entry!.val);
      if (
        escrow.type !== "contractCode" ||
        token.type !== "contractData" ||
        tokenCode.type !== "contractCode"
      )
        return "code_mismatch";
      const instance = token.contractData.val;
      if (instance.type !== "scvContractInstance") return "code_mismatch";
      const executable = instance.instance.executable;
      if (
        executable.type !== "contractExecutableWasm" ||
        executable.wasmHash.toString() !== config.tokenWasmHash ||
        sha256(escrow.contractCode.code) !== config.wasmHash ||
        sha256(tokenCode.contractCode.code) !== config.tokenWasmHash
      )
        return "code_mismatch";
      return "ready";
    } catch {
      // Do not expose raw RPC errors, environment values or infrastructure data.
      return "rpc_unavailable";
    }
  }
}

@Controller("testnet/readiness")
@UseGuards(SessionGuard)
export class ReadinessController {
  constructor(private readonly readiness: TestnetReadiness) {}
  @Get()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  get() {
    return this.readiness.check();
  }
}
