// One-off: take the Family Pass live in the "Scam or Not" Stripe account. Run from .github/workflows/stripe-live.yml.
// Never prints a key or a secret. Never charges anyone.
//
//   npx tsx scripts/stripe-live.mjs check      which account each key belongs to, whether it can take payments, payouts status, our test objects
//   npx tsx scripts/stripe-live.mjs tidy-test  remove the Family Pass test objects we made in a different account (only clearly ours)
//   npx tsx scripts/stripe-live.mjs setup      live product, $19 price, payment link, webhook; secrets into Supabase; signed sample event check
//   npx tsx scripts/stripe-live.mjs verify     the live checkout page loads at $19 (nothing is paid)
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const LIVE = (process.env.STRIPE_LIVE_SECRET_KEY ?? "").trim();
const TEST = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const REF = process.env.PROJECT_REF;
const SUPA = `https://${REF}.supabase.co`;
const HOOK_URL = `${SUPA}/functions/v1/stripe-webhook`;
const SITE = "https://scamornotdaily.com";
const PRODUCT = "Scam or Not Family Pass";
const mode = process.argv[2];

const note = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 1200)}`);
const fail = (msg) => {
  console.log(`::error title=Stripe live::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 1500)}`);
  process.exit(1);
};

async function stripe(key, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
}
// Stripe's own words when something is refused, including which permission a restricted key lacks.
const why = (r) => `${r.status} ${r.j.error?.type ?? ""}: ${r.j.error?.message ?? JSON.stringify(r.j).slice(0, 200)}`;

async function supa(method, path, body) {
  const res = await fetch(`https://api.supabase.com${path}`, { method, headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { ok: res.ok, status: res.status, j: text ? JSON.parse(text) : {} };
}
const sql = async (query) => {
  const r = await supa("POST", `/v1/projects/${REF}/database/query`, { query });
  if (!r.ok) throw new Error(`sql ${r.status}`);
  return r.j;
};

function accountName(a) {
  return a.business_profile?.name || a.settings?.dashboard?.display_name || a.company?.name || "";
}

async function liveAccount() {
  if (!/^(rk|sk)_live_/.test(LIVE)) fail("STRIPE_LIVE_SECRET_KEY is missing or is not a live key (rk_live_ or sk_live_)");
  const r = await stripe(LIVE, "GET", "account");
  if (!r.ok) fail(`could not read the account with the live key: ${why(r)}`);
  return r.j;
}

// ---------- check ----------
async function check() {
  const a = await liveAccount();
  const name = accountName(a);
  const req = a.requirements ?? {};
  note("Live account", `${a.id}: business name "${name}", charges enabled: ${a.charges_enabled}, payouts enabled: ${a.payouts_enabled}, details submitted: ${a.details_submitted}`);
  note("Live account to-do", `currently due: ${(req.currently_due ?? []).join(", ") || "nothing"}; past due: ${(req.past_due ?? []).join(", ") || "nothing"}; pending checks: ${(req.pending_verification ?? []).join(", ") || "none"}; due later: ${(req.eventually_due ?? []).join(", ") || "nothing"}; disabled reason: ${req.disabled_reason ?? "none"}`);
  const bank = await stripe(LIVE, "GET", `accounts/${a.id}/external_accounts?limit=3`);
  note("Payout bank", bank.ok ? `${(bank.j.data ?? []).length ? (bank.j.data ?? []).map((b) => `${b.object} ending ${b.last4} (${b.status ?? "added"})`).join(", ") : "none added"}` : `could not read (${why(bank)}); payouts enabled: ${a.payouts_enabled}`);
  const okName = /^scam or not$/i.test(name.trim());
  if (!okName || !a.charges_enabled) note("STOP", `business name ok: ${okName}, charges enabled: ${a.charges_enabled}`);

  if (TEST) {
    const t = await stripe(TEST, "GET", "account");
    const same = t.ok && t.j.id === a.id;
    note("Test key account", t.ok ? `${t.j.id} "${accountName(t.j)}" -> ${same ? "same account as the live key" : "a DIFFERENT account"}` : `could not read (${why(t)})`);
    const products = await stripe(TEST, "GET", "products?limit=100");
    const ours = (products.j.data ?? []).filter((p) => p.name === PRODUCT);
    const links = await stripe(TEST, "GET", "payment_links?limit=100");
    const hooks = await stripe(TEST, "GET", "webhook_endpoints?limit=100");
    note(
      "Our test objects",
      `products: ${ours.map((p) => `${p.id} "${p.name}" active ${p.active}`).join("; ") || "none"} | payment links: ${(links.j.data ?? []).map((l) => `${l.id} ${l.url} active ${l.active}`).join("; ") || "none"} | webhooks: ${(hooks.j.data ?? []).map((h) => `${h.id} ${h.url}`).join("; ") || "none"}`,
    );
  }
}

