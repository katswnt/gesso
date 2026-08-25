#!/usr/bin/env node
// Offline gate for the captured production public-schema baseline.
// Verifies the schema shape, security posture, and catalog-derived global objects the baseline claims,
// and that no row data / credentials / ownership leaked in. It NEVER connects to production and NEVER
// modifies files. Read-only. Run: node scripts/check-production-schema-baseline.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SQL_PATH = new URL("../db/production-schema-baseline.sql", import.meta.url);
const MD_PATH  = new URL("../db/production-schema-baseline.md",  import.meta.url);

const fails = [];
const fail = m => fails.push(m);
const need = (cond, m) => { if (!cond) fail(m); };

let sql = "", md = "";
try { sql = readFileSync(SQL_PATH, "utf8"); } catch { fail("missing db/production-schema-baseline.sql"); }
try { md  = readFileSync(MD_PATH,  "utf8"); } catch { fail("missing db/production-schema-baseline.md"); }

if (sql) {
  // ---- 1. Exact table set + per-table CREATE TABLE blocks --------------------
  const EXPECTED = {
    events: {
      cols: ["id","ts","device_id","event","props"],
      // important type / nullability / default assertions (substring within the block)
      defs: ["id bigint NOT NULL", "ts timestamp with time zone DEFAULT now() NOT NULL",
             "device_id text NOT NULL", "event text NOT NULL", "props jsonb DEFAULT '{}'::jsonb NOT NULL"],
      pk: "PRIMARY KEY (id)",
    },
    profiles: {
      cols: ["id","device_id","user_id","name","color","created_at"],
      defs: ["id uuid DEFAULT gen_random_uuid() NOT NULL", "device_id text", "user_id uuid",
             "name text", "color text", "created_at timestamp with time zone DEFAULT now()"],
      pk: "PRIMARY KEY (id)",
    },
    saves: {
      cols: ["device_id","work_id","created_at"],
      defs: ["device_id text NOT NULL", "work_id text NOT NULL",
             "created_at timestamp with time zone DEFAULT now() NOT NULL"],
      pk: "PRIMARY KEY (device_id, work_id)",
    },
    scores: {
      cols: ["device_id","date","tier","total","perfects","masterpieces","rounds","updated_at","cold"],
      defs: ["device_id text NOT NULL", "date date NOT NULL", "tier text NOT NULL", "total integer NOT NULL",
             "perfects integer DEFAULT 0", "masterpieces integer DEFAULT 0", "rounds jsonb",
             "updated_at timestamp with time zone DEFAULT now()", "cold boolean DEFAULT false NOT NULL"],
      pk: "PRIMARY KEY (device_id, date, tier)",
    },
    user_state: {
      cols: ["user_id","streak","updated_at","mastery","glossary","seen"],
      defs: ["user_id uuid NOT NULL", "streak jsonb", "updated_at timestamp with time zone DEFAULT now()",
             "mastery jsonb", "glossary jsonb", "seen jsonb"],
      pk: "PRIMARY KEY (user_id)",
    },
  };
  const tables = Object.keys(EXPECTED);

  // exactly these tables, no more/less
  const foundTables = [...sql.matchAll(/CREATE TABLE public\.(\w+)\s*\(/g)].map(m => m[1]).sort();
  const want = [...tables].sort();
  if (JSON.stringify(foundTables) !== JSON.stringify(want))
    fail(`table set mismatch: expected [${want}], found [${foundTables}]`);

  for (const [t, spec] of Object.entries(EXPECTED)) {
    const m = sql.match(new RegExp(`CREATE TABLE public\\.${t}\\s*\\(([\\s\\S]*?)\\);`, "m"));
    if (!m) { fail(`expected table absent: public.${t}`); continue; }
    const block = m[1];
    for (const c of spec.cols)
      if (!new RegExp(`(^|,|\\()\\s*${c}\\s`, "m").test(block)) fail(`table ${t}: expected column missing: ${c}`);
    for (const d of spec.defs)
      if (!block.includes(d)) fail(`table ${t}: expected column definition missing/changed: "${d}"`);

    // ---- 2. Table-SCOPED primary key (must belong to THIS table) -------------
    const pkRe = new RegExp(`ALTER TABLE ONLY public\\.${t}\\s+ADD CONSTRAINT \\w+ ${spec.pk.replace(/[()]/g, m => "\\"+m)}`);
    if (!pkRe.test(sql)) fail(`table ${t}: table-scoped ${spec.pk} not found (must be attached to public.${t})`);
  }

  // profiles UNIQUE(device_id) must belong to profiles specifically
  if (!/ALTER TABLE ONLY public\.profiles\s+ADD CONSTRAINT profiles_device_id_key UNIQUE \(device_id\)/.test(sql))
    fail("profiles_device_id_key UNIQUE (device_id) not scoped to public.profiles");

  // ---- 3. Indexes: exact names + definitions --------------------------------
  const INDEXES = [
    ["events_device",          "CREATE INDEX events_device ON public.events USING btree (device_id)"],
    ["events_event_ts",        "CREATE INDEX events_event_ts ON public.events USING btree (event, ts)"],
    ["saves_device_idx",       "CREATE INDEX saves_device_idx ON public.saves USING btree (device_id, created_at DESC)"],
    ["scores_board",           "CREATE INDEX scores_board ON public.scores USING btree (date, tier, total DESC)"],
    ["scores_date_tier_total", "CREATE INDEX scores_date_tier_total ON public.scores USING btree (date, tier, total DESC)"],
    ["scores_device",          "CREATE INDEX scores_device ON public.scores USING btree (device_id)"],
  ];
  const foundIndexes = [...sql.matchAll(/^CREATE INDEX (\w+) /gm)].map(m => m[1]).sort();
  const expectedIndexes = INDEXES.map(([name]) => name).sort();
  if (JSON.stringify(foundIndexes) !== JSON.stringify(expectedIndexes))
    fail(`index set mismatch: expected [${expectedIndexes}], found [${foundIndexes}]`);
  for (const [name, def] of INDEXES) if (!sql.includes(def)) fail(`index missing/changed: ${name}`);

  // ---- 4. RLS: exactly 5 ENABLE, no FORCE -----------------------------------
  const rlsEnables = (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
  need(rlsEnables === 5, `expected exactly 5 RLS enable statements, found ${rlsEnables}`);
  for (const t of tables)
    if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql)) fail(`table ${t}: RLS enablement missing`);
  if (/FORCE ROW LEVEL SECURITY/i.test(sql)) fail("FORCE ROW LEVEL SECURITY present but production has none");

  // ---- 5. Verified counts: 0 policies, 0 FKs --------------------------------
  const policies = (sql.match(/CREATE POLICY/gi) || []).length;
  need(policies === 0, `expected 0 policies (production has none), found ${policies} CREATE POLICY`);
  const fks = (sql.match(/\bFOREIGN KEY\b/gi) || []).length + (sql.match(/\bREFERENCES\s+\w/gi) || []).length;
  need(fks === 0, `expected 0 foreign keys (production has none), found ${fks} FK token(s)`);
  const tableTriggers = (sql.match(/^CREATE TRIGGER\s/gim) || []).length;
  need(tableTriggers === 0, `expected 0 non-internal table triggers (production has none), found ${tableTriggers}`);

  // ---- 6. Security function + global event trigger --------------------------
  const fnRe = /CREATE FUNCTION public\.rls_auto_enable\(\) RETURNS event_trigger[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path TO 'pg_catalog'/;
  if (!fnRe.test(sql)) fail("rls_auto_enable() must be SECURITY DEFINER with search_path pinned to 'pg_catalog'");
  const etRe = /CREATE EVENT TRIGGER ensure_rls ON ddl_command_end[\s\S]*?WHEN TAG IN \('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'\)[\s\S]*?EXECUTE FUNCTION public\.rls_auto_enable\(\);/;
  if (!etRe.test(sql)) fail("verified global event trigger `ensure_rls` (ddl_command_end -> public.rls_auto_enable()) missing from baseline");

  // ---- 7. Grants needed to reproduce the security posture -------------------
  const apiRoles = ["anon","authenticated","service_role"];
  for (const r of apiRoles)
    if (!new RegExp(`GRANT USAGE ON SCHEMA public TO ${r};`).test(sql)) fail(`schema USAGE grant to ${r} missing`);
  for (const t of tables)
    for (const r of apiRoles)
      if (!new RegExp(`GRANT ALL ON TABLE public\\.${t} TO ${r};`).test(sql)) fail(`table grant to ${r} missing: ${t}`);
  for (const r of apiRoles) {
    if (!new RegExp(`GRANT ALL ON FUNCTION public\\.rls_auto_enable\\(\\) TO ${r};`).test(sql))
      fail(`rls_auto_enable() grant to ${r} missing`);
    if (!new RegExp(`GRANT ALL ON SEQUENCE public\\.events_id_seq TO ${r};`).test(sql))
      fail(`events_id_seq grant to ${r} missing`);
  }

  // ---- 8. Identity / sequence for events.id ---------------------------------
  if (!/ALTER TABLE public\.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY/.test(sql))
    fail("events.id GENERATED ALWAYS AS IDENTITY missing");
  if (!/SEQUENCE NAME public\.events_id_seq/.test(sql)) fail("events_id_seq identity sequence missing");

  // ---- 9. Forbidden content: row data, ownership, session auth, credentials --
  const FORBIDDEN = [
    [/^COPY\s/m,                        "row data (COPY)"],
    [/\bINSERT\s+INTO\b/i,              "row data (INSERT INTO)"],
    [/\bOWNER\s+TO\b/i,                 "ownership clause (OWNER TO)"],
    [/\bSESSION\s+AUTHORIZATION\b/i,    "session-authorization clause"],
    [/sb_secret_/,                      "secret API key (sb_secret_)"],
    [/sb_publishable_/,                 "publishable key (sb_publishable_)"],
    [/\bsbp_[A-Za-z0-9]{20,}/,          "personal access token (sbp_)"],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
    [/postgres(ql)?:\/\/[^\s]/i,        "connection string (postgres://)"],
    [/PGPASSWORD/,                       "PGPASSWORD reference"],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email-like value"],
    [/^\\(un)?restrict\b/m,             "psql restore-guard meta-command (should be stripped)"],
  ];
  for (const [re, label] of FORBIDDEN) if (re.test(sql)) fail(`forbidden content present in .sql: ${label}`);
}

// ---- 10. Markdown checksum must equal the SQL's actual SHA-256 --------------
if (sql && md) {
  const actual = createHash("sha256").update(readFileSync(SQL_PATH)).digest("hex");
  const m = md.match(/\b([0-9a-f]{64})\b/);
  if (!m) fail("no SHA-256 found in db/production-schema-baseline.md");
  else if (m[1] !== actual) fail(`checksum mismatch: .md says ${m[1].slice(0,12)}…, .sql is ${actual.slice(0,12)}…`);
}

// ---- 11. Scan the .md for REAL credential values (not env names/placeholders)
if (md) {
  const MD_SECRETS = [
    [/\bsbp_[A-Za-z0-9_-]{30,}\b/,       "real sbp_ access token value"],
    [/\bsb_secret_[A-Za-z0-9_-]{10,}\b/, "real sb_secret_ key value"],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, "real JWT value"],
    [/postgres(ql)?:\/\/[^\s:@/]+:[^\s:@/]+@/i, "postgres URL containing a password"],
  ];
  for (const [re, label] of MD_SECRETS) if (re.test(md)) fail(`credential value in .md: ${label}`);
}

if (fails.length) {
  console.error(`❌ FAIL — production-schema-baseline (${fails.length} problem${fails.length>1?"s":""}):`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log("✅ PASS — production-schema-baseline: 5 tables (scoped PKs/full column definitions), exact 6 indexes, 5 RLS enables (no FORCE), 0 policies/FKs/table triggers, SECURITY DEFINER fn + verified ensure_rls event trigger, API-role schema/table/function/sequence grants, events.id identity; no row data/credentials/ownership; checksum matches");
