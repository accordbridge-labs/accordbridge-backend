import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "./database";

export async function migrate(db: Database) {
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(823749102)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(resolve("migrations")))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(resolve("migrations", name), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query(
        "SELECT hash FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (previous.rows.length) {
        if (previous.rows[0].hash !== hash)
          throw new Error(`Applied migration was modified: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(name,hash) VALUES($1,$2)",
        [name, hash],
      );
    }
  });
}
if (require.main === module) {
  const db = new Database();
  migrate(db)
    .then(() => console.log("Database migrations applied."))
    .catch(() => {
      console.error("Migration failed; database changes were rolled back.");
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
