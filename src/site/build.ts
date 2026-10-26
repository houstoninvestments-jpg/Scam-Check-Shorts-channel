import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Episode } from "../types.js";
import { config } from "../lib/config.js";
import { loadLedger } from "../lib/ledger.js";
import { path, readJson, today } from "../lib/util.js";
import { CSS, esc, page, phone, scamPage, topBar, type ShareImage } from "./templates.js";
import { writeFavicons } from "./favicon.js";
import { coverFile } from "../render/covers.js";
import { renderDefaultCard, renderScamCard } from "./cards.js";
import { privacyPage, termsPage } from "./legal.js";
import { buildRound, type LegitItem, type Round } from "./round.js";

const pad3 = (n: number) => String(n).padStart(3, "0");

/** Site-wide preview card for the link page, the daily round and the index pages. */
const defaultImage = (): ShareImage => ({ url: `${config().site.baseUrl}/og/default.png`, alt: "Scam or Not: one real scam text a day. Real or scam?" });

function out(dir: string, rel: string, content: string) {
  const f = join(dir, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
}

/** Public settings for the browser. Only the publishable database key goes here, never a secret. */
function browserConfig() {
  const c = config();
  return `window.SON=${JSON.stringify({
    supabaseUrl: c.supabase.url,
    supabaseKey: c.supabase.publishableKey,
    baseUrl: c.site.baseUrl,
    fireDrillBase: c.site.fireDrillBaseUrl,
    maxMembers: c.familyPass.maxMembers,
  })};`;
}

/** A case-file card: the video's cover frame, numbered, newest first. */
function caseCard(e: Episode, root: string, hasCover: (n: number) => boolean) {
  const no = `Scam No. ${pad3(e.number)}`;
  const img = hasCover(e.number)
    ? `<img src="${root}covers/${pad3(e.number)}.jpg" alt="Cover of ${esc(no)}: a message with a Real or Scam stamp" width="540" height="960" loading="lazy">`
    : `<span class="ph">REAL OR SCAM?</span>`;
  return `<a class="case" href="${root}scam/${e.slug}/"><span class="no">${esc(no)}</span>${img}<span class="name">${esc(e.script.scamName)}</span><span class="date">${esc(e.date)}</span></a>`;
}

function linkPage(eps: Episode[], round: Round | null, hasCover: (n: number) => boolean) {
  const c = config();
  const today = eps.at(-1);
  const aff = c.affiliate;
  const body = `
${
  today
    ? phone({ sender: today.script.message.sender, body: today.script.message.body, stamp: "question" })
    : phone({ sender: "Scam or Not", body: "The first scam text lands here soon.", stamp: "question" })
}
<a class="btn main" href="round/">Play today's round</a>
<p class="tagline">${esc(c.channel.tagline)}</p>
<p class="small" style="text-align:center">Three messages. Takes one minute.${round ? ` Today: Scam No. ${pad3(round.number)}.` : ""}</p>

<h2>Past scams</h2>
${eps.length ? `<div class="cases">\n${[...eps].reverse().slice(0, 12).map((e) => caseCard(e, "", hasCover)).join("\n")}\n</div>` : "<p>The first case file is on its way.</p>"}
${eps.length > 12 ? `<p><a href="scams/">See every scam</a></p>` : ""}

<p class="never">${esc(c.channel.never)}</p>

${signupSection("home")}

<div class="card">
<p><span class="paid">${esc(aff.label)}</span></p>
${
  aff.enabled && aff.url
    ? `<p><b>${esc(aff.name)}</b></p><p>${esc(aff.blurb)}</p><a class="btn" href="${esc(aff.url)}" rel="sponsored noopener">See our pick</a><p class="small">We earn money if you buy through this link.</p>`
    : `<p><b>Identity protection pick: coming soon.</b></p><p class="small">When we add one, we will say clearly that it's a paid link.</p>`
}
</div>
${
  c.familyPass.enabled
    ? `<h2>Family Pass</h2><p>Practice together. Past rounds, a family group with streaks${c.site.fireDrillBaseUrl ? ", big text, and Fire Drill" : ", and big text"}. $${c.familyPass.priceUsd} once.</p><a class="btn" href="family/">See Family Pass</a>`
    : ""
}`;
  return page({
    top: topBar("", today ? `Scam No. ${pad3(today.number)}` : ""),
    title: "Scam or Not: one real scam text a day",
    description: c.channel.tagline,
    body,
    root: "",
    canonical: `${c.site.baseUrl}/`,
    image: defaultImage(),
    scripts: `<script src="assets/config.js"></script><script src="assets/signup.js"></script>`,
  });
}

/**
 * The email signup box. Hidden until the database is set up (signup.js shows it).
 * Nothing sends the daily email yet, so the box promises only what is true.
 */
function signupSection(source: string) {
  return `<section id="signup" class="hidden">
<h2>Get the daily round by email</h2>
<p>Free. Leave anytime. We'll start sending once our daily email is ready.</p>
<form id="signup-form" data-source="${source}">
<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required aria-label="Email address">
<button class="btn light" type="submit">Sign me up</button>
<p id="signup-msg" class="small" role="status"></p>
</form>
</section>`;
}

function roundPage() {
  const c = config();
  const body = `
<h1 id="round-title">Today's round</h1>
<p class="lede">Real or scam? Three messages. Trust your gut, then see why.</p>
<div id="round" data-root="../"><p>Loading...</p></div>
<p class="small">Real messages in the round are typical safe messages. We write them without real names or links.</p>
${signupSection("round-page")}`;
  return page({
    title: "Daily round: real or scam?",
    description: "Three real-world messages. Can you tell which ones are scams?",
    body,
    root: "../",
    canonical: `${c.site.baseUrl}/round/`,
    image: defaultImage(),
    scripts: `<script src="../assets/config.js"></script><script src="../assets/round.js"></script><script src="../assets/signup.js"></script>${c.familyPass.enabled ? `<script type="module" src="../assets/round-family.js"></script>` : ""}`,
  });
}

function allScams(eps: Episode[], hasCover: (n: number) => boolean) {
  const body = `<h1>Every scam so far</h1>
<div class="cases">${[...eps].reverse().map((e) => caseCard(e, "../", hasCover)).join("\n")}</div>`;
  return page({ title: "Every scam so far | Scam or Not", description: "Every scam text we have broken down, newest first.", body, root: "../", canonical: `${config().site.baseUrl}/scams/`, image: defaultImage() });
}

/** Fire Drill shows only once its landing page has its own address (site.fireDrillBaseUrl). */
const fireDrillOn = () => Boolean(config().site.fireDrillBaseUrl);

function familyPage() {
  const c = config();
  const f = c.familyPass;
  const body = `
<h1>Family Pass</h1>
<p class="lede">Practice spotting scams together, before a real one shows up.</p>
<div class="card">
<p><b>$${f.priceUsd}, one time.</b> No subscription.</p>
<ul>
<li><b>Every past round.</b> Replay any day you missed.</li>
<li><b>A private family group.</b> Up to ${f.maxMembers} people. See each other's streaks.</li>
<li><b>Big text mode.</b> Easier reading on any phone.</li>
${fireDrillOn() ? `<li><b>Fire Drill.</b> Send your family a harmless practice scam. If they tap, they land on a kind page that shows what to look for.</li>` : ""}
</ul>
</div>
<a class="btn" href="${esc(f.stripePaymentLink || "#")}">Get Family Pass</a>
<p class="small">You get access right away by email link. Changed your mind? Refund yourself in one tap within ${f.refundDays} days.</p>
${fireDrillOn() ? `<p class="small">Fire Drill links only show a friendly lesson page. They never ask for or keep any personal information.</p>` : ""}`;
  return page({ title: "Family Pass | Scam or Not", description: "Practice spotting scams together.", body, root: "../", canonical: `${c.site.baseUrl}/family/`, image: defaultImage() });
}

function familyApp() {
  const body = `
<h1>Family Pass</h1>
<p id="member-msg" class="small" role="status"></p>
<section id="signin">
<p>Sign in with the email you used to buy, or the one you were invited with.</p>
<form id="signin-form"><input type="email" name="email" required aria-label="Email address" placeholder="you@example.com"><button class="btn" type="submit">Email me a sign-in link</button></form>
<p id="signin-msg" class="small" role="status"></p>
</section>
<section id="member" class="hidden">
<label class="card" style="display:flex;gap:12px;align-items:center"><input type="checkbox" id="big"> Big text</label>
<h2>Your family</h2>
<form id="make-family-form" class="hidden"><p>Start your family group.</p><input name="name" required placeholder="Family name" style="width:100%;font:inherit;padding:14px;border-radius:12px;border:2px solid var(--line)"><button class="btn" type="submit">Create group</button></form>
<div id="family" class="hidden"><p><b id="family-name"></b></p><ul id="members"></ul>
<form id="add-member-form" class="hidden"><input name="name" required placeholder="Their name" style="width:100%;font:inherit;padding:14px;border-radius:12px;border:2px solid var(--line);margin-bottom:8px"><input type="email" name="email" required placeholder="Their email"><button class="btn alt" type="submit">Invite</button></form></div>
${
  fireDrillOn()
    ? `<h2>Fire Drill</h2>
<p>Make a harmless practice scam to send your family. If someone taps it, you'll see it here.</p>
<form id="drill-form"><input name="label" placeholder="Who is it for? (only you see this)" style="width:100%;font:inherit;padding:14px;border-radius:12px;border:2px solid var(--line)"><button class="btn" type="submit">Make a practice text</button></form>
<div id="drill-out" class="card hidden"><p id="drill-text"></p><button id="copy-drill" class="btn alt" type="button">Copy</button><p class="small">Text it from your own phone. Tell them afterward it was practice.</p></div>
<ul id="drills"></ul>`
    : ""
}
<h2>Past rounds</h2>
<div id="library" class="list"></div>
<h2>Account</h2>
<button id="refund" class="btn alt" type="button">Refund my Family Pass</button>
<button id="signout" class="btn alt" type="button">Sign out</button>
</section>`;
  return page({ title: "Family Pass | Scam or Not", description: "Family Pass member area.", body, root: "../../", scripts: `<script src="../../assets/config.js"></script><script type="module" src="../../assets/family.js"></script>` });
}

/** The Fire Drill landing page lives on its own address so it never looks like the main site. */
export function buildFireDrill(dir = path("firedrill/dist")) {
  const c = config();
  rmSync(dir, { recursive: true, force: true });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gotcha, kindly</title><meta name="robots" content="noindex">
<style>
:root{--bg:#fff;--ink:#0d0f12;--dim:#4a515c;--card:#f4f5f7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--ink:#f5f6f8;--dim:#b4bac4;--card:#161a20}}
body{margin:0;background:var(--bg);color:var(--ink);font:20px/1.55 system-ui,-apple-system,sans-serif}
main{max-width:600px;margin:0 auto;padding:32px 16px}h1{font-size:2em;line-height:1.1}
.card{background:var(--card);border-radius:16px;padding:16px 18px;margin:16px 0}li{margin:10px 0}.small{font-size:.85em;color:var(--dim)}
</style></head><body><main>
<h1>Gotcha, kindly.</h1>
<p>This was a practice scam. Someone who cares about you sent it to help you stay safe.</p>
<div class="card"><p><b>Nothing bad happened.</b> This page does not ask for or keep any of your information.</p></div>
<h2>What to look for next time</h2>
<ol><li><b>A link you didn't expect.</b> Real companies rarely text a link out of the blue.</li>
<li><b>A rush.</b> "Today only" or "act now" is meant to stop you from thinking.</li>
<li><b>A request for money, codes, or details.</b> That's the scam.</li></ol>
<div class="card"><p><b>Safe move:</b> don't tap. Check with the person or company another way, like a number you already have.</p></div>
<p class="small">Want daily practice? Search for "Scam or Not" on YouTube.</p>
<p class="small"><a href="${c.site.baseUrl}/privacy/">Privacy</a> · <a href="${c.site.baseUrl}/terms/">Terms</a></p>
</main>
<script>
(function(){var k=new URLSearchParams(location.search).get("k");var S=${JSON.stringify({ u: c.supabase.url, k: c.supabase.publishableKey })};
if(!k||!S.u)return;fetch(S.u+"/rest/v1/rpc/log_drill_tap",{method:"POST",headers:{apikey:S.k,"content-type":"application/json"},body:JSON.stringify({drill_code:k.slice(0,32)})}).catch(function(){});})();
</script></body></html>`;
  out(dir, "index.html", html);
  out(dir, "robots.txt", "User-agent: *\nDisallow: /\n");
  return dir;
}

