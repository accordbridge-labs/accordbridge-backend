# Vercel + Render + Neon testnet demo deployment

The hosted Testnet demo uses Vercel for the frontend, a free Render web service for the API, and a Neon Free PostgreSQL database. These repository files configure an application after an operator connects the providers; they do not create a Neon project or move any data. Use synthetic accounts and valueless test tokens. This is demo hosting, not a durable production service.

## New deployment

1. Merge the backend hosting PR and companion frontend hosting PR.
2. In [Neon](https://console.neon.tech), create a Free project for the demo. Prefer a region close to the Render service (`frankfurt` in `render.yaml`). Create a dedicated database and role rather than reusing a production database or owner role. In **Connect**, copy the application connection string and keep Neon's TLS parameters intact. It must use `postgresql://` and include `sslmode=require`; current Neon strings can also include `channel_binding=require`. A pooled connection is suitable for the running API. Never commit or paste the real string into an issue, PR, log, or chat.
3. In Vercel, import `accordbridge-labs/accordbridge-frontend` from GitHub. Grant access to that repository. Select Next.js, Node 24.x, root directory `.`, install `npm ci`, and build with `npm run build`. The initial deployment can show the login page, but API actions will be unavailable until the backend is connected. Record the stable project production URL, such as `https://your-project.vercel.app`, not a unique preview URL.
4. In Render, choose **New → Blueprint**, connect `accordbridge-labs/accordbridge-backend`, select `main`, and use `render.yaml`. Supply both prompted values (Render stores `DATABASE_URL` as a secret):
   - `DATABASE_URL`: the Neon application connection string from step 2.
   - `FRONTEND_ORIGIN`: the exact HTTPS Vercel production origin from step 3, with no trailing slash or path (for example, `https://your-project.vercel.app`).
5. Wait for `GET /api/health` on the assigned Render service URL to return 200. The startup command applies transactional migrations before opening the listener and aborts if migration fails. Record the actual URL; do not infer it from the service name. `payments: disabled` means real-money payments are disabled, not that the Testnet feature is missing.
6. In the Vercel project's **Production** environment, set `BACKEND_URL` to the exact Render origin (for example, `https://actual-api-host.onrender.com`). Do not append `/api` or a trailing slash. Keep this variable server-only: do not rename it with a `NEXT_PUBLIC_` prefix or expose the backend URL directly to browser code. Redeploy the Production deployment because Vercel environment changes apply only to new deployments.
7. Test two fresh browser profiles on the stable Vercel URL: register, sign in/out, accept an agreement, verify Freighter Testnet wallets, obtain test XLM, deploy/approve/fund an escrow, submit/revise/approve work, and sign/check release. Confirm cookies are Secure and HttpOnly. Never fund real assets.

Render's `sync: false` entries prompt for values only when a new Blueprint is first created. On a later Blueprint sync, Render ignores those entries rather than replacing an existing secret. For an existing service, set or replace `DATABASE_URL` and `FRONTEND_ORIGIN` manually in the Render dashboard, save the changes, and deploy/restart the service. Redeploy Vercel after changing `BACKEND_URL`. Verify `/api/health` and the browser flow after either provider changes environment values.

The exact-origin policy intentionally rejects mutations from other Vercel preview URLs or aliases. Use a separate API and isolated database with the preview's exact HTTPS origin when an interactive preview is required. Updating to a custom domain also requires changing `FRONTEND_ORIGIN` and redeploying Render.

## Existing deployments and database cutover

Editing or syncing `render.yaml` does **not**:

- copy or migrate data from Render PostgreSQL to Neon;
- delete an existing Render database (Render preserves a resource removed from a Blueprint);
- create a Neon project, database, role, or backup;
- replace `DATABASE_URL` on an existing Render service; or
- switch live traffic safely on its own.

Existing resources and credentials need an operator-reviewed migration and cutover plan. Inventory the source database and retention needs, take and test a backup, choose a write-freeze window, rehearse the restore, verify the target, then update the Render secret and redeploy. Plan rollback before cutover. Resolve any writes made after the export; this guide does not provide replication or a zero-downtime migration. Remove an old database only after the operator has verified the new service and the agreed retention period has passed. Deletion is a separate manual provider action and is outside this repository change.

### Export and isolated restore rehearsal

Use PostgreSQL client tools compatible with the source server. Neon recommends direct (unpooled) connection strings for `pg_dump` and `pg_restore`: in Neon's **Connect** dialog, turn connection pooling off before copying a maintenance connection string. Keep TLS parameters in both URLs. Do not use the running application's pooled URL for this procedure.

The following runbook deliberately restores only into a **new, empty, isolated database whose name ends in `_test`**. Create that target in a separate Neon test project or branch first. Never aim these commands at the live database, an existing database, or customer data.

```bash
# Enter secrets without putting them in the repository or command history.
read -r -s -p "Source direct PostgreSQL URL: " SOURCE_DATABASE_URL; printf '\n'
read -r -s -p "New restore-test direct PostgreSQL URL: " RESTORE_DATABASE_URL; printf '\n'
export SOURCE_DATABASE_URL RESTORE_DATABASE_URL

# Refuse a target that does not follow the repository's isolated-test convention.
restore_database="$(psql "$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c 'select current_database()')"
case "$restore_database" in
  *_test) ;;
  *) echo "Refusing restore: target database must end in _test" >&2; exit 1 ;;
esac
existing_user_tables="$(psql "$RESTORE_DATABASE_URL" -X -A -t \
  -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"
[ "$existing_user_tables" = "0" ] || {
  echo "Refusing restore: target database is not empty" >&2
  exit 1
}

# Produce a custom-format archive and inspect its table of contents.
umask 077
pg_dump --format=custom --verbose --dbname="$SOURCE_DATABASE_URL" \
  --file=accordbridge.backup
pg_restore --list accordbridge.backup > accordbridge.restore-list.txt

# Restore into the new, empty test target. Do not add --clean or --create.
pg_restore --verbose --exit-on-error --no-owner --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" accordbridge.backup
```

Store the archive in approved encrypted backup storage with access controls and retention rules, not in Git or Render's filesystem. A dump contains application data even though it does not contain the connection-string password. Remove local copies securely according to the retention plan, then unset the shell variables.

Verify the rehearsal before considering a cutover:

```sh
psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'select current_database(), current_user;'
psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'select name, applied_at from schema_migrations order by name;'
DATABASE_URL="$RESTORE_DATABASE_URL" npm run build
DATABASE_URL="$RESTORE_DATABASE_URL" node dist/src/migrate.js
unset SOURCE_DATABASE_URL RESTORE_DATABASE_URL
```

Compare expected table counts and a small, approved sample of non-sensitive records with the source. Start the backend locally against this isolated target, request `GET /api/health`, and exercise the critical read/write flow with synthetic accounts. Record the tool versions, timestamps, checks, and results. A successful rehearsal validates that particular archive and target; it is not a substitute for the final cutover review.

## Hosting behavior and free-provider limits

`start:hosted` reads platform environment variables and needs no local `.env` file. `HOST=0.0.0.0` and Render's `PORT` expose the service correctly. Migrations run at startup under the database advisory lock. Future destructive schema changes need a separate rollout plan.

Render free web services sleep after an idle period and can take time to wake. A cold start can exceed the frontend proxy timeout: wait for API health, refresh, and inspect saved history or the existing transaction before retrying a mutation. Never interpret a timeout as payment failure. The Render filesystem is ephemeral across deploys, restarts, and spin-downs, so do not store uploads, backups, or database files there. Review the live [Render free-service limits](https://render.com/docs/free) before each deployment.

Neon Free is usage-limited. Compute allowance, storage, history/restore window, branches, and network transfer can change over time. Review the live [Neon plan comparison](https://neon.com/docs/introduction/plans) and current project usage before deployment or migration. A limited restore window or snapshot is not an operational backup policy; keep tested exports in approved storage. Neon compute can scale to zero, so the first database connection after inactivity can add latency.

Testnet state can also expire or reset; revalidate the pinned deployment values if they become unavailable. Do not accept a paid replacement automatically when a free plan is unavailable or exhausted.

No proxy trust is enabled: the backend does not trust caller-supplied forwarded IP headers. Rate limits may therefore be shared by traffic routed through Vercel/Render infrastructure. This conservative single-process setting is appropriate only for a small demo; production needs a reviewed proxy-IP policy, shared rate limiting, monitoring, backups, and recovery exercises. Account recovery and email verification also remain incomplete.

Credentials belong in provider secret settings, never Git or chat. The Blueprint contains only public Testnet token IDs/hashes and secret placeholders. Do not deploy local `.env`, fixture keys, `.local/`, backups, or the local PostgreSQL cluster.

## Provider and PostgreSQL references

- [Render Blueprint secret prompts and validation](https://render.com/docs/blueprint-spec)
- [Render Blueprint resource removal behavior](https://render.com/docs/infrastructure-as-code#deleting-resources)
- [Render free-service limits and ephemeral filesystem](https://render.com/docs/free)
- [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon Free plan and current usage limits](https://neon.com/docs/introduction/plans)
- [Neon backup and restore with `pg_dump` and `pg_restore`](https://neon.com/docs/manage/backup-pg-dump)
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html) and [`pg_restore`](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [Vercel environment variables and redeployment](https://vercel.com/docs/environment-variables)

Local builds and isolated database tests do not establish hosted readiness. Cloud provisioning, hosted authorization/session/cookie checks, provider usage and a real Freighter browser check must be verified separately before sharing the demo.

## Request correlation

Every API response, including application and middleware errors, carries a new server-generated `X-Request-ID` UUID. Completion logs contain only `requestId`, an allowlisted HTTP method, the matched route template (for example `/api/projects/:id`), HTTP status and elapsed milliseconds. Unmatched routes and requests rejected before routing use `unmatched`; raw paths and query values are never used as a fallback. Bodies, cookies, authorization, participant IDs and signed envelopes are excluded from these records. Give support the request ID and approximate time rather than a private payload.

All caller/proxy request IDs are ignored, even if they look valid. No proxy trust setting is enabled or changed. IDs correlate one backend request, not multiple retries or frontend proxy failures; a proxy that fails before reaching the API has no backend request ID. Completion records describe HTTP outcomes, not proof that a transaction committed. Logs stay on the process's standard output; no telemetry service is added.

## Public build revision

Set `BUILD_REVISION` explicitly to the full 40-character hexadecimal Git commit SHA used for this backend release. It is validated and captured at startup, normalized to lowercase, and returned as `revision` by `GET /api/health`. Missing or empty configuration returns `"unknown"`; malformed values abort startup with a fixed message that does not echo the value. No checkout inspection, provider-variable fallback or environment dump occurs. Health still queries PostgreSQL and only returns `status: ok` after that succeeds; payments remain disabled.

For Render, configure the start command as `BUILD_REVISION="$RENDER_GIT_COMMIT" npm run start:hosted` to explicitly supply [Render's source revision](https://render.com/docs/environment-variables#render_git_commit) to the process. For another provider, inject the exact checked-out commit through its release configuration as `BUILD_REVISION`. Redeploy/restart after changing it. Keep credentials in separate secret settings; never use a database URL, branch name or token as the revision. The API reads only `BUILD_REVISION`, not other provider environment variables. Record this public value alongside hosted preflight evidence; a configured SHA is metadata, not proof that a deployment is trusted or an attestation of its contents.
