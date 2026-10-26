// One-off Supabase setup for the email signup and the Family Pass, run from .github/workflows/supabase-setup.yml.
// Uses SUPABASE_ACCESS_TOKEN (short-lived, setup only). The daily job never uses it.
// Never prints a secret: only the publishable key, which is public by design.
//
//   npx tsx scripts/supabase-setup.mjs setup    apply migrations, check row level security, read the publishable key, set function settings
//   npx tsx scripts/supabase-setup.mjs test     real signup on the live site, check the browser can't read it, delete the test rows
//   npx tsx scripts/supabase-setup.mjs stripe   Stripe TEST setup; the key and webhook secret go straight into Supabase
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const REF = process.env.PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API = "https://api.supabase.com";
const URL_ = `https://${REF}.supabase.co`;
const SITE = process.env.SITE_BASE_URL || "https://scamornot.pages.dev";
const mode = process.argv[2];

const note = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 900)}`);
const fail = (msg) => {
  console.log(`::error title=Supabase setup::${msg}`);
  process.exit(1);
};
if (!REF || !TOKEN) fail("PROJECT_REF and SUPABASE_ACCESS_TOKEN are required");

async function mgmt(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });

// Check the endpoints against Supabase's published API description before using them.
async function checkSpec() {
  const spec = await (await fetch(`${API}/api/v1-json`)).json();
  const need = [
    ["post", "/v1/projects/{ref}/database/query"],
    ["get", "/v1/projects/{ref}/api-keys"],
    ["post", "/v1/projects/{ref}/secrets"],
    ["get", "/v1/projects/{ref}/functions"],
  ];
  const missing = need.filter(([m, p]) => !spec.paths?.[p]?.[m]);
  if (missing.length) fail(`Supabase API description lacks: ${missing.map((x) => x.join(" ")).join(", ")}`);
  note("API check", "every Management API call used here is in Supabase's published API description");
}

async function setSecrets(pairs) {
  await mgmt("POST", `/v1/projects/${REF}/secrets`, Object.entries(pairs).map(([name, value]) => ({ name, value })));
}

async function setup() {
  await checkSpec();

  // 1. Migrations, in order, once each. Applied ones are remembered in a small table of our own.
  await sql("create table if not exists public._son_migrations (name text primary key, applied_at timestamptz not null default now()); alter table public._son_migrations enable row level security; revoke all on public._son_migrations from anon, authenticated;");
  const done = new Set((await sql("select name from public._son_migrations")).map((r) => r.name));
  for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await sql(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await sql(`insert into public._son_migrations(name) values ('${f.replace(/'/g, "''")}')`);
    note("Migration applied", f);
  }

  // 2. Lockdown checks: RLS on every table, no browser read rights on the signup list.
  const tables = await sql("select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename");
  const noRls = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  if (noRls.length) fail(`row level security is OFF on: ${noRls.join(", ")}`);
  note("Row level security", `on for all ${tables.length} tables: ${tables.map((t) => t.tablename).join(", ")}`);
  const anon = await sql("select privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name = 'round_signups'");
  const cols = await sql("select distinct privilege_type from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name = 'round_signups'");
  const rights = [...new Set([...anon, ...cols].map((r) => r.privilege_type))];
  if (rights.some((r) => r !== "INSERT")) fail(`browser role has more than insert on round_signups: ${rights.join(", ")}`);
  const policies = await sql("select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'round_signups'");
  if (policies.some((p) => p.cmd !== "INSERT")) fail(`round_signups has a non-insert policy: ${JSON.stringify(policies)}`);
  note("Signup list", `browser can only add an address (rights: ${rights.join(", ") || "none"}; policies: ${policies.map((p) => `${p.policyname} (${p.cmd})`).join(", ")})`);

  // 3. The publishable key: public by design, it goes in config/channel.json for the site.
  const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=false`);
  const pub = keys.find((k) => k.type === "publishable") ?? keys.find((k) => k.name === "anon");
  if (!pub?.api_key) fail("no publishable key found");
  if (!/^sb_publishable_/.test(pub.api_key)) note("Key type", "only the older anon key exists; it is public by design but looks like a token to scanners");
  const cfgFile = "config/channel.json";
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  cfg.supabase = { url: URL_, publishableKey: pub.api_key };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  note("Publishable key", `${pub.type ?? pub.name} key saved to config (public, safe for the browser)`);

  // 4. Settings the edge functions read. Stripe keys come later; Family Pass stays off.
  await setSecrets({ SITE_BASE_URL: SITE, SITE_ORIGIN: SITE, FAMILY_PASS_LIVE: "0", FAMILY_PASS_MAX_MEMBERS: String(cfg.familyPass.maxMembers), FAMILY_PASS_REFUND_DAYS: String(cfg.familyPass.refundDays) });
  note("Function settings", "SITE_BASE_URL, SITE_ORIGIN, FAMILY_PASS_LIVE=0, FAMILY_PASS_MAX_MEMBERS, FAMILY_PASS_REFUND_DAYS set");
}

async function functionsReport() {
  const fns = await mgmt("GET", `/v1/projects/${REF}/functions`);
  note("Edge functions", fns.map((f) => `${f.slug} (${f.status}, sign-in required: ${f.verify_jwt})`).join("; "));
}

async function test() {
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const key = cfg.supabase.publishableKey;
  const stamp = Date.now();
  const emails = [`son-signup-test+home${stamp}@example.com`, `son-signup-test+round${stamp}@example.com`];
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
  try {
    for (const [i, page] of [`${SITE}/`, `${SITE}/round/`].entries()) {
      const p = await browser.newPage();
      await p.goto(page, { waitUntil: "networkidle" });
      await p.waitForSelector("#signup:not(.hidden)", { timeout: 20000 });
      await p.fill("#signup-form input[name=email]", emails[i]);
      await p.click("#signup-form button[type=submit]");
      await p.waitForFunction(() => /You're in/.test(document.getElementById("signup-msg")?.textContent ?? ""), null, { timeout: 20000 });
      note("Live signup", `${page}: form shown, address saved, thank-you message shown`);
      await p.close();
    }
  } finally {
    await browser.close();
  }

  const saved = await sql(`select email, source from public.round_signups where email like 'son-signup-test+%${stamp}@example.com'`);
  if (saved.length !== 2) fail(`expected 2 test rows, found ${saved.length}`);
  note("Saved rows", saved.map((r) => `${r.source}`).join(", "));

  // What the browser sees: reading, changing or deleting the list must all fail or return nothing.
  const h = { apikey: key, authorization: `Bearer ${key}` };
  const read = await fetch(`${URL_}/rest/v1/round_signups?select=email`, { headers: h });
  const readBody = await read.text();
  const leaked = read.ok && readBody.trim() !== "[]";
  const del = await fetch(`${URL_}/rest/v1/round_signups?email=like.son-signup-test*`, { method: "DELETE", headers: { ...h, prefer: "return=representation" } });
  const delBody = await del.text();
  if (leaked || (del.ok && delBody.trim() !== "[]")) fail(`browser could read or delete signups (read ${read.status}, delete ${del.status})`);
  note("Browser lockout", `read refused (${read.status}), delete refused (${del.status})`);

  await sql(`delete from public.round_signups where email like 'son-signup-test+%${stamp}@example.com'`);
  const left = await sql(`select count(*)::int as n from public.round_signups where email like 'son-signup-test+%'`);
  if (left[0].n !== 0) fail(`test rows still there: ${left[0].n}`);
  note("Cleanup", "test rows deleted; none left");
}

async function stripe() {
  // Family Pass, Stripe TEST mode only. The secret key and the webhook signing secret go straight into
  // Supabase; neither is printed. The payment link is public and goes in config.
  const { stripeSetup } = await import("../src/site/stripe-setup.ts");
  const r = await stripeSetup();
  await setSecrets({ STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: r.webhookSecret });
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  cfg.familyPass.stripePaymentLink = r.paymentLink;
  writeFileSync("config/channel.json", JSON.stringify(cfg, null, 2) + "\n");
  note("Stripe test mode", `product, $${cfg.familyPass.priceUsd} price, payment link and webhook created; key and webhook secret stored in Supabase; Family Pass still off`);
}

try {
  if (mode === "setup") await setup();
  else if (mode === "functions") await functionsReport();
  else if (mode === "test") await test();
  else if (mode === "stripe") await stripe();
  else fail(`unknown mode ${mode}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "ok=true\n");
} catch (e) {
  fail(String(e?.message ?? e));
}
