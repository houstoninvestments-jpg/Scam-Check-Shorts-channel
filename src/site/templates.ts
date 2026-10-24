import type { Episode } from "../types.js";
import type { ChannelConfig } from "../lib/config.js";
import { episodeHashtags } from "../publish/youtube.js";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad3 = (n: number) => String(n).padStart(3, "0");

/** Light, high-contrast, phone-first. Red appears only on the SCAM verdict and the red flags. */
export const CSS = `
:root{--bg:#fff;--ink:#0d0f12;--dim:#4a515c;--line:#d9dde3;--card:#f4f5f7;--red:#d70015;--btn:#0d0f12;--btnInk:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b0d10;--ink:#f5f6f8;--dim:#b4bac4;--line:#2a2f37;--card:#161a20;--red:#ff453a;--btn:#f5f6f8;--btnInk:#0b0d10}}
:root[data-theme="dark"]{--bg:#0b0d10;--ink:#f5f6f8;--dim:#b4bac4;--line:#2a2f37;--card:#161a20;--red:#ff453a;--btn:#f5f6f8;--btnInk:#0b0d10}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body.big{font-size:23px}
main{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:2em;line-height:1.1;margin:.4em 0 .3em;letter-spacing:-.02em}
h2{font-size:1.3em;margin:1.6em 0 .5em}
a{color:inherit}
p{margin:.6em 0}
.lede{font-size:1.15em;color:var(--dim)}
.btn{display:block;width:100%;text-align:center;background:var(--btn);color:var(--btnInk);border:0;border-radius:14px;padding:16px 18px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;margin:12px 0}
.btn.alt{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:16px 0}
.never{border:2px solid var(--ink);font-weight:600}
.bubble{background:var(--card);border:1px solid var(--line);border-radius:22px 22px 22px 6px;padding:16px 18px;white-space:pre-wrap;font-size:1.05em}
.sender{font-size:.85em;color:var(--dim);margin:0 0 6px 4px}
.verdict{display:inline-block;color:var(--red);border:3px solid var(--red);border-radius:10px;padding:2px 12px;font-weight:900;letter-spacing:.08em;transform:rotate(-4deg)}
.flags{list-style:none;padding:0;margin:0}
.flags li{border-left:5px solid var(--red);padding:6px 0 6px 14px;margin:12px 0}
.flags b{display:block}
.real{display:inline-block;border:3px solid var(--ink);border-radius:10px;padding:2px 12px;font-weight:900;letter-spacing:.08em}
.paid{font-size:.8em;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--dim);border-radius:6px;padding:1px 6px;color:var(--dim)}
.list a{display:block;padding:12px 0;border-bottom:1px solid var(--line);text-decoration:none}
.list small{color:var(--dim);display:block}
input[type=email]{width:100%;font:inherit;padding:14px;border-radius:12px;border:2px solid var(--line);background:var(--bg);color:var(--ink)}
.small{font-size:.85em;color:var(--dim)}
.row{display:flex;gap:12px}.row>*{flex:1}
footer{margin-top:48px;font-size:.85em;color:var(--dim)}
.hidden{display:none}
.tags{font-weight:700;color:var(--dim);margin:-.2em 0 .8em;word-spacing:.3em}
`;

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

export function page(o: { title: string; description: string; body: string; root: string; canonical?: string; image?: ShareImage; extraHead?: string; scripts?: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ""}
${shareTags({ title: o.title, description: o.description, url: o.canonical, image: o.image })}
<link rel="stylesheet" href="${o.root}assets/site.css">
${o.extraHead ?? ""}
</head>
<body>
<script>try{if(localStorage.getItem("bigText")==="1")document.body.classList.add("big")}catch(e){}</script>
<main>
${o.body}
<footer>
<p><a href="${o.root}">Scam or Not</a> · <a href="${o.root}round/">Daily round</a> · <a href="${o.root}scams/">All scams</a></p>
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
<p class="small">Scam #${pad3(e.number)} · ${esc(e.date)}</p>
<h1>Is this text a scam?</h1>
<p class="tags">${hashtags.map(esc).join(" ")}</p>
<p class="sender">From: ${esc(s.message.sender)}${s.message.subject ? ` · Subject: ${esc(s.message.subject)}` : ""}</p>
<div class="bubble">${esc(s.message.body)}</div>
<p class="small">${esc(s.message.provenance === "recreated" ? s.message.provenanceNote : "A real message, with links and numbers swapped out for safety.")}</p>
<p style="margin:20px 0"><span class="verdict">SCAM</span></p>
<h2>3 red flags</h2>
<ul class="flags">
${s.flags.map((f) => `<li><b>${esc(f.label)}</b>${esc(f.say)}<br><span class="small">Source: “${esc(f.evidence.quote)}” <a href="${esc(f.evidence.url)}" rel="nofollow noopener">link</a></span></li>`).join("\n")}
</ul>
<h2>Safe move</h2>
<div class="card"><b>${esc(s.safeMove.label)}</b><br>${esc(s.safeMove.say)}<br><span class="small">Source: “${esc(s.safeMove.evidence.quote)}” <a href="${esc(s.safeMove.evidence.url)}" rel="nofollow noopener">link</a></span></div>
<p><b>${esc(cfg.channel.closer)}</b></p>
${youtubeUrl ? `<a class="btn alt" href="${esc(youtubeUrl)}">Watch the 30-second video</a>` : ""}
<a class="btn" href="${root}round/">Try today's 3-text round</a>
<a class="btn alt" href="${root}">More from Scam or Not</a>
<h2>Sources</h2>
<ul>${e.sources.map((src) => `<li><a href="${esc(src.url)}" rel="nofollow noopener">${esc(src.name)}</a></li>`).join("")}</ul>
`;
  return page({
    title: exact,
    description: `Real or scam? Scam #${pad3(e.number)}. Look closer before you tap.`,
    body,
    root,
    canonical: `${cfg.site.baseUrl}/scam/${e.slug}/`,
    image: { url: `${cfg.site.baseUrl}/og/${e.slug}.png`, alt: `Scam #${pad3(e.number)}: a text message. Real or scam?` },
  });
}
