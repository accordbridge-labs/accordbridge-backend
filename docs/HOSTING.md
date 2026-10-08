# Vercel + Render testnet demo deployment

These files prepare hosting; they do not create cloud resources. Use synthetic accounts and valueless test tokens. The Render blueprint explicitly selects free compute and free PostgreSQL. The database expires after 30 days, has no managed backups, and the web service can sleep. This is temporary demo hosting, not durable production. Review the dashboard's plans and usage limits before creating resources. Do not accept a paid replacement automatically if a free plan is unavailable.

## Deployment order

1. Merge the backend hosting PR and companion frontend hosting PR.
2. In Vercel, import `accordbridge-labs/accordbridge-frontend` from GitHub. Grant access to that repository. Select Next.js, Node 24.x, root directory `.`, install `npm ci` and build `npm run build`. The initial deployment can show the login page, but API actions will be unavailable until step 5. Record the stable project production URL, such as `https://your-project.vercel.app`, not a unique preview URL.
3. In Render, choose **New → Blueprint**, connect `accordbridge-labs/accordbridge-backend`, and select main with `render.yaml`. At the `FRONTEND_ORIGIN` prompt, enter that exact HTTPS Vercel origin, with no trailing slash or path. The blueprint creates the API and database in the same region, injects the internal database connection string, and disables external database access.
4. Wait for `/api/health` on the Render service URL to return 200. Startup applies transactional migrations before opening the listener, and aborts on migration failure. Record the actual assigned Render URL; do not assume its hostname from the service name. `payments: disabled` means real-money payments are disabled, not that the testnet feature is missing.
5. Add `BACKEND_URL=https://actual-api-host.onrender.com` to the Vercel project's Production environment. Do not append `/api`, add a trailing slash or use `NEXT_PUBLIC_`. Redeploy Vercel for the variable to take effect.
6. Test two fresh browser profiles on the stable Vercel URL: register, sign in/out, accept an agreement, verify Freighter Testnet wallets, obtain test XLM, deploy/approve/fund an escrow, submit/revise/approve work, and sign/check release. Confirm cookies are Secure and HttpOnly. Never fund real assets.

The current exact-origin policy intentionally rejects mutations from other Vercel preview URLs or aliases. Use a separate API/database and exact origin if you need an interactive preview. A future custom domain also requires updating FRONTEND_ORIGIN. Keep your existing local database untouched; no accounts are uploaded or migrated from your machine by this setup.

## Hosting behavior and limits

`start:hosted` uses platform environment variables and needs no local .env file. HOST=0.0.0.0 and Render's PORT expose the service correctly. The free service lacks a pre-deploy hook, so migrations run at startup under the existing database advisory lock. Future destructive schema changes need a separate rollout plan.

Cold starts can exceed the frontend's 15-second proxy timeout. Wait for API health, refresh, and check saved history or the existing transaction before retrying a mutation. Never interpret a timeout as payment failure. Testnet state can also expire/reset; pinned deployment values must be revalidated if unavailable.

No proxy trust is enabled: the backend does not trust caller-supplied forwarded IP headers. Rate limits may therefore be shared by traffic routed through Vercel/Render infrastructure. This conservative single-process setting is appropriate only for a small demo; production needs a reviewed proxy-IP policy, shared rate limiting and monitoring. Account recovery, email verification and operational backups remain incomplete.

Credentials belong in provider environment settings, never Git or chat. The blueprint contains only public token IDs/hashes and a database reference. Do not deploy local `.env`, fixture keys, `.local/`, or the local PostgreSQL cluster.

## Sources

- [Render Blueprint reference](https://render.com/docs/blueprint-spec)
- [Render free-service limits](https://render.com/docs/free)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)

Local builds and isolated database tests do not establish hosted readiness. Account authorization, cloud provisioning, hosted session/cookie verification and a real Freighter browser check must still complete before sharing the demo.
