// One-off setup for scamornotdaily.com: Resend sending domain, its DNS records in Cloudflare, Supabase
// auth emails through Resend, and the custom domain on the Cloudflare Pages site.
// Run from .github/workflows/domain-setup.yml. Prints no secrets.
//
//   npx tsx scripts/domain-setup.mjs check     what the existing tokens can do (nothing is changed except a test DNS record, removed at once)
//   npx tsx scripts/domain-setup.mjs email     Resend domain + DNS records + verify + Supabase SMTP
//   npx tsx scripts/domain-setup.mjs site      scamornotdaily.com and www on the Pages site
//   npx tsx scripts/domain-setup.mjs e2e       test purchase -> real sign-in email -> pass unlocks -> refund -> clean up
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const DOMAIN = "scamornotdaily.com";
const FROM = `hello@${DOMAIN}`;
const FROM_NAME = "Scam or Not";
const PAGES_PROJECT = "scamornot";
const REF = process.env.PROJECT_REF;
const SUPA = `https://${REF}.supabase.co`;
const NEW_BASE = `https://${DOMAIN}`;
const mode = process.argv[2];

const note = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 1200)}`);
const fail = (msg) => {
  console.log(`::error title=Domain setup::${String(msg).replace(/[\r\n]+/g, " ").slice(0, 1500)}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API helpers ----------
