# Production `public` schema baseline — provenance & reconciliation

Companion to [`production-schema-baseline.sql`](./production-schema-baseline.sql). That file is a **captured
point-in-time snapshot** of the production `public` schema DDL, plus the one directly-associated global RLS event
trigger (catalog-verified). It is used to author the device-ownership / account-erasure work (PR 3 / PR 4) and the
tracked base schema (PR 8). **It is not a migration — do not apply it.**

## Provenance

| | |
|---|---|
| Capture date (UTC) | `2026-08-25T04:07:09Z` |
| Project ref | `jmrpqmejupouqfergyyg` (project "gesso", region `us-west-2`) |
| Server version | PostgreSQL 17.6 |
| Tool | `pg_dump` 18.6 (Homebrew `libpq`); event trigger via read-only `psql` catalog query |
| Connection | Supabase session pooler (`aws-1-us-west-2.pooler.supabase.com:5432`, user `postgres.<ref>`), IPv4 |
| Scope | `--schema=public --schema-only --no-owner`, plus catalog-derived global RLS event trigger |
| Row data | none — schema-only; verified no `COPY` / `INSERT` |
| Ownership | stripped (`--no-owner`); `GRANT`/ACL privileges deliberately kept |
| SHA-256 of the `.sql` | `18e4c60f4001e97f7109c9a32a1a5a49b4e8c1f1893614fc90404d525029f91c` |

The `check-production-schema-baseline.mjs` gate re-derives this SHA-256 from the `.sql` and fails if this line and
the file disagree. If you re-capture, update both.

## Reproduction (credential-safe)

Credentials come only from the environment / gitignored `.env.local`; they are never printed, logged, or placed in
argv or a URL. `SUPABASE_SECRET_KEY` is **not** the database password.

```sh
# 1. Provide creds out-of-band (gitignored .env.local):
#    SUPABASE_DB_PASSWORD='…'      # project DB password (Dashboard -> Database -> Connection info)
#    SUPABASE_ACCESS_TOKEN='sbp_…' # only needed for the Supabase CLI route

set -a; . ./.env.local; set +a
export PGPASSWORD="$SUPABASE_DB_PASSWORD"     # read by pg_dump from env, never in argv

pg_dump \
  -h aws-1-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.jmrpqmejupouqfergyyg -d postgres \
  --schema=public --schema-only --no-owner \
  -f public-raw.sql
# then: strip the psql restore-guard meta-command nonce lines, prepend the header, append the
# catalog-derived global event trigger (below), recompute SHA-256.
```

The global event trigger is verified/emitted separately (it is outside a public-only dump):

```sh
psql \
  -h aws-1-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.jmrpqmejupouqfergyyg -d postgres \
  --no-psqlrc -v ON_ERROR_STOP=1 -c "
SELECT e.evtname, e.evtevent, e.evtenabled, e.evttags, p.oid::regprocedure
FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid
WHERE p.oid='public.rls_auto_enable()'::regprocedure;"
```

Notes:
- The **Supabase CLI** route (`supabase link` + `supabase db dump --schema public`) is equivalent and roadmap-preferred,
  but `supabase db dump` shells out to Docker for `pg_dump`; on a machine without Docker, the native `pg_dump` above is
  the working path.