export interface BuildResult {
  dir: string;
  pages: string[];
  round: Round | null;
}

export async function buildSite(opts: { dryRun?: boolean; dir?: string; fireDrillDir?: string; date?: string } = {}): Promise<BuildResult> {
  const c = config();
  const dir = opts.dir ?? path("site/dist");
  const date = opts.date ?? today(c.cadence.timezone);
  const ledger = loadLedger();
  // Uploaded videos count even while private (the page is checked; it just doesn't link the video).
  const eps = ledger.episodes.filter((e) => e.status === "published" || (e.status === "rendered" && (e.youtubeId || opts.dryRun)));
  const legit = readJson<{ items: LegitItem[] }>(path("data/legit-texts.json")).items;
  rmSync(dir, { recursive: true, force: true });
  const pages: string[] = [];
  const write = (rel: string, html: string) => {
    out(dir, rel, html);
    pages.push(rel);
  };

  out(dir, "assets/site.css", CSS);
  mkdirSync(join(dir, "assets"), { recursive: true });
  copyFileSync(path("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"), join(dir, "assets/inter.woff2"));
  out(dir, "assets/config.js", browserConfig());
  for (const f of ["round.js", "signup.js", ...(c.familyPass.enabled ? ["family.js", "round-family.js"] : [])]) copyFileSync(path("site/static", f), join(dir, "assets", f));

  // Rounds: today's plus one per past episode day, so the library has history.
  const days = [...new Set([...eps.map((e) => e.date), date])].sort();
  const index: { date: string; number: number }[] = [];
  let latest: Round | null = null;
  for (const d of days) {
    const r = buildRound(d, eps, legit, c.site.baseUrl);
    if (!r) continue;
    out(dir, `rounds/${d}.json`, JSON.stringify(r));
    index.push({ date: d, number: r.number });
    latest = r;
  }
  if (latest) out(dir, "rounds/latest.json", JSON.stringify(latest));
  out(dir, "rounds/index.json", JSON.stringify(index));

  // Share preview cards: one per scam (the question, never the answer) plus the site-wide default.
  await renderDefaultCard(join(dir, "og/default.png"));
  for (const e of eps) await renderScamCard(e, join(dir, `og/${e.slug}.png`));

  // Cover frames of each video (kept in data/covers) for the case-file cards.
  const covered = new Set<number>();
  for (const e of eps) {
    if (!existsSync(coverFile(e.number))) continue;
    mkdirSync(join(dir, "covers"), { recursive: true });
    copyFileSync(coverFile(e.number), join(dir, "covers", `${pad3(e.number)}.jpg`));
    covered.add(e.number);
  }
  const hasCover = (n: number) => covered.has(n);
  await writeFavicons(dir);

  write("index.html", linkPage(eps, latest, hasCover));
  write("round/index.html", roundPage());
  write("scams/index.html", allScams(eps, hasCover));
  write("privacy/index.html", privacyPage(c, "../"));
  write("terms/index.html", termsPage(c, "../"));
  for (const e of eps) write(`scam/${e.slug}/index.html`, scamPage(e, c, "../../", e.youtubeId && e.youtubePrivacy !== "private" ? `https://www.youtube.com/shorts/${e.youtubeId}` : undefined));
  if (c.familyPass.enabled) {
    write("family/index.html", familyPage());
    write("family/app/index.html", familyApp());
  }
  out(dir, "robots.txt", `User-agent: *\nAllow: /\nSitemap: ${c.site.baseUrl}/sitemap.xml\n`);
  out(
    dir,
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
      .filter((p) => !p.startsWith("family/app"))
      .map((p) => `<url><loc>${c.site.baseUrl}/${p.replace(/index\.html$/, "")}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  out(dir, ".nojekyll", "");
  buildFireDrill(opts.fireDrillDir ?? path("firedrill/dist"));
  return { dir, pages, round: latest };
}