// ---------- tidy-test ----------
async function tidyTest() {
  const a = await liveAccount();
  const t = await stripe(TEST, "GET", "account");
  if (!t.ok) fail(`test key unreadable: ${why(t)}`);
  if (t.j.id === a.id) {
    note("Tidy", "the test key is the Scam or Not account itself; nothing to remove");
    return;
  }
  const done = [];
  // Only what is clearly ours: the webhook pointing at our function, links that sell our product, our product.
  const hooks = await stripe(TEST, "GET", "webhook_endpoints?limit=100");
  for (const h of (hooks.j.data ?? []).filter((h) => h.url === HOOK_URL)) {
    const r = await stripe(TEST, "DELETE", `webhook_endpoints/${h.id}`);
    done.push(`webhook ${h.id}: ${r.ok ? "deleted" : why(r)}`);
  }
  const products = (await stripe(TEST, "GET", "products?limit=100")).j.data ?? [];
  const ours = products.filter((p) => p.name === PRODUCT);
  const prices = [];
  for (const p of ours) for (const pr of (await stripe(TEST, "GET", `prices?product=${p.id}&limit=100`)).j.data ?? []) prices.push(pr.id);
  for (const l of (await stripe(TEST, "GET", "payment_links?limit=100")).j.data ?? []) {
    const items = (await stripe(TEST, "GET", `payment_links/${l.id}/line_items?limit=10`)).j.data ?? [];
    if (!items.some((i) => prices.includes(i.price?.id))) continue;
    // Payment links can't be deleted; switching them off is the closest Stripe allows.
    const r = await stripe(TEST, "POST", `payment_links/${l.id}`, { active: "false" });
    done.push(`payment link ${l.id}: ${r.ok ? "switched off" : why(r)}`);
  }
  for (const id of prices) await stripe(TEST, "POST", `prices/${id}`, { active: "false" });
  for (const p of ours) {
    // A product with prices can't be deleted in Stripe; archiving hides it.
    const r = await stripe(TEST, "POST", `products/${p.id}`, { active: "false" });
    done.push(`product ${p.id}: ${r.ok ? "archived" : why(r)}`);
  }
  note("Tidy", done.join("; ") || "nothing of ours found");
}

