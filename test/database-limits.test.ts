import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../src/database";
import { migrate } from "../src/migrate";
import { cleanupExpiredSessions } from "../src/session-cleanup";
import { AuthController, cookieName, digest, hashPassword } from "../src/auth";
import { Request, Response } from "express";

test("isolated PostgreSQL limits and bounded session maintenance", async (t) => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Requires a database ending in _test");
  process.env.DB_STATEMENT_TIMEOUT_MS = "250";
  process.env.DB_LOCK_TIMEOUT_MS = "100";
  const db = new Database();
  const user = {
    id: randomUUID(),
    name: "Limits",
    email: `${randomUUID()}@example.test`,
  };
  const password = "local-password-for-tests";
  try {
    await migrate(db);
    await db.pool.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [user.id, user.name, user.email, await hashPassword(password)],
    );
    await t.test(
      "slow statement rolls back earlier writes and releases connection",
      async () => {
        await assert.rejects(
          db.transaction(async (client) => {
            await client.query("UPDATE users SET name='partial' WHERE id=$1", [
              user.id,
            ]);
            await client.query("SELECT pg_sleep(1)");
          }),
          { code: "57014" },
        );
        assert.equal(
          (await db.pool.query("SELECT name FROM users WHERE id=$1", [user.id]))
            .rows[0].name,
          user.name,
        );
        assert.equal(db.pool.waitingCount, 0);
        assert.equal(db.pool.idleCount, db.pool.totalCount);
      },
    );
    await t.test(
      "blocked row lock times out without persisting writes",
      async () => {
        const blocker = await db.pool.connect();
        try {
          await blocker.query("BEGIN");
          await blocker.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
            user.id,
          ]);
          await assert.rejects(
            db.transaction(async (client) => {
              await client.query(
                "INSERT INTO sessions VALUES($1,$2,now()+interval '1 day',now())",
                ["partial-" + user.id, user.id],
              );
              await client.query(
                "UPDATE users SET name='blocked' WHERE id=$1",
                [user.id],
              );
            }),
            { code: "55P03" },
          );
          assert.equal(
            (
              await db.pool.query(
                "SELECT * FROM sessions WHERE token_hash=$1",
                ["partial-" + user.id],
              )
            ).rowCount,
            0,
          );
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
        await db.transaction(async (client) => {
          assert.equal((await client.query("SELECT 1 AS ok")).rows[0].ok, 1);
        });
      },
    );
    await t.test(
      "limits are local and migrations have a separate budget",
      async () => {
        await db.transaction(async (client) => {
          assert.equal(
            (await client.query("SHOW statement_timeout")).rows[0]
              .statement_timeout,
            "250ms",
          );
        });
        await db.transaction(
          async (client) => {
            await client.query("SELECT pg_sleep(0.3)");
          },
          { migration: true },
        );
      },
    );
    await t.test(
      "cleanup batches skip locked rows and do not affect concurrent logins or active sessions",
      async () => {
        // Dedicated fixture schema keeps batch assertions independent of other test files.
        const schema = `cleanup_${user.id.replaceAll("-", "")}`;
        await db.pool.query(`CREATE SCHEMA ${schema}`);
        const originalUrl = process.env.DATABASE_URL!;
        const isolatedUrl = new URL(originalUrl);
        isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
        process.env.DATABASE_URL = isolatedUrl.toString();
        const maintenance = new Database();
        process.env.DATABASE_URL = originalUrl;
        try {
          await maintenance.pool.query(
            "CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid, expires_at timestamptz)",
          );
          await maintenance.pool.query(
            "INSERT INTO sessions SELECT 'expired-'||i,$1,now()-interval '1 day' FROM generate_series(1,7) i",
            [user.id],
          );
          await maintenance.pool.query(
            "INSERT INTO sessions VALUES ('active',$1,now()+interval '1 day')",
            [user.id],
          );
          assert.equal(await cleanupExpiredSessions(maintenance, 2), 2);
          const lock = await maintenance.pool.connect();
          try {
            await lock.query("BEGIN");
            await lock.query(
              "SELECT * FROM sessions WHERE token_hash='expired-3' FOR UPDATE",
            );
            const counts = await Promise.all([
              cleanupExpiredSessions(maintenance, 2),
              cleanupExpiredSessions(maintenance, 2),
            ]);
            assert.equal(
              counts.reduce((a, b) => a + b),
              4,
            );
          } finally {
            await lock.query("ROLLBACK");
            lock.release();
          }
          assert.equal(await cleanupExpiredSessions(maintenance, 2), 1);
          assert.equal(
            (await maintenance.pool.query("SELECT token_hash FROM sessions"))
              .rows[0].token_hash,
            "active",
          );
          await assert.rejects(cleanupExpiredSessions(maintenance, 0));
          await maintenance.pool.query(
            "INSERT INTO sessions VALUES ('fails',$1,now()-interval '1 day')",
            [user.id],
          );
          await maintenance.pool.query(
            `CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic maintenance failure'; END $$`,
          );
          await maintenance.pool.query(
            "CREATE TRIGGER reject_cleanup BEFORE DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION reject_cleanup()",
          );
          await assert.rejects(cleanupExpiredSessions(maintenance, 2), {
            code: "P0001",
          });
          assert.equal(
            (await maintenance.pool.query("SELECT * FROM sessions")).rowCount,
            2,
          );
          assert.equal(maintenance.pool.idleCount, maintenance.pool.totalCount);
        } finally {
          await maintenance.onModuleDestroy();
          await db.pool.query(`DROP SCHEMA ${schema} CASCADE`);
        }
        const auth = new AuthController(db);
        const oldToken = "a".repeat(64);
        await db.pool.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
          [digest(oldToken), user.id],
        );
        const tokens: string[] = [];
        const response = {
          cookie: (_name: string, token: string) => tokens.push(token),
          clearCookie: () => {},
        } as unknown as Response;
        await Promise.all([
          cleanupExpiredSessions(db, 2),
          ...[1, 2].map(() =>
            auth.login(
              { email: user.email, password },
              { cookies: { [cookieName]: oldToken } } as unknown as Request,
              response,
            ),
          ),
        ]);
        assert.equal(tokens.length, 2);
        assert.equal(
          (
            await db.pool.query("SELECT * FROM sessions WHERE token_hash=$1", [
              digest(oldToken),
            ])
          ).rowCount,
          0,
        );
        // Failed maintenance cannot roll back these independently committed sessions.
        await assert.rejects(cleanupExpiredSessions(db, -1));
        for (const token of tokens) {
          assert.equal(
            (
              await db.pool.query(
                "SELECT * FROM sessions WHERE token_hash=$1",
                [digest(token)],
              )
            ).rowCount,
            1,
          );
          await auth.logout(
            { cookies: { [cookieName]: token } } as unknown as Request,
            response,
          );
          assert.equal(
            (
              await db.pool.query(
                "SELECT * FROM sessions WHERE token_hash=$1",
                [digest(token)],
              )
            ).rowCount,
            0,
          );
        }
      },
    );
  } finally {
    await db.pool.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.onModuleDestroy();
  }
});

test("rollback failure discards the connection and preserves uncertain COMMIT error", async () => {
  const db = new Database();
  const failure = new Error(
    "Connection lost while committing; outcome unknown",
  );
  const queries: string[] = [];
  let discarded = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "COMMIT") throw failure;
      if (sql === "ROLLBACK") throw new Error("Connection closed");
    },
    release(value: boolean) {
      discarded = value;
    },
  };
  Object.defineProperty(db.pool, "connect", { value: async () => client });
  try {
    await assert.rejects(
      db.transaction(async () => "result"),
      (error) => error === failure,
    );
    assert.equal(discarded, true);
    assert.equal(queries.filter((sql) => sql === "COMMIT").length, 1);
    assert.equal(queries.at(-1), "ROLLBACK");
  } finally {
    await db.onModuleDestroy();
  }
});
