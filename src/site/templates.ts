import type { Episode } from "../types.js";
import type { ChannelConfig } from "../lib/config.js";
import { episodeHashtags } from "../publish/youtube.js";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad3 = (n: number) => String(n).padStart(3, "0");

/**
 * Same world as the Shorts: the tokens in remotion/theme.ts (near-black, white ink, dim grey, Inter).
 * Red only on stamps, verdicts, red flags and the main button.
 */
export const CSS = `
@font-face{font-family:Inter;src:url(inter.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--bg:#0A0C0F;--ink:#FFFFFF;--dim:#A9B0BA;--faint:#6B7380;--red:#FF3B30;--card:#14171C;--line:#262B33;--bezel:#1B1E23;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:19px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
body.big{font-size:23px}
main{max-width:680px;margin:0 auto;padding:0 16px 64px}
a{color:inherit;text-underline-offset:3px}
p{margin:.6em 0}
h1{font-size:2.1em;line-height:1.08;font-weight:900;letter-spacing:-.02em;margin:.5em 0 .3em}
h2{font-size:1.35em;font-weight:900;letter-spacing:-.01em;margin:1.8em 0 .6em}
img{max-width:100%;height:auto}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 0 6px}
.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.14em;font-size:.82em;text-decoration:none;text-transform:uppercase;white-space:nowrap}
.brand img{width:28px;height:28px}
.case-tag{font-weight:800;letter-spacing:.06em;font-size:.82em;color:var(--dim);text-transform:uppercase;white-space:nowrap}
.lede,.tagline{font-size:1.15em;color:var(--ink);font-weight:600}
.tagline{text-align:center;margin:18px 0 6px}
.small{font-size:.86em;color:var(--dim)}
.btn{display:block;width:100%;text-align:center;background:transparent;color:var(--ink);border:2px solid var(--ink);border-radius:16px;padding:16px 18px;font:inherit;font-weight:800;text-decoration:none;cursor:pointer;margin:12px 0}
.btn.main{background:var(--red);border-color:var(--red);color:#fff;font-size:1.2em;padding:20px 18px;box-shadow:0 10px 30px rgba(255,59,48,.25)}
.btn.light{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 18px;margin:16px 0}
.never{text-align:center;font-weight:800;font-size:1.05em;border:2px solid var(--line);border-radius:18px;padding:18px;margin:32px 0}
/* phone mockup, like the cover frame */
.stage{position:relative;padding-top:86px;margin:8px auto 4px;width:min(360px,100%)}
.phone{background:var(--bezel);border-radius:46px;padding:12px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
.screen{background:#fff;color:#111;border-radius:36px;overflow:hidden;padding-bottom:22px}
.screen .bar{display:flex;justify-content:space-between;padding:12px 22px 4px;font-size:14px;font-weight:600}
.screen .who{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 0 12px;background:#f7f7f8;border-bottom:1px solid #e5e5ea;font-size:15px;font-weight:600}
.screen .who i{width:46px;height:46px;border-radius:50%;background:#9aa0a8;color:#fff;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:700}
.screen .when{text-align:center;color:#8e8e93;font-size:13px;margin:12px 0 8px}
.screen .bubble{margin:0 16px;background:#e9e9eb;border-radius:22px 22px 22px 6px;padding:14px 16px;white-space:pre-wrap;font-size:17px;line-height:1.38;color:#111}
.stamp{position:absolute;top:8px;left:50%;transform:translateX(-50%) rotate(-7deg);border:7px solid var(--red);color:var(--red);background:rgba(10,12,15,.94);font-weight:900;font-size:clamp(34px,11vw,52px);line-height:.98;padding:12px 24px 10px;border-radius:18px;text-align:center;white-space:nowrap;letter-spacing:.02em;box-shadow:0 12px 30px rgba(0,0,0,.5);z-index:2}
.stamp.verdict-stamp{font-size:clamp(40px,13vw,60px)}
.from{font-size:.9em;color:var(--dim);margin:0 0 6px 4px}
.note{max-width:360px;margin:12px auto 0}
/* case files */
.cases{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.case{display:flex;flex-direction:column;gap:6px;text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:10px}
.case .no{font-weight:900;letter-spacing:.02em;font-size:.85em;white-space:nowrap}
.case img,.case .ph{border-radius:10px;aspect-ratio:9/16;object-fit:cover;width:100%;background:#000}
.case .ph{display:flex;align-items:center;justify-content:center;color:var(--red);font-weight:900;border:2px solid var(--line)}
.case .name{font-weight:700;font-size:.92em;line-height:1.3}
.case .date{font-size:.8em;color:var(--dim)}
/* verdicts and flags */
.verdict{display:inline-block;color:var(--red);border:4px solid var(--red);border-radius:12px;padding:2px 14px;font-weight:900;letter-spacing:.08em;transform:rotate(-4deg)}
.real{display:inline-block;border:4px solid var(--ink);border-radius:12px;padding:2px 14px;font-weight:900;letter-spacing:.08em}
.flags{list-style:none;padding:0;margin:0}
.flags li{border-left:6px solid var(--red);padding:8px 0 8px 16px;margin:14px 0}
.flags b{display:block;font-size:1.1em}
.flag-no{color:var(--red);font-weight:900;letter-spacing:.12em;font-size:.75em;display:block}
.tags{font-weight:700;color:var(--dim);margin:-.2em 0 .8em;word-spacing:.3em}
.paid{font-size:.78em;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--dim);border-radius:6px;padding:1px 6px;color:var(--dim)}
.list a{display:block;padding:12px 0;border-bottom:1px solid var(--line);text-decoration:none}
.list small{color:var(--dim);display:block}
input[type=email]{width:100%;font:inherit;padding:14px;border-radius:14px;border:2px solid var(--line);background:var(--card);color:var(--ink)}
.row{display:flex;gap:12px}.row>*{flex:1}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);font-size:.86em;color:var(--dim)}
footer a{color:var(--ink)}
.hidden{display:none}
@media (min-width:760px){body{font-size:20px}h1{font-size:2.5em}}
`;

