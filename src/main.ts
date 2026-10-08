import { createApp } from "./app";
async function main() {
  const app = await createApp();
  await app.listen(
    Number(process.env.PORT ?? 4000),
    process.env.HOST ?? "127.0.0.1",
  );
  console.log(
    `AccordBridge API listening on port ${process.env.PORT ?? 4000}; mainnet payments disabled; testnet requires explicit configuration.`,
  );
}
main().catch(() => {
  console.error(
    "Backend startup failed. Check configuration and database availability.",
  );
  process.exitCode = 1;
});
