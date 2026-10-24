import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient } from "pg";

function timeout(name: string, fallback: number) {
  const value = process.env[name] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
    throw new Error(`${name} must be a positive integer in milliseconds`);
  return Number(value);
}

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: Pool;
  private readonly statementTimeout = timeout("DB_STATEMENT_TIMEOUT_MS", 10000);
  private readonly lockTimeout = timeout("DB_LOCK_TIMEOUT_MS", 2000);
  constructor() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on("error", () =>
      console.error("An idle database connection failed."),
    );
  }
  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
    options: { migration?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      if (!options.migration)
        await client.query(
          "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)",
          [String(this.statementTimeout), String(this.lockTimeout)],
        );
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure, including an uncertain COMMIT outcome.
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