- Use the **session** pooler port `5432` (transaction port `6543` does not support `pg_dump`).
- Get the exact pooler host from the Management API:
  `GET https://api.supabase.com/v1/projects/<ref>/config/database/pooler` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`.

## Schemas included / excluded

- **Included:** `public` schema (schema-only) **plus** the one directly-associated global object: the RLS event
  trigger `ensure_rls` (catalog-verified, appended to the `.sql`).
- **Excluded:** `auth`, `storage`, `realtime`, `graphql`, `extensions`, `vault`, and all other Supabase-managed
  schemas; all role definitions; all row data. `auth.users` is referenced conceptually below but its DDL is **not**
  in this baseline.

## Catalog verification (read-only `pg_catalog`, 2026-08-25)

These metadata-only `SELECT`s make each "none" a **verified fact**, not an inference from a schema-filtered dump. No
application rows were queried.

- **RLS event trigger — EXISTS (verified):** `pg_event_trigger` →
  `evtname = ensure_rls`, `evtevent = ddl_command_end`, `evtenabled = 'O'` (enabled),
  `evttags = {CREATE TABLE, CREATE TABLE AS, SELECT INTO}`, function `public.rls_auto_enable()`.
  Its sanitized `CREATE EVENT TRIGGER` DDL is in the `.sql` "GLOBAL SECURITY OBJECTS" section.
- **Foreign keys (owning table in `public`, incl. cross-schema refs) — 0 rows.** `pg_constraint contype='f'` returned
  nothing. There is **no** FK from any `public` table to `auth.users` or elsewhere. (Verified, not inferred.)
- **Table triggers (non-internal) in `public` — 0 rows.** (`pg_trigger`, excluding `tgisinternal`.)
- **Policies in `public` — 0 rows.** (`pg_policies`.)
- **RLS state for the five tables — all `relrowsecurity = t`, `relforcerowsecurity = f`.** (`pg_class`.) RLS enabled,
  **not** forced, on `events`, `profiles`, `saves`, `scores`, `user_state`.

## Known limitations

1. **`auth`, Storage, and other schemas are out of scope.** This baseline is `public` only (plus the one global RLS
   event trigger). `auth.users` DDL is not included.
2. **Erasure inventory is not complete from this dump alone.** Account erasure definitely involves `auth.users`; a
   documented reader/writer inventory of external stores and platform logs is still owed before PR 4 (see below). No
   role/password/tenant material is present, by design.

## Reconciliation against existing `db/*.sql`

| Tracked file | Relationship to production | Detail |
|---|---|---|
| `db/saves.sql` | **Matches** | Columns (`device_id`, `work_id`, `created_at`), `PRIMARY KEY (device_id, work_id)`, index `saves_device_idx (device_id, created_at DESC)`, and `ENABLE ROW LEVEL SECURITY` are all identical to production. Complete and accurate. |
| `db/user_state-glossary-seen.sql` | **Supplements (applied)** | Its `ADD COLUMN glossary jsonb` / `seen jsonb` are present in production `user_state`. The ALTER has been applied. |
| `db/user_state-mastery.sql` | **Supplements (applied)** | Its `ADD COLUMN mastery jsonb` is present in production `user_state`. Applied. |

**No conflicts.** The gap is coverage, not correctness: there is **no** tracked `CREATE TABLE` for `profiles`,
`scores`, `events`, or the `user_state` base (`user_id`, `streak`, `updated_at`), and no tracked record of the
`rls_auto_enable` function, the `ensure_rls` event trigger, RLS enablement, policies, indexes, or grants. This
baseline is the first artifact to capture those. (Corroborates finding **INF-6b**.)

## What the baseline shows (answers to the security questions)

**Tables (5):** `events`, `profiles`, `saves`, `scores`, `user_state` — exactly the OpenAPI inventory; every column
matches the live PostgREST OpenAPI (semantic cross-check passed).

- **`profiles.device_id` unique?** **Yes** — `profiles_device_id_key UNIQUE (device_id)`. Caveat: `device_id` is
  **nullable**, so multiple rows with `NULL` device_id are permitted (Postgres unique allows multiple NULLs).
- **`profiles.user_id` → `auth.users`?** **No foreign key** (verified: FK count 0). `user_id uuid` is nullable with
  **no** FK and therefore **no `ON DELETE` behavior**. Deleting an auth user leaves `profiles` orphaned. PR 3/4 must add it.
- **`user_state.user_id` → `auth.users`?** **No foreign key** (verified). It is the primary key (`uuid NOT NULL`) but
  has **no** FK to `auth.users` and no cascade. Same orphaning risk.
- **FKs on `scores` / `saves` / `events`?** **None** (verified: 0 FKs in `public`). All key on `device_id text` with
  no FK to `profiles.device_id`. Erasure must delete from each table explicitly. `api/delete-account.js` currently
  deletes `profiles` + `scores` + `user_state` + the auth user but **not** `saves` or `events` — a real erasure gap.
- **RLS enabled?** **All 5 tables** (`relrowsecurity = t`). **Not** forced (`relforcerowsecurity = f`).
- **Policies?** **Zero** (verified via `pg_policies`). Access model = RLS-enabled + no policies ⇒ deny-all for
  `anon`/`authenticated`; only `service_role` (which bypasses RLS, used server-side with the secret key) can read/write.
- **Grants?** `USAGE` on schema `public` and `GRANT ALL ON TABLE` to `anon`, `authenticated`, `service_role` on all 5
  tables (+ the sequence and the function), plus default privileges for roles `postgres` and `supabase_admin`.
  **Security-relevant:** the `GRANT ALL` to `anon`/`authenticated` is broad and is neutralized *only* by RLS being
  enabled with no policies. If RLS were ever dropped/disabled on a table (or `ensure_rls`/`rls_auto_enable` failed to
  fire), `anon` would gain full table access.
- **`rls_auto_enable` + `ensure_rls`?** Function is `SECURITY DEFINER`, `SET search_path TO 'pg_catalog'`, `LANGUAGE
  plpgsql`, returns `event_trigger`. The `ensure_rls` event trigger (verified) fires it on `ddl_command_end` for
  CREATE TABLE / CREATE TABLE AS / SELECT INTO. **Caution:** `rls_auto_enable` wraps the `enable row level security`
  in an exception handler that only `RAISE LOG`s on failure — a table can be created with RLS silently *not* enabled.
  Security migrations must not rely on it (see roadmap PR 3/4 note).
- **Sequences / identity:** `events.id` is `GENERATED ALWAYS AS IDENTITY` (sequence `events_id_seq`). No other sequences.

**Minor, non-security:** `scores` carries two byte-identical indexes — `scores_board` and `scores_date_tier_total`
(both `btree (date, tier, total DESC)`). A future cleanup could drop one.

## External stores & account erasure — evidence-based scope

Corrected against repository evidence (do not call a store a deletion target without evidence):

- **`auth.users` — definitely part of erasure.** `api/delete-account.js` deletes the Supabase auth user.
- **Vercel Blob — not account data.** Used only to rehost **public artwork images** (`scripts/rehost-*-blob.mjs`,
  `harvest-aic-images.mjs`; keys like `aic/<id>.jpg`, `harvard/<id>.jpg`). Not keyed to an account or device.
- **Redis/Upstash — not account-linked.** `api/report.js` stores **anonymous** error reports (`gesso:reports`, record
  = note/user-agent/timestamp) and per-IP hourly **rate-limit** keys (`gesso:rl:<ip>`). Keyed by IP, not account/device.
- **Supabase Storage — no usage found.** No reader/writer in the repository.
- **Still owed before PR 4:** a documented reader/writer inventory of external stores and platform logs. Anonymous
  report / IP-retention is a **separate privacy-retention** question, not automatically account erasure.