/** A phone screen showing a message, like the cover frame. The message is a quote, not our copy. */
export function phone(o: { sender: string; body: string; stamp?: "question" | "verdict"; note?: string }) {
  const stamp =
    o.stamp === "question" ? `<div class="stamp" aria-label="Real or scam?">REAL OR<br>SCAM?</div>` : o.stamp === "verdict" ? `<div class="stamp verdict-stamp">SCAM</div>` : "";
  const initial = /^[+\d(]/.test(o.sender) ? "?" : esc(o.sender.trim().charAt(0).toUpperCase() || "?");
  return `<div class="stage">${stamp}<div class="phone"><div class="screen">
<div class="bar"><span>9:41</span><span>▮▮▮</span></div>
<div class="who"><i>${initial}</i><span>${esc(o.sender)}</span></div>
<div class="when">Text Message · Today 9:41</div>
<div class="bubble" data-quote>${esc(o.body)}</div>
</div></div></div>${o.note ? `<p class="small note">${esc(o.note)}</p>` : ""}`;
}

export function topBar(root: string, right = "") {
  return `<header class="top"><a class="brand" href="${root}"><img src="${root}favicon.svg" alt="" width="28" height="28">Scam or Not</a>${right ? `<span class="case-tag">${right}</span>` : ""}</header>`;
}

export interface ShareImage {
  url: string; // absolute
  alt: string;
}

/** Open Graph + Twitter card tags so links preview in texts, WhatsApp, Facebook and iMessage. */
export function shareTags(o: { title: string; description: string; url?: string; image?: ShareImage }) {
  const t = [
    `<meta property="og:site_name" content="Scam or Not">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    o.url ? `<meta property="og:url" content="${esc(o.url)}">` : "",
    `<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
  ];
  if (o.image)
    t.push(
      `<meta property="og:image" content="${esc(o.image.url)}">`,
      `<meta property="og:image:secure_url" content="${esc(o.image.url)}">`,
      `<meta property="og:image:type" content="image/png">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${esc(o.image.alt)}">`,
      `<meta name="twitter:image" content="${esc(o.image.url)}">`,
      `<meta name="twitter:image:alt" content="${esc(o.image.alt)}">`,
    );
  return t.filter(Boolean).join("\n");
}

export function page(o: { title: string; description: string; body: string; root: string; canonical?: string; image?: ShareImage; extraHead?: string; scripts?: string; top?: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ""}
${shareTags({ title: o.title, description: o.description, url: o.canonical, image: o.image })}
<link rel="icon" href="${o.root}favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="${o.root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${o.root}apple-touch-icon.png">
<meta name="theme-color" content="#0A0C0F">
<link rel="preload" href="${o.root}assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${o.root}assets/site.css">
${o.extraHead ?? ""}
</head>
<body>
<script>try{if(localStorage.getItem("bigText")==="1")document.body.classList.add("big")}catch(e){}</script>
<main>
${o.top ?? topBar(o.root)}
${o.body}
<footer>
<p><a href="${o.root}">Scam or Not</a> · <a href="${o.root}round/">Daily round</a> · <a href="${o.root}scams/">All scams</a> · <a href="${o.root}privacy/">Privacy</a> · <a href="${o.root}terms/">Terms</a></p>
<p>We never text you, call you, or ask for money.</p>
</footer>
</main>
${o.scripts ?? ""}
</body>
</html>
`;
}

export function scamPage(e: Episode, cfg: ChannelConfig, root: string, youtubeUrl?: string) {
  const s = e.script;
  const hashtags = episodeHashtags(e);
  const exact = s.message.body.replace(/\s+/g, " ").trim();
  const body = `
<p class="small" style="margin:.8em 0 0">${esc(e.date)}</p>
<h1 style="margin-top:.15em">Is this text a scam?</h1>
<p class="tags">${hashtags.map(esc).join(" ")}</p>
${s.message.subject ? `<p class="from">Subject: ${esc(s.message.subject)}</p>` : ""}
${phone({ sender: s.message.sender, body: s.message.body, stamp: "verdict", note: s.message.provenance === "recreated" ? s.message.provenanceNote : "A real message, with links and numbers swapped out for safety." })}
<h2>3 red flags</h2>
<ul class="flags">
${s.flags.map((f, i) => `<li><span class="flag-no">RED FLAG ${i + 1}</span><b>${esc(f.label)}</b>${esc(f.say)}<br><span class="small">Source: “${esc(f.evidence.quote)}” <a href="${esc(f.evidence.url)}" rel="nofollow noopener">link</a></span></li>`).join("\n")}
</ul>
<h2>Safe move</h2>
<div class="card"><b>${esc(s.safeMove.label)}</b><br>${esc(s.safeMove.say)}<br><span class="small">Source: “${esc(s.safeMove.evidence.quote)}” <a href="${esc(s.safeMove.evidence.url)}" rel="nofollow noopener">link</a></span></div>
<p><b>${esc(cfg.channel.closer)}</b></p>
${youtubeUrl ? `<a class="btn alt" href="${esc(youtubeUrl)}">Watch the 30-second video</a>` : ""}
<a class="btn main" href="${root}round/">Play today's round</a>
<a class="btn alt" href="${root}">More from Scam or Not</a>
<h2>Sources</h2>
<ul>${e.sources.map((src) => `<li><a href="${esc(src.url)}" rel="nofollow noopener">${esc(src.name)}</a></li>`).join("")}</ul>
`;
  return page({
    top: topBar(root, `Scam No. ${pad3(e.number)}`),
    title: exact,
    description: `Real or scam? Scam #${pad3(e.number)}. Look closer before you tap.`,
    body,
    root,
    canonical: `${cfg.site.baseUrl}/scam/${e.slug}/`,
    image: { url: `${cfg.site.baseUrl}/og/${e.slug}.png`, alt: `Scam #${pad3(e.number)}: a text message. Real or scam?` },
  });
}
