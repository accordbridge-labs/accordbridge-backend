import { Database } from "./database";

// Operator-run: one batch per invocation, independent of login/rotation.
export async function cleanupExpiredSessions(db: Database, batchSize = 500) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000)
    throw new Error("Session cleanup batch must be an integer from 1 to 5000");
  return db.transaction(async (client) => {
    const result = await client.query(
      `WITH expired AS (
        SELECT token_hash FROM sessions WHERE expires_at <= now()
        ORDER BY expires_at, token_hash LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM sessions s USING expired e WHERE s.token_hash = e.token_hash`,
      [batchSize],
    );
    return result.rowCount ?? 0;
  });
}

if (require.main === module) {
  const db = new Database();
  cleanupExpiredSessions(db, Number(process.env.SESSION_CLEANUP_BATCH ?? 500))
    .then((count) => console.log(`Removed ${count} expired sessions.`))
    .catch(() => {
      console.error(
        "Session cleanup failed; inspect database availability before retrying.",
      );
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
