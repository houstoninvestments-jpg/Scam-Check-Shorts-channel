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
  console.log(`::error title=Supabase setup::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 1500)}`);
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

// One full Family Pass purchase in Stripe TEST mode: pay with Stripe's test card on the real checkout page,
// check the webhook recorded it and the pass unlocks, refund it through our refund function, check access ends,
// then delete the test buyer. The service key is only held in memory and masked in the log.
async function purchaseTest() {
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const link = cfg.familyPass.stripePaymentLink;
  if (!/^https:\/\/buy\.stripe\.com\/test_/.test(link)) fail(`payment link is not a Stripe TEST link: ${link || "none"}`);
  const pub = cfg.supabase.publishableKey;
  const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
  const service = (keys.find((k) => k.name === "service_role") ?? keys.find((k) => k.type === "secret"))?.api_key;
  if (!service) fail("no service key found");
  console.log(`::add-mask::${service}`);
  const admin = { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" };
  const email = `son-pass-test+${Date.now()}@example.com`;
  const step = (t, m) => note(`Purchase test: ${t}`, m);

  // 1. Pay on Stripe's hosted checkout page with the 4242 test card.
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
  try {
    const p = await browser.newPage();
    try {
    // Stripe's checkout page keeps talking to its servers, so wait for the form, not for silence.
    await p.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector("#email", { timeout: 45000 });
    await p.fill("#email", email);
    // The card form can sit on the page or inside Stripe's embedded payment frame; look in every frame.
    const inFrames = async (fn) => {
      for (const f of p.frames()) if (await fn(f).catch(() => false)) return true;
      return false;
    };
    const cardInput = (f) => f.locator('#cardNumber, input[name="number"], input[name="cardnumber"]').first();
    if (!(await inFrames((f) => cardInput(f).isVisible()))) {
      // Stripe's accordion button is covered by its styled label: click it directly.
      const acc = p.locator('[data-testid="card-accordion-item-button"]').first();
      if (await acc.count()) await acc.click({ force: true }).catch(() => acc.dispatchEvent("click"));
      await p.waitForTimeout(2000);
    }
    if (!(await inFrames((f) => cardInput(f).isVisible()))) {
      await inFrames(async (f) => {
        for (const sel of ['[data-testid="card-accordion-item-button"]', 'button:has-text("Card")', '[role="radio"]:has-text("Card")', 'label:has-text("Card")', "text=Card"]) {
          const el = f.locator(sel).first();
          if (await el.isVisible().catch(() => false)) {
            await el.click();
            return true;
          }
        }
        return false;
      });
      await p.waitForTimeout(2500);
    }
    const fillAny = async (sels, value) => {
      const ok = await inFrames(async (f) => {
        for (const sel of sels) {
          const el = f.locator(sel).first();
          if (await el.isVisible().catch(() => false)) {
            await el.fill(value);
            return true;
          }
        }
        return false;
      });
      if (!ok) throw new Error(`no field for ${sels[0]}`);
    };
    await fillAny(['#cardNumber', 'input[name="number"]', 'input[name="cardnumber"]'], "4242 4242 4242 4242");
    await fillAny(['#cardExpiry', 'input[name="expiry"]', 'input[name="exp-date"]'], "12 / 34");
    await fillAny(['#cardCvc', 'input[name="cvc"]'], "123");
    await fillAny(['#billingName', 'input[name="name"]', 'input[name="billingName"]'], "Test Buyer").catch(() => {});
    await fillAny(['#billingPostalCode', 'input[name="postalCode"]', 'input[name="postal"]'], "94107").catch(() => {});
    // "Save my info" (Stripe Link) asks for a phone number when ticked: leave it off.
    const save = p.locator("#enableStripePass");
    if (await save.isChecked().catch(() => false)) await save.click({ force: true }).catch(() => save.uncheck({ force: true }));
    await p.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first().click();
    await p.waitForURL((u) => !u.hostname.endsWith("stripe.com"), { timeout: 60000 });
    step("paid", `test card accepted on Stripe's checkout page; sent back to ${new URL(p.url()).origin}${new URL(p.url()).pathname}`);
    } catch (e) {
      // No screenshots reach us from here, so say what the page showed.
      const fields = [];
      for (const f of p.frames()) {
        const names = await f.$$eval("input, select, button, [role=radio]", (els) => els.map((e) => e.getAttribute("data-testid") || e.id || e.getAttribute("name") || e.textContent?.trim()).filter(Boolean).slice(0, 25)).catch(() => []);
        fields.push(`[${new URL(f.url() || "about:blank").hostname}: ${names.join(",")}]`);
      }
      const body = (await p.innerText("body").catch(() => "")).replace(/\s+/g, " ");
      const errors = await p.$$eval('[role="alert"], .FieldError, [class*="Error"]', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 8)).catch(() => []);
      const sessions = await (await fetch("https://api.stripe.com/v1/checkout/sessions?limit=3", { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } })).json().catch(() => ({}));
      const recent = (sessions.data ?? []).map((x) => `${x.status}/${x.payment_status}`).join(",");
      const text = `errors: ${errors.join(" | ") || "none"} | Stripe sessions: ${recent || "none"} | end of page: ${body.slice(-500)}`;
      fail(`checkout step failed: ${String(e?.message ?? e).slice(0, 200)} | page: ${p.url()} | fields: ${fields.join(",")} | text: ${text}`);
    }
  } finally {
    await browser.close();
  }

  // 2. The webhook should record the purchase and create the buyer's account within a few seconds.
  let row;
  for (let i = 0; i < 20 && !row?.user_id; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    [row] = await sql(`select id, user_id, amount_cents, livemode, stripe_payment_intent, refunded_at from public.purchases where email = '${email}'`);
  }
  if (!row) fail("the webhook never recorded the purchase");
  step("recorded", `purchase saved: $${row.amount_cents / 100}, test mode: ${!row.livemode}, account linked: ${!!row.user_id}`);
  if (!row.user_id) fail("purchase saved but no account was linked to it (the buyer would not get access)");

  try {
    // 3. Sign in as the buyer (a one-time link made with the admin key, used straight away).
    const gen = await (await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: "POST", headers: admin, body: JSON.stringify({ type: "magiclink", email }) })).json();
    const tokenHash = gen.hashed_token ?? gen.properties?.hashed_token;
    const session = await (await fetch(`${URL_}/auth/v1/verify`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }) })).json();
    if (!session.access_token) fail(`could not sign in as the test buyer: ${JSON.stringify(session).slice(0, 200)}`);
    console.log(`::add-mask::${session.access_token}`);
    const buyer = { apikey: pub, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" };
    const rpc = async (fn, body = {}) => {
      const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: buyer, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    // 4. The pass unlocks: has_pass is true and a family group can be started.
    const before = await rpc("has_pass");
    const fam = await rpc("create_family", { family_name: "Test family" });
    if (before.body !== true || fam.status !== 200) fail(`pass did not unlock (has_pass ${JSON.stringify(before.body)}, create_family ${fam.status})`);
    step("unlocked", "the buyer has the pass and could start a family group");

    // 5. Refund through our own refund function, as the buyer would from the site.
    const ref = await fetch(`${URL_}/functions/v1/family-refund`, { method: "POST", headers: buyer, body: "{}" });
    const refBody = await ref.json().catch(() => ({}));
    if (!ref.ok) fail(`refund function said ${ref.status}: ${JSON.stringify(refBody)}`);
    const after = await rpc("has_pass");
    const [r2] = await sql(`select refunded_at from public.purchases where id = ${row.id}`);
    const stripeRefunds = await (await fetch(`https://api.stripe.com/v1/refunds?payment_intent=${row.stripe_payment_intent}`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } })).json();
    const refund = stripeRefunds.data?.[0];
    if (after.body !== false || !r2.refunded_at || !refund) fail(`refund incomplete (has_pass ${JSON.stringify(after.body)}, refunded_at ${r2.refunded_at}, Stripe refund ${refund?.status})`);
    step("refunded", `Stripe refund ${refund.status} for $${refund.amount / 100}; access ended (has_pass false)`);
  } finally {
    // 6. Clean up: the test buyer's account (its family goes with it) and the purchase row.
    await fetch(`${URL_}/auth/v1/admin/users/${row.user_id}`, { method: "DELETE", headers: admin });
    await sql(`delete from public.purchases where email = '${email}'`);
    const [left] = await sql(`select (select count(*) from public.purchases where email like 'son-pass-test+%')::int as p, (select count(*) from auth.users where email like 'son-pass-test+%')::int as u`);
    step("cleanup", `test buyer and purchase deleted (left: ${left.p} purchases, ${left.u} accounts)`);
  }
}

try {
  if (mode === "setup") await setup();
  else if (mode === "purchase-test") await purchaseTest();
  else if (mode === "functions") await functionsReport();
  else if (mode === "test") await test();
  else if (mode === "stripe") await stripe();
  else fail(`unknown mode ${mode}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "ok=true\n");
} catch (e) {
  fail(String(e?.message ?? e));
}
