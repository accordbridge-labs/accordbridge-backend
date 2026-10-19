import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { requestMetadata, RequestRecord } from "../src/request-metadata";

test("request IDs correlate success and errors without logging synthetic secrets", async () => {
  const records: RequestRecord[] = [];
  const app = express();
  app.use(requestMetadata((record) => records.push(record)));
  app.use(express.json());
  app.get("/projects/:id", (_req, res) => {
    res.json({ private: "response-secret" });
  });
  app.post("/fail/:id", () => {
    throw new Error("exception-secret");
  });
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(_err instanceof SyntaxError ? 400 : 500)
        .json({ message: "Failed" });
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    const ids = new Set();
    for (const [path, method, status, route] of [
      [
        "/projects/participant-secret?query=query-secret",
        "GET",
        200,
        "/projects/:id",
      ],
      ["/fail/participant-secret", "POST", 500, "/fail/:id"],
      ["/unknown-path-secret", "GET", 404, "unmatched"],
      ["/fail/participant-secret", "POST", 400, "unmatched"],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: {
          "X-Request-ID": "caller-secret",
          cookie: "cookie-secret",
          authorization: "Bearer auth-secret",
          "content-type": "application/json",
        },
        body:
          method === "POST"
            ? status === 400
              ? "{invalid-json-secret"
              : JSON.stringify({
                  signedXdr: "xdr-secret",
                  password: "password-secret",
                })
            : undefined,
      });
      await response.text();
      assert.equal(response.status, status);
      const id = response.headers.get("x-request-id")!;
      assert.match(id, /^[0-9a-f-]{36}$/);
      assert.ok(!ids.has(id));
      ids.add(id);
      const record = records.find((value) => value.requestId === id)!;
      assert.deepEqual(Object.keys(record).sort(), [
        "elapsedMs",
        "method",
        "requestId",
        "route",
        "status",
      ]);
      assert.equal(record.route, route);
      assert.equal(record.status, status);
      assert.equal(record.method, method);
      assert.ok(record.elapsedMs >= 0);
    }
    assert.ok(!JSON.stringify(records).includes("secret"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