async function call(base, auth, method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let j;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, j };
}
const cf = (method, path, body) => call("https://api.cloudflare.com/client/v4", process.env.CLOUDFLARE_API_TOKEN, method, path, body);
const resend = (method, path, body) => call("https://api.resend.com", process.env.RESEND_API_KEY, method, path, body);
const supa = (method, path, body) => call("https://api.supabase.com", process.env.SUPABASE_ACCESS_TOKEN, method, path, body);
const sql = async (query) => {
  const r = await supa("POST", `/v1/projects/${REF}/database/query`, { query });
  if (!r.ok) throw new Error(`sql ${r.status}: ${JSON.stringify(r.j).slice(0, 200)}`);
  return r.j;
};
const cfErr = (r) => (r.j.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${r.status}`;

async function zone() {
  const r = await cf("GET", `/zones?name=${DOMAIN}`);
  return r.ok ? r.j.result?.[0] : undefined;
}

// ---------- check ----------
async function check() {
  const out = {};
  const z = await zone();
  out.zone = z ? `found (status ${z.status})` : "not visible to the token";
  if (z) {
    const t = await cf("POST", `/zones/${z.id}/dns_records`, { type: "TXT", name: `_son-token-test.${DOMAIN}`, content: "test", ttl: 60 });
    out.dnsEdit = t.ok ? "can edit DNS" : `cannot edit DNS (${cfErr(t)})`;
    if (t.ok) await cf("DELETE", `/zones/${z.id}/dns_records/${t.j.result.id}`);
  } else out.dnsEdit = "unknown (zone not visible)";
  const pd = await cf("GET", `/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}/domains`);
  out.pagesDomains = pd.ok ? `can manage (now: ${(pd.j.result ?? []).map((d) => `${d.name} ${d.status}`).join(", ") || "none"})` : `cannot (${cfErr(pd)})`;
  const rd = await resend("GET", "/domains");
  out.resend = rd.ok ? `key works (domains: ${(rd.j.data ?? []).map((d) => `${d.name} ${d.status}`).join(", ") || "none"})` : `key refused (${rd.status})`;
  const sa = await supa("GET", `/v1/projects/${REF}/config/auth`);
  out.supabase = sa.ok ? `token works (custom email now: ${sa.j.smtp_host ? sa.j.smtp_host : "none"})` : `token refused (${sa.status})`;
  for (const [k, v] of Object.entries(out)) note(`Check: ${k}`, v);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `dns_ok=${out.dnsEdit === "can edit DNS"}\n`);
}

// ---------- email ----------
const fqdn = (name) => (!name || name === "@" ? DOMAIN : name.endsWith(DOMAIN) ? name : `${name}.${DOMAIN}`);

async function upsertRecord(zoneId, rec) {
  const name = fqdn(rec.name);
  const existing = await cf("GET", `/zones/${zoneId}/dns_records?type=${rec.type}&name=${name}`);
  const same = (existing.j.result ?? []).find((r) => r.content.replace(/^"|"$/g, "") === rec.value.replace(/^"|"$/g, ""));
  if (same) return `${rec.type} ${name} already there`;
  const body = { type: rec.type, name, content: rec.value, ttl: 1, proxied: false };
  if (rec.type === "MX") body.priority = Number(rec.priority ?? 10);
  const r = await cf("POST", `/zones/${zoneId}/dns_records`, body);
  if (!r.ok) throw new Error(`DNS ${rec.type} ${name}: ${cfErr(r)}`);
  return `${rec.type} ${name} added`;
}

async function email() {
  const z = await zone();
  if (!z) fail("the Cloudflare token cannot see the scamornotdaily.com zone");

  // 1. The sending domain in Resend.
  let list = await resend("GET", "/domains");
  if (!list.ok) fail(`Resend refused the key (${list.status})`);
  let d = (list.j.data ?? []).find((x) => x.name === DOMAIN);
  if (!d) {
    const made = await resend("POST", "/domains", { name: DOMAIN });
    if (!made.ok) fail(`Resend would not add the domain: ${JSON.stringify(made.j).slice(0, 200)}`);
    d = made.j;
    note("Resend", `${DOMAIN} added`);
  }
  const full = await resend("GET", `/domains/${d.id}`);
  const records = full.j.records ?? [];
  note("Resend DNS records", records.map((r) => `${r.record ?? ""} ${r.type} ${r.name}`).join("; "));

  // 2. Those records in Cloudflare, plus a gentle DMARC policy if none exists.
  for (const rec of records) note("DNS", await upsertRecord(z.id, rec));
  const dmarc = await cf("GET", `/zones/${z.id}/dns_records?type=TXT&name=_dmarc.${DOMAIN}`);
  if (!(dmarc.j.result ?? []).length) note("DNS", await upsertRecord(z.id, { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" }));

  // 3. Verify, and wait for Resend to see the records (Cloudflare DNS is usually live within a minute).
  await resend("POST", `/domains/${d.id}/verify`);
  let status = "";
  for (let i = 0; i < 30; i++) {
    await sleep(20000);
    const g = await resend("GET", `/domains/${d.id}`);
    status = g.j.status;
    if (status === "verified") break;
    if (i % 6 === 5) await resend("POST", `/domains/${d.id}/verify`);
  }
  if (status !== "verified") fail(`Resend has not verified ${DOMAIN} yet (status ${status}); DNS can take longer, run this step again later`);
  note("Resend", `${DOMAIN} verified`);

  // 4. A sending-only key for Supabase, limited to this domain (the full-access key stays in GitHub only).
  const keys = await resend("GET", "/api-keys");
  const old = (keys.j.data ?? []).filter((k) => k.name === "supabase-auth-smtp");
  for (const k of old) await resend("DELETE", `/api-keys/${k.id}`);
  const key = await resend("POST", "/api-keys", { name: "supabase-auth-smtp", permission: "sending_access", domain_id: d.id });
  if (!key.ok || !key.j.token) fail(`could not make a sending key: ${JSON.stringify(key.j).slice(0, 200)}`);
  console.log(`::add-mask::${key.j.token}`);

  // 5. Supabase auth emails through Resend, and sign-in links allowed back to the new address.
  const patch = await supa("PATCH", `/v1/projects/${REF}/config/auth`, {
    smtp_admin_email: FROM,
    smtp_sender_name: FROM_NAME,
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: key.j.token,
    site_url: NEW_BASE,
    uri_allow_list: [`${NEW_BASE}/**`, `https://www.${DOMAIN}/**`, "https://scamornot.pages.dev/**"].join(","),
  });
  if (!patch.ok) fail(`Supabase would not take the email settings: ${JSON.stringify(patch.j).slice(0, 300)}`);
  const after = await supa("GET", `/v1/projects/${REF}/config/auth`);
  note("Supabase auth email", `sending through ${after.j.smtp_host}:${after.j.smtp_port} as "${after.j.smtp_sender_name}" <${after.j.smtp_admin_email}>; site ${after.j.site_url}`);

  // 6. The edge functions build links and allow browser calls from the new address.
  const sec = await supa("POST", `/v1/projects/${REF}/secrets`, [
    { name: "SITE_BASE_URL", value: NEW_BASE },
    { name: "SITE_ORIGIN", value: NEW_BASE },
  ]);
  if (!sec.ok) fail(`could not update function settings (${sec.status})`);
  note("Function settings", `SITE_BASE_URL and SITE_ORIGIN now ${NEW_BASE}`);
}

// ---------- site ----------
async function site() {
  const z = await zone();
  if (!z) fail("the Cloudflare token cannot see the scamornotdaily.com zone");
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  for (const name of [DOMAIN, `www.${DOMAIN}`]) {
    const have = await cf("GET", `/accounts/${acct}/pages/projects/${PAGES_PROJECT}/domains/${name}`);
    if (!have.ok) {
      const add = await cf("POST", `/accounts/${acct}/pages/projects/${PAGES_PROJECT}/domains`, { name });
      if (!add.ok) fail(`Pages would not take ${name}: ${cfErr(add)}`);
    }
    // The address points at the Pages site (Cloudflare flattens the CNAME at the top of the domain).
    const existing = await cf("GET", `/zones/${z.id}/dns_records?name=${name}`);
    const cname = (existing.j.result ?? []).find((r) => r.type === "CNAME");
    const clash = (existing.j.result ?? []).filter((r) => ["A", "AAAA"].includes(r.type));
    for (const r of clash) await cf("DELETE", `/zones/${z.id}/dns_records/${r.id}`);
    if (!cname) {
      const r = await cf("POST", `/zones/${z.id}/dns_records`, { type: "CNAME", name, content: `${PAGES_PROJECT}.pages.dev`, proxied: true, ttl: 1 });
      if (!r.ok) fail(`DNS for ${name}: ${cfErr(r)}`);
    } else if (cname.content !== `${PAGES_PROJECT}.pages.dev`) {
      const r = await cf("PATCH", `/zones/${z.id}/dns_records/${cname.id}`, { content: `${PAGES_PROJECT}.pages.dev`, proxied: true });
      if (!r.ok) fail(`DNS for ${name}: ${cfErr(r)}`);
    }
  }
  // Wait for Pages to check the domains and issue certificates.
  const status = {};
  for (let i = 0; i < 40; i++) {
    for (const name of [DOMAIN, `www.${DOMAIN}`]) {
      const g = await cf("GET", `/accounts/${acct}/pages/projects/${PAGES_PROJECT}/domains/${name}`);
      status[name] = g.j.result?.status ?? "unknown";
      if (status[name] !== "active" && i % 5 === 4) await cf("PATCH", `/accounts/${acct}/pages/projects/${PAGES_PROJECT}/domains/${name}`);
    }
    if (Object.values(status).every((s) => s === "active")) break;
    await sleep(15000);
  }
  note("Pages domains", Object.entries(status).map(([k, v]) => `${k} ${v}`).join(", "));
  if (!Object.values(status).every((s) => s === "active")) fail("domains not active yet; certificates can take a few more minutes, run this step again");

  // The site now builds with the new address everywhere.
  const t = JSON.parse(readFileSync("data/site-target.json", "utf8"));
  t.customDomain = DOMAIN;
  writeFileSync("data/site-target.json", JSON.stringify(t, null, 2) + "\n");
  const c = JSON.parse(readFileSync("config/channel.json", "utf8"));
  c.site.baseUrl = NEW_BASE;
  writeFileSync("config/channel.json", JSON.stringify(c, null, 2) + "\n");
  note("Site address", `${NEW_BASE} (scamornot.pages.dev keeps working)`);
}

// ---------- e2e ----------
// A real inbox for the test: a throwaway mailbox at mail.tm, read through its public API.
async function inbox() {
  const doms = await (await fetch("https://api.mail.tm/domains")).json();
  const dom = (doms["hydra:member"] ?? doms)[0]?.domain;
  if (!dom) fail("no test mailbox domain available");
  const address = `son-buyer-${Date.now()}@${dom}`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const made = await fetch("https://api.mail.tm/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, password }) });
  if (!made.ok) fail(`could not make a test mailbox (${made.status})`);
  const tok = (await (await fetch("https://api.mail.tm/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, password }) })).json()).token;
  console.log(`::add-mask::${tok}`);
  const h = { authorization: `Bearer ${tok}` };
  return {
    address,
    async waitFor(pred, ms = 240000) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const list = await (await fetch("https://api.mail.tm/messages", { headers: h })).json();
        for (const m of list["hydra:member"] ?? []) {
          const full = await (await fetch(`https://api.mail.tm/messages/${m.id}`, { headers: h })).json();
          if (pred(full)) return full;
        }
        await sleep(8000);
      }
      return null;
    },
    async remove() {
      const me = await (await fetch("https://api.mail.tm/me", { headers: h })).json();
      if (me.id) await fetch(`https://api.mail.tm/accounts/${me.id}`, { method: "DELETE", headers: h });
    },
  };
}

async function e2e() {
  const cfg = JSON.parse(readFileSync("config/channel.json", "utf8"));
  const link = cfg.familyPass.stripePaymentLink;
  if (!/^https:\/\/buy\.stripe\.com\/test_/.test(link)) fail(`payment link is not a Stripe TEST link: ${link}`);
  const pub = cfg.supabase.publishableKey;
  const box = await inbox();
  const email = box.address;
  const step = (t, m) => note(`E2E: ${t}`, m);
  let userId;

  try {
    // 1. Pay with Stripe's test card on the real checkout page.
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
    try {
      const p = await browser.newPage();
      await p.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForSelector("#email", { timeout: 45000 });
      await p.fill("#email", email);
      const acc = p.locator('[data-testid="card-accordion-item-button"]').first();
      if (await acc.count()) await acc.click({ force: true }).catch(() => acc.dispatchEvent("click"));
      await p.waitForSelector("#cardNumber", { timeout: 20000 });
      await p.fill("#cardNumber", "4242 4242 4242 4242");
      await p.fill("#cardExpiry", "12 / 34");
      await p.fill("#cardCvc", "123");
      await p.fill("#billingName", "Test Buyer").catch(() => {});
      const zip = p.locator("#billingPostalCode");
      if (await zip.isVisible().catch(() => false)) await zip.fill("94107");
      const save = p.locator("#enableStripePass");
      if (await save.isChecked().catch(() => false)) await save.click({ force: true }).catch(() => {});
      await p.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first().click();
      await p.waitForURL((u) => !u.hostname.endsWith("stripe.com"), { timeout: 60000 });
      step("paid", `test card accepted; Stripe sent the buyer to ${new URL(p.url()).origin}${new URL(p.url()).pathname}`);
    } finally {
      await browser.close();
    }

    // 2. The webhook records it and Supabase emails the sign-in link through Resend.
    let row;
    for (let i = 0; i < 20 && !row?.user_id; i++) {
      await sleep(3000);
      [row] = await sql(`select id, user_id, stripe_payment_intent from public.purchases where email = '${email}'`);
    }
    if (!row?.user_id) fail(`purchase not recorded with an account (row: ${!!row})`);
    userId = row.user_id;
    step("recorded", "purchase saved and an account made for the buyer");

    const mail = await box.waitFor((m) => /scamornotdaily\.com/i.test(m.from?.address ?? "") && /auth\/v1\/verify/.test(`${m.text ?? ""} ${(m.html ?? []).join(" ")}`));
    if (!mail) fail("no sign-in email from scamornotdaily.com arrived within 4 minutes");
    step("email", `arrived in the test inbox from "${mail.from.name}" <${mail.from.address}>, subject "${mail.subject}"`);

    // 3. Follow the link the way a buyer's click would; the sign-in comes back on the redirect.
    const body = `${mail.text ?? ""} ${(mail.html ?? []).join(" ")}`;
    const url = body.match(/https:\/\/[^\s"'<>]+auth\/v1\/verify[^\s"'<>]+/)[0].replace(/&amp;/g, "&");
    const hop = await fetch(url, { redirect: "manual" });
    const loc = hop.headers.get("location") ?? "";
    const tokenMatch = loc.match(/access_token=([^&]+)/);
    if (!tokenMatch) fail(`the sign-in link did not sign in (status ${hop.status}, went to ${loc.split("#")[0]})`);
    const access = decodeURIComponent(tokenMatch[1]);
    console.log(`::add-mask::${access}`);
    step("signed in", `the link sends the buyer to ${loc.split("#")[0]}`);

    // 4. The pass unlocks.
    const buyer = { apikey: pub, authorization: `Bearer ${access}`, "content-type": "application/json" };
    const has = await (await fetch(`${SUPA}/rest/v1/rpc/has_pass`, { method: "POST", headers: buyer, body: "{}" })).json();
    if (has !== true) fail(`pass did not unlock (has_pass ${JSON.stringify(has)})`);
    step("unlocked", "the buyer has the Family Pass");

    // 5. Refund it so the Stripe test account stays tidy.
    const ref = await fetch(`${SUPA}/functions/v1/family-refund`, { method: "POST", headers: buyer, body: "{}" });
    step("refunded", ref.ok ? "test payment refunded" : `refund answered ${ref.status}`);
  } finally {
    // 6. Clean up: the test buyer, its purchase and the test mailbox.
    if (userId) await sql(`delete from auth.users where id = '${userId}'`);
    await sql(`delete from public.purchases where email = '${email}'`);
    await box.remove().catch(() => {});
    const [left] = await sql(`select (select count(*) from public.purchases where email = '${email}')::int as p, (select count(*) from auth.users where email = '${email}')::int as u`);
    step("cleanup", `test buyer, purchase and mailbox deleted (left: ${left.p} purchases, ${left.u} accounts)`);
  }
}

try {
  if (mode === "check") await check();
  else if (mode === "email") await email();
  else if (mode === "site") await site();
  else if (mode === "e2e") await e2e();
  else fail(`unknown mode ${mode}`);
} catch (e) {
  fail(String(e?.message ?? e));
}