// ---------- setup ----------
async function setup() {
  const a = await liveAccount();
  if (!/^scam or not$/i.test(accountName(a).trim()) || !a.charges_enabled) fail(`not the right account or it can't take payments yet ("${accountName(a)}", charges enabled ${a.charges_enabled})`);
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const cents = String(cfg.familyPass.priceUsd * 100);

  // Product and price (reused if a previous run made them).
  let product = ((await stripe(LIVE, "GET", "products?limit=100")).j.data ?? []).find((p) => p.name === PRODUCT && p.active);
  if (!product) {
    const r = await stripe(LIVE, "POST", "products", { name: PRODUCT, description: `Past rounds, a family group of up to ${cfg.familyPass.maxMembers} with streaks, and big text.`, "metadata[made_by]": "scam-or-not-setup" });
    if (!r.ok) fail(`creating the product was refused: ${why(r)}`);
    product = r.j;
  }
  let price = ((await stripe(LIVE, "GET", `prices?product=${product.id}&active=true&limit=10`)).j.data ?? []).find((p) => p.unit_amount === Number(cents) && p.currency === "usd" && !p.recurring);
  if (!price) {
    const r = await stripe(LIVE, "POST", "prices", { product: product.id, unit_amount: cents, currency: "usd" });
    if (!r.ok) fail(`creating the price was refused: ${why(r)}`);
    price = r.j;
  }
  note("Live product", `${product.id} "${PRODUCT}" at $${Number(price.unit_amount) / 100} one time`);

  // Payment link that returns buyers to our domain.
  const ret = `${SITE}/family/app/?welcome=1`;
  let link;
  for (const l of (await stripe(LIVE, "GET", "payment_links?active=true&limit=100")).j.data ?? []) {
    const items = (await stripe(LIVE, "GET", `payment_links/${l.id}/line_items?limit=5`)).j.data ?? [];
    if (items.some((i) => i.price?.id === price.id) && l.after_completion?.redirect?.url === ret) link = l;
  }
  if (!link) {
    const r = await stripe(LIVE, "POST", "payment_links", { "line_items[0][price]": price.id, "line_items[0][quantity]": "1", "after_completion[type]": "redirect", "after_completion[redirect][url]": ret });
    if (!r.ok) fail(`creating the payment link was refused: ${why(r)}`);
    link = r.j;
  }
  note("Live payment link", `${link.url} (after paying: ${ret})`);

  // Webhook: one, fresh, so we hold its signing secret right now.
  for (const h of ((await stripe(LIVE, "GET", "webhook_endpoints?limit=100")).j.data ?? []).filter((h) => h.url === HOOK_URL)) await stripe(LIVE, "DELETE", `webhook_endpoints/${h.id}`);
  const hook = await stripe(LIVE, "POST", "webhook_endpoints", { url: HOOK_URL, "enabled_events[0]": "checkout.session.completed" });
  if (!hook.ok || !hook.j.secret) fail(`creating the webhook was refused: ${why(hook)}`);
  console.log(`::add-mask::${hook.j.secret}`);
  note("Live webhook", `${hook.j.id} -> ${HOOK_URL} for checkout.session.completed`);

  // The functions now use the live key and live webhook secret, and accept live events.
  const sec = await supa("POST", `/v1/projects/${REF}/secrets`, [
    { name: "STRIPE_SECRET_KEY", value: LIVE },
    { name: "STRIPE_WEBHOOK_SECRET", value: hook.j.secret },
    { name: "FAMILY_PASS_LIVE", value: "1" },
  ]);
  if (!sec.ok) fail(`could not store the live settings in Supabase (${sec.status})`);
  note("Function settings", "live key, live webhook secret and FAMILY_PASS_LIVE=1 stored");

  // Signed sample event, exactly as Stripe would sign it with the new secret. No money moves.
  await new Promise((r) => setTimeout(r, 8000));
  const email = "delivered@resend.dev";
  await sql(`delete from public.purchases where email = '${email}'; delete from auth.users where email = '${email}';`);
  const body = JSON.stringify({ id: "evt_son_setup_check", type: "checkout.session.completed", livemode: true, data: { object: { id: `cs_son_setup_${Date.now()}`, payment_status: "paid", customer_details: { email }, payment_intent: "pi_son_setup_check", amount_total: Number(cents) } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", hook.j.secret).update(`${t}.${body}`).digest("hex");
  const res = await fetch(HOOK_URL, { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, body });
  const reply = await res.text();
  const [row] = await sql(`select user_id, livemode from public.purchases where email = '${email}'`);
  await sql(`delete from public.purchases where email = '${email}'; delete from auth.users where email = '${email}';`);
  if (!res.ok || !row?.user_id) fail(`signed sample event not handled: ${res.status} ${reply.slice(0, 200)}; recorded ${!!row}`);
  note("Webhook check", `signed live-mode sample event answered ${res.status} ${reply.slice(0, 60)}; purchase recorded and an account made, then both deleted`);

  cfg.familyPass.stripePaymentLink = link.url;
  cfg.familyPass.enabled = true;
  writeFileSync("config/channel.json", JSON.stringify(cfg, null, 2) + "\n");
  note("Site", "Family Pass switched on with the live payment link");
}

// ---------- verify ----------
async function verify() {
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const link = cfg.familyPass.stripePaymentLink;
  if (!/^https:\/\/buy\.stripe\.com\/(?!test_)/.test(link)) fail(`not a live payment link: ${link}`);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
  try {
    const p = await browser.newPage();
    await p.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector("#email", { timeout: 45000 });
    const text = (await p.innerText("body")).replace(/\s+/g, " ");
    const sandbox = /sandbox|test mode/i.test(text);
    if (!/\$19\.00/.test(text) || sandbox) fail(`checkout page wrong: shows $19.00: ${/\$19\.00/.test(text)}, says test/sandbox: ${sandbox}`);
    note("Live checkout", `page loads, shows "${PRODUCT}" at $19.00, not test mode; nothing was paid`);
  } finally {
    await browser.close();
  }
  // The site's buy button points at this link.
  const page = await (await fetch(`${SITE}/family/`)).text();
  note("Site button", page.includes(link) ? `${SITE}/family/ "Get Family Pass" goes to the live checkout` : `${SITE}/family/ does not show the live link yet`);
}

// ---------- app-test ----------
// The member area in a real browser, as a buyer would use it: sign in by email link, see the pass,
// start a family group, invite someone. The "purchase" is a database row only: no Stripe charge.
async function appTest() {
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const keys = (await supa("GET", `/v1/projects/${REF}/api-keys?reveal=true`)).j;
  const service = (keys.find((k) => k.name === "service_role") ?? keys.find((k) => k.type === "secret"))?.api_key;
  if (!service) fail("no service key found");
  console.log(`::add-mask::${service}`);
  const admin = { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" };
  const buyer = `son-app-test+${Date.now()}@example.com`;
  const invitee = "delivered@resend.dev";
  const step = (t, m) => note(`Member area: ${t}`, m);
  let ok = true;
  const u = await (await fetch(`${SUPA}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email: buyer, email_confirm: true }) })).json();
  if (!u.id) fail(`could not make the test buyer: ${JSON.stringify(u).slice(0, 200)}`);
  await sql(`insert into public.purchases(email, user_id, stripe_session_id, stripe_payment_intent, amount_cents, livemode) values ('${buyer}', '${u.id}', 'cs_son_app_test', 'pi_son_app_test', 1900, false)`);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
  try {
    const gen = await (await fetch(`${SUPA}/auth/v1/admin/generate_link`, { method: "POST", headers: admin, body: JSON.stringify({ type: "magiclink", email: buyer, redirect_to: `${SITE}/family/app/` }) })).json();
    const action = gen.action_link ?? gen.properties?.action_link;
    if (!action) fail("no sign-in link");
    const p = await browser.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await p.goto(action, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForURL((x) => x.hostname.endsWith("scamornotdaily.com"), { timeout: 30000 });
    await p.waitForSelector("#member:not(.hidden)", { timeout: 30000 });
    const msg = await p.textContent("#member-msg");
    if (/no active Family Pass/.test(msg ?? "")) fail("signed in, but the page says there is no pass");
    step("signed in", `the email link opened ${SITE}/family/app/ signed in, with the pass`);
    await p.waitForSelector("#library a, #library p", { timeout: 20000 });
    step("past rounds", `${await p.locator("#library a").count()} past rounds listed`);
    await p.waitForSelector("#make-family-form:not(.hidden)", { timeout: 20000 });
    await p.fill("#make-family-form input[name=name]", "Test family");
    await p.click("#make-family-form button[type=submit]");
    await p.waitForFunction(() => document.getElementById("family-name")?.textContent === "Test family", null, { timeout: 20000 });
    step("family group", "started; the buyer shows as a member");
    await p.waitForSelector("#add-member-form:not(.hidden)", { timeout: 20000 });
    await p.fill("#add-member-form input[name=name]", "Tester");
    await p.fill("#add-member-form input[name=email]", invitee);
    await p.click("#add-member-form button[type=submit]");
    await p.waitForFunction(() => /Invite sent|error|wrong|couldn/i.test(document.getElementById("member-msg")?.textContent ?? ""), null, { timeout: 30000 });
    const after = await p.textContent("#member-msg");
    if (!/Invite sent/.test(after ?? "")) {
      ok = false;
      note("Member area: invite", `did not go through: ${after}`);
    } else step("invite", "sent (to Resend's test address)");
    if (await p.locator("#drill-form").count()) step("fire drill", "shown"); else step("fire drill", "hidden (no Fire Drill address yet)");
    step("refund button", (await p.locator("#refund").isVisible()) ? "shown (not pressed: this test has no real payment to refund)" : "missing");
    if (errors.length) {
      ok = false;
      note("Member area: page errors", errors.join(" | "));
    }
  } finally {
    await browser.close();
    const ids = await sql(`select id from auth.users where email in ('${buyer}', '${invitee}')`);
    for (const r of ids) await sql(`delete from auth.users where id = '${r.id}'`);
    await sql(`delete from public.purchases where email = '${buyer}'`);
    const [left] = await sql(`select (select count(*) from public.purchases where email = '${buyer}')::int as p, (select count(*) from auth.users where email in ('${buyer}', '${invitee}'))::int as u, (select count(*) from public.families where name = 'Test family')::int as f`);
    note("Member area: cleanup", `test buyer, invitee, purchase and family deleted (left: ${left.p} purchases, ${left.u} accounts, ${left.f} families)`);
  }
  if (!ok) fail("member area test found a problem (see notes)");
}

try {
  if (mode === "app-test") await appTest();
  else if (mode === "check") await check();
  else if (mode === "tidy-test") await tidyTest();
  else if (mode === "setup") await setup();
  else if (mode === "verify") await verify();
  else fail(`unknown mode ${mode}`);
} catch (e) {
  fail(String(e?.message ?? e));
}
