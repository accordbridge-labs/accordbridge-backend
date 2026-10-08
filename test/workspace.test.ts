import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { Database } from "../src/database";
import { migrate } from "../src/migrate";

test("PostgreSQL workspace, sessions and authorization", async (t) => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Tests require a separate database ending in _test");
  let app = await createApp();
  let db = app.get(Database);
  await migrate(db);
  await app.listen(0, "127.0.0.1");
  let base = await app.getUrl();
  const origin = process.env.FRONTEND_ORIGIN!;
  const suffix = randomUUID();
  const ids: string[] = [];
  let projectId = "";
  let cookie = "";
  const password = "local-test-passphrase-42!";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    session = cookie,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin,
        "x-accordbridge-request": "1",
        ...(session ? { cookie: session } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      headers: response.headers,
    };
  }
  const agreement = {
    title: "Persistent portfolio",
    description: "A fictional portfolio website",
    exclusions: "Online store",
    revisions: 2,
    reviewDays: 7,
    milestones: [
      {
        name: "Design",
        amount: "225.50",
        scope: "Three page layouts",
        criteria: "Desktop and mobile layouts",
        dueDate: "2026-12-01",
      },
      {
        name: "Build",
        amount: "400",
        scope: "Implement the pages",
        criteria: "Working contact form",
        dueDate: "2026-12-08",
      },
    ],
  };
  let alice = "";
  let bob = "";
  let outsider = "";
  try {
    await t.test(
      "register, reject invalid credentials and enforce request origin",
      async () => {
        assert.equal((await request("/projects")).status, 401);
        const account = await request("/auth/register", "POST", {
          name: "Alice",
          email: `alice-${suffix}@example.test`,
          password,
        });
        assert.equal(account.status, 201);
        ids.push(account.body.user.id);
        alice = account.cookie;
        cookie = alice;
        assert.match(account.headers.get("set-cookie")!, /HttpOnly/);
        assert.match(account.headers.get("set-cookie")!, /SameSite=Lax/i);
        assert.equal(account.body.user.password_hash, undefined);
        const stored = await db.pool.query(
          "SELECT password_hash FROM users WHERE id=$1",
          [ids[0]],
        );
        assert.notEqual(stored.rows[0].password_hash, password);
        const wrong = await request("/auth/login", "POST", {
          email: `alice-${suffix}@example.test`,
          password: "incorrect-passphrase",
        });
        assert.equal(wrong.status, 401);
        assert.equal(
          (
            await request("/auth/logout", "POST", undefined, alice, {
              origin: "https://unrelated.example",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/auth/logout", "POST", undefined, alice, {
              "x-accordbridge-request": "",
            })
          ).status,
          403,
        );
        const second = await request(
          "/auth/register",
          "POST",
          { name: "Bob", email: `bob-${suffix}@example.test`, password },
          "",
        );
        ids.push(second.body.user.id);
        bob = second.cookie;
        const third = await request(
          "/auth/register",
          "POST",
          { name: "Eve", email: `eve-${suffix}@example.test`, password },
          "",
        );
        ids.push(third.body.user.id);
        outsider = third.cookie;
      },
    );
    await t.test(
      "projects and drafts are scoped to actual account membership",
      async () => {
        assert.equal(
          (
            await request("/projects", "POST", {
              counterpartyId: ids[0],
              role: "client",
              agreement,
            })
          ).status,
          403,
        );
        const created = await request("/projects", "POST", {
          counterpartyId: ids[1],
          role: "client",
          agreement: { ...agreement, title: "" },
        });
        assert.equal(created.status, 201);
        projectId = created.body.id;
        assert.equal(
          (await request(`/projects/${projectId}`, "GET", undefined, outsider))
            .status,
          404,
        );
        assert.deepEqual(
          (await request("/projects", "GET", undefined, outsider)).body
            .projects,
          [],
        );
        const partner = await request(
          `/projects/${projectId}`,
          "GET",
          undefined,
          bob,
        );
        assert.equal(partner.body.draft, null);
        assert.equal(partner.body.role, "freelancer");
        assert.equal(
          (
            await request(
              `/projects/${projectId}/draft`,
              "PUT",
              { agreement, expectedVersion: 0, expectedRevision: 1 },
              outsider,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "drafts and sessions survive restarting the application",
      async () => {
        const invalid = await request(
          `/projects/${projectId}/publish`,
          "POST",
          { expectedVersion: 0, expectedRevision: 1 },
        );
        assert.equal(invalid.status, 400);
        const saved = await request(`/projects/${projectId}/draft`, "PUT", {
          agreement,
          expectedVersion: 0,
          expectedRevision: 1,
        });
        assert.equal(saved.body.revision, 2);
        await app.close();
        app = await createApp();
        db = app.get(Database);
        await app.listen(0, "127.0.0.1");
        base = await app.getUrl();
        const persisted = await request(`/projects/${projectId}`);
        assert.equal(persisted.status, 200);
        assert.equal(persisted.body.draft.agreement.title, agreement.title);
        assert.equal(
          persisted.body.draft.agreement.milestones[0].amount,
          "225.50",
        );
      },
    );
    await t.test(
      "concurrent draft and publish writes do not overwrite each other",
      async () => {
        const writes = await Promise.all([
          request(`/projects/${projectId}/draft`, "PUT", {
            agreement,
            expectedVersion: 0,
            expectedRevision: 2,
          }),
          request(`/projects/${projectId}/draft`, "PUT", {
            agreement,
            expectedVersion: 0,
            expectedRevision: 2,
          }),
        ]);
        assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
        const publishes = await Promise.all([
          request(`/projects/${projectId}/publish`, "POST", {
            expectedVersion: 0,
            expectedRevision: 3,
          }),
          request(`/projects/${projectId}/publish`, "POST", {
            expectedVersion: 0,
            expectedRevision: 3,
          }),
        ]);
        assert.deepEqual(publishes.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          (await request(`/projects/${projectId}`)).body.versions.length,
          1,
        );
      },
    );
    await t.test(
      "acceptance identity cannot be forged; accepting is idempotent",
      async () => {
        assert.equal(
          (
            await request(`/projects/${projectId}/accept`, "POST", {
              version: 1,
              role: "freelancer",
              userId: ids[1],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/projects/${projectId}/accept`,
              "POST",
              { version: 1 },
              outsider,
            )
          ).status,
          404,
        );
        const accepted = await request(
          `/projects/${projectId}/accept`,
          "POST",
          { version: 1 },
        );
        assert.equal(accepted.body.role, "client");
        await request(`/projects/${projectId}/accept`, "POST", { version: 1 });
        assert.equal(
          (await request(`/projects/${projectId}`)).body.versions[0].acceptances
            .length,
          1,
        );
        await request(
          `/projects/${projectId}/accept`,
          "POST",
          { version: 1 },
          bob,
        );
        assert.equal(
          (await request(`/projects/${projectId}`)).body.versions[0].acceptances
            .length,
          2,
        );
      },
    );
    await t.test(
      "new versions preserve history and invalidate old acceptance and stale drafts",
      async () => {
        await request(
          `/projects/${projectId}/draft`,
          "PUT",
          { agreement, expectedVersion: 1, expectedRevision: 0 },
          bob,
        );
        const changed = structuredClone(agreement);
        changed.milestones[0].amount = "250";
        await request(`/projects/${projectId}/draft`, "PUT", {
          agreement: changed,
          expectedVersion: 1,
          expectedRevision: 0,
        });
        assert.equal(
          (
            await request(`/projects/${projectId}/publish`, "POST", {
              expectedVersion: 1,
              expectedRevision: 1,
            })
          ).status,
          201,
        );
        const updated = (await request(`/projects/${projectId}`)).body;
        assert.equal(updated.currentVersion, 2);
        assert.equal(updated.versions[0].acceptances.length, 0);
        assert.equal(updated.versions[1].acceptances.length, 2);
        assert.equal(
          updated.versions[1].agreement.milestones[0].amount,
          "225.50",
        );
        assert.equal(
          (
            await request(
              `/projects/${projectId}/accept`,
              "POST",
              { version: 1 },
              bob,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/projects/${projectId}/publish`,
              "POST",
              { expectedVersion: 1, expectedRevision: 1 },
              bob,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "funding lock is enforced on the server and payments have no endpoint",
      async () => {
        await db.pool.query(
          "UPDATE projects SET funding_started=true WHERE id=$1",
          [projectId],
        );
        assert.equal(
          (
            await request(`/projects/${projectId}/draft`, "PUT", {
              agreement,
              expectedVersion: 2,
              expectedRevision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`/projects/${projectId}/accept`, "POST", {
              version: 2,
            })
          ).status,
          409,
        );
        assert.equal(
          (await request(`/projects/${projectId}/fund`, "POST", {})).status,
          404,
        );
      },
    );
    await t.test("logout revokes the server session", async () => {
      await request("/auth/logout", "POST");
      assert.equal((await request("/auth/me")).status, 401);
      const signedIn = await request(
        "/auth/login",
        "POST",
        { email: `alice-${suffix}@example.test`, password },
        "",
      );
      assert.equal(signedIn.status, 201);
      assert.equal(
        (await request("/auth/me", "GET", undefined, signedIn.cookie)).status,
        200,
      );
    });
  } finally {
    if (projectId)
      await db.pool.query("DELETE FROM projects WHERE id=$1", [projectId]);
    if (ids.length)
      await db.pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await app.close();
  }
});
