import {
  BadRequestException,
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as S from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";

export const TESTNET = "Test SDF Network ; September 2015";
export const RPC = "https://soroban-testnet.stellar.org";
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const addressValue = (value: string) =>
  S.Address.fromString(value).toScVal();
export const integerValue = (value: string) =>
  S.nativeToScVal(BigInt(value), { type: "i128" });
export const bytesValue = (value: string) =>
  S.nativeToScVal(Buffer.from(value, "hex"));
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function baseUnits(amount: string): string {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount))
    throw new BadRequestException("Invalid milestone amount");
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole) * 10000000n +
    BigInt(fraction.padEnd(7, "0"))
  ).toString();
}
export function signedTransaction(
  unsigned: string,
  signed: string,
  address: string,
) {
  try {
    const expected = S.TransactionBuilder.fromXDR(unsigned, TESTNET);
    const actual = S.TransactionBuilder.fromXDR(signed, TESTNET);
    if (
      !(expected instanceof S.Transaction) ||
      !(actual instanceof S.Transaction) ||
      !Buffer.from(expected.hash()).equals(Buffer.from(actual.hash())) ||
      actual.source !== address
    )
      throw new Error();
    const key = S.Keypair.fromPublicKey(address);
    if (
      !actual.signatures.some((signature) => {
        try {
          return key.verify(actual.hash(), signature.signature);
        } catch {
          return false;
        }
      })
    )
      throw new Error();
    return actual;
  } catch {
    throw new BadRequestException(
      "Wallet signature or transaction contents do not match the prepared request.",
    );
  }
}

@Injectable()
export class Stellar {
  readonly server = new S.rpc.Server(RPC, { timeout: 10000 });
  async available<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Stellar testnet is temporarily unavailable. Check the existing transaction again; do not resubmit.",
      );
    }
  }
  get config() {
    const wasmHash = process.env.STELLAR_ESCROW_WASM_HASH ?? "";
    const token = process.env.STELLAR_TEST_TOKEN_CONTRACT ?? "";
    const tokenWasmHash = process.env.STELLAR_TEST_TOKEN_WASM_HASH ?? "";
    if (
      process.env.STELLAR_TESTNET_ENABLED !== "true" ||
      !/^[a-f0-9]{64}$/.test(wasmHash) ||
      !/^[a-f0-9]{64}$/.test(tokenWasmHash) ||
      !S.StrKey.isValidContract(token)
    )
      throw new ServiceUnavailableException(
        "Stellar testnet is not configured.",
      );
    return { wasmHash, token, tokenWasmHash };
  }
  async network() {
    if (
      (await this.available(() => this.server.getNetwork())).passphrase !==
      TESTNET
    )
      throw new ServiceUnavailableException(
        "RPC did not identify Stellar testnet.",
      );
  }
  async prepare(
    address: string,
    operation: ReturnType<typeof S.Operation.invokeContractFunction>,
  ) {
    await this.network();
    const account = await this.server.getAccount(address);
    const tx = new S.TransactionBuilder(account, {
      fee: S.BASE_FEE,
      networkPassphrase: TESTNET,
    })
      .addOperation(operation)
      .setTimeout(180)
      .build();
    const prepared = await this.server.prepareTransaction(tx);
    if (BigInt(prepared.fee) > 10000000n)
      throw new BadRequestException(
        "Estimated fee exceeds the 1 test-XLM limit.",
      );
    return {
      xdr: prepared.toXDR(),
      hash: Buffer.from(prepared.hash()).toString("hex"),
      expiresAt: Number(prepared.timeBounds!.maxTime),
      minLedger: (await this.server.getLatestLedger()).sequence,
      fee: prepared.fee,
    };
  }
  async wasm(contract: string, expected: string) {
    if (
      sha256(
        await this.available(() =>
          this.server.getContractWasmByContractId(contract),
        ),
      ) !== expected
    )
      throw new ServiceUnavailableException(
        "Deployed contract code does not match the pinned testnet code.",
      );
  }
  async read(
    contract: string,
    method: string,
    source: string,
    ...args: S.xdr.ScVal[]
  ) {
    const tx = new S.TransactionBuilder(
      await this.available(() => this.server.getAccount(source)),
      {
        fee: S.BASE_FEE,
        networkPassphrase: TESTNET,
      },
    )
      .addOperation(new S.Contract(contract).call(method, ...args))
      .setTimeout(30)
      .build();
    const result = await this.available(() =>
      this.server.simulateTransaction(tx),
    );
    if (!S.rpc.Api.isSimulationSuccess(result) || !result.result)
      throw new ServiceUnavailableException(
        "Unable to read verified contract state.",
      );
    return {
      value: S.scValToNative(result.result.retval),
      ledger: result.latestLedger,
    };
  }
}
