import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Dedicated local cluster; never touches an existing system database.
const directory = resolve(".local");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const passwordFile = resolve(directory, "postgres-password");
if (!existsSync(passwordFile))
  writeFileSync(passwordFile, randomBytes(32).toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
const password = readFileSync(passwordFile, "utf8").trim();
const known = "/Applications/Postgres.app/Contents/Versions/latest/bin";
const bin = process.env.PG_BIN ?? (existsSync(known) ? known : "");
const command = (name) => (bin ? `${bin}/${name}` : name);
function run(name, args, options = {}) {
  const result = spawnSync(command(name), args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${name} failed. Install PostgreSQL binaries or set PG_BIN.`,
    );
}
const data = resolve(directory, "postgres");
if (!existsSync(resolve(data, "PG_VERSION")))
  run("initdb", [
    "-D",
    data,
    "-U",
    "accordbridge",
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    `--pwfile=${passwordFile}`,
    "--encoding=UTF8",
    "--locale=C",
  ]);
const running =
  spawnSync(command("pg_ctl"), ["-D", data, "status"], { stdio: "ignore" })
    .status === 0;
if (!running)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    resolve(directory, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p 55432 -k ${directory}`,
    "-w",
    "start",
  ]);
const env = { ...process.env, PGPASSWORD: password };
for (const database of ["accordbridge_dev", "accordbridge_test"]) {
  const result = spawnSync(
    command("psql"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      "55432",
      "-U",
      "accordbridge",
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${database}'`,
    ],
    { env, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error("Unable to inspect the dedicated database.");
  if (result.stdout.trim() !== "1")
    run(
      "createdb",
      ["-h", "127.0.0.1", "-p", "55432", "-U", "accordbridge", database],
      { env },
    );
  const file = database.endsWith("_test") ? ".env.test" : ".env";
  if (!existsSync(file))
    writeFileSync(
      file,
      `DATABASE_URL=postgresql://accordbridge:${password}@127.0.0.1:55432/${database}\nPORT=4000\nHOST=127.0.0.1\nFRONTEND_ORIGIN=http://127.0.0.1:3000\nNODE_ENV=development\n`,
      { mode: 0o600, flag: "wx" },
    );
}
console.log(
  "Dedicated local PostgreSQL cluster ready on port 55432. Configurations saved to ignored .env files.",
);
