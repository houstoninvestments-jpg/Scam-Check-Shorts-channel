import type { Channel, Episode, Lead, SourceDoc } from "../types.js";
import { AUTHORITATIVE } from "../types.js";
import { sha } from "../lib/util.js";

const STOP = new Set(
  "the a an and or of to in on for is are be this that it you your with from by as at about not if they them their our we can will was were has have had do does did".split(" "),
);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const docKey = (d: SourceDoc) => tokens(`${d.title} ${d.text.slice(0, 600)}`);

/** Is this page actually about a scam? Agencies also post recalls, settlements, and tips. */
export function isScamDoc(d: SourceDoc) {
  return /\bscam|fraud|phish|impersonat|fake|smish|con artist/i.test(`${d.title} ${d.text.slice(0, 1500)}`) && !skipReason(d);
}

/**
 * Pages that mention scams but can't make a video: case roundups and enforcement news (no message to show),
 * and general safety guides (no single scam). Dropped before any model sees them.
 */
export function skipReason(d: SourceDoc): string | undefined {
  const title = d.title.toLowerCase();
  if (/\b\d+\s+(criminal\s+)?(cases|charges|defendants|arrests)\b|\bsentenced\b|\bpleads? guilty\b|\bindicted\b|\bconvicted\b|\bsettle(ment|s|d)?\b|\blawsuit\b|\bsues\b|\bjudgment\b|\bsecures?\b[^.]*\$|\brecovers?\b[^.]*\$|\bannounces? (arrest|charges)\b|\bshuts? down\b/.test(title))
    return "case or enforcement news";
  if (/\bparent(s|ing)?\b|\bback[- ]to[- ]school\b|\bsafety tips\b|\bways to (stay safe|protect)\b|\bawareness month\b|\bcybersecurity tips\b|\bholiday (shopping|safety) tips\b|\bnewsletter\b|\bweek in review\b/.test(title))
    return "general safety guide";
  // A video needs a message people actually get.
  if (!/\btext(s|ed| message)?\b|\bemail|\bcall(s|er|ed)?\b|voicemail|\bmessage|\bdm\b|\bqr\b|\blink\b|website|\bad(s|vert)?\b|\bpost(s|ing)?\b|\bletter\b|\bpop-?up|\bapp\b/i.test(`${d.title} ${d.text.slice(0, 2500)}`))
    return "no message to show";
  return undefined;
}

export function detectChannel(d: SourceDoc): Channel {
  const t = `${d.title} ${d.text.slice(0, 2000)}`.toLowerCase();
  if (/voicemail|robocall|phone call|calls? (you|from)|caller/.test(t) && !/\btext/.test(d.title.toLowerCase())) return "voicemail";
  if (/marketplace|seller|buyer|listing|craigslist|offerup/.test(t)) return "marketplace";
  if (/instagram|direct message|\bdm\b|social media message|tiktok|facebook message/.test(t)) return "dm";
  if (/\bemail|inbox|subject line/.test(t) && !/\btext/.test(t)) return "email";
  return "text";
}

/** Text scams ride the phone screen best; then email, then the rest. */
const CHANNEL_BONUS: Record<Channel, number> = { text: 0.15, email: 0.08, dm: 0.06, marketplace: 0.06, voicemail: 0.04 };

export function freshness(publishedAt: string | null, now = Date.now(), halfLifeDays = 10) {
  if (!publishedAt) return 0.3;
  const ageDays = Math.max(0, (now - Date.parse(publishedAt)) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Group docs that describe the same scam, then score each group. */
export function buildLeads(docs: SourceDoc[], weights: Record<string, number>, opts: { maxAgeDays: number; now?: number }): Lead[] {
  const now = opts.now ?? Date.now();
  const fresh = docs.filter(
    (d) => isScamDoc(d) && (!d.publishedAt || now - Date.parse(d.publishedAt) <= opts.maxAgeDays * 86_400_000),
  );
  const groups: SourceDoc[][] = [];
  for (const d of fresh) {
    const k = docKey(d);
    const g = groups.find((g) => g.some((x) => jaccard(docKey(x), k) >= 0.22));
    if (g) g.push(d);
    else groups.push([d]);
  }
  return groups
    .map((g) => {
      const sorted = [...g].sort(
        (a, b) => Number(AUTHORITATIVE.includes(b.kind)) - Number(AUTHORITATIVE.includes(a.kind)) || (weights[b.name] ?? 0.5) - (weights[a.name] ?? 0.5),
      );
      const primary = sorted[0];
      const reasons: string[] = [];
      const f = Math.max(...g.map((d) => freshness(d.publishedAt, now)));
      reasons.push(`freshness ${f.toFixed(2)}`);
      let score = f * (weights[primary.name] ?? 0.5);
      const kinds = new Set(g.map((d) => d.kind));
      if (kinds.size > 1) {
        score += 0.1 * (kinds.size - 1);
        reasons.push(`seen in ${kinds.size} kinds of source`);
      }
      const channel = detectChannel(primary);
      score += CHANNEL_BONUS[channel];
      reasons.push(`channel ${channel}`);
      if (!g.some((d) => AUTHORITATIVE.includes(d.kind))) {
        score *= 0.2; // community reports alone cannot back the red flags
        reasons.push("no authoritative source");
      }
      return { id: sha(primary.url), title: primary.title, channel, docs: sorted, score: +score.toFixed(4), reasons } satisfies Lead;
    })
    .sort((a, b) => b.score - a.score);
}

/** Drop leads we already covered: same URL, or the same scam described again. */
export function dedupe(leads: Lead[], past: Episode[], threshold: number): { kept: Lead[]; dropped: { id: string; why: string }[] } {
  const usedUrls = new Set(past.flatMap((e) => e.sources.map((s) => s.url)));
  const pastKeys = past.map((e) => ({ n: e.number, k: tokens(`${e.script.scamName} ${e.script.title} ${e.script.message.body}`) }));
  const kept: Lead[] = [];
  const dropped: { id: string; why: string }[] = [];
  for (const l of leads) {
    const hit = l.docs.find((d) => usedUrls.has(d.url));
    if (hit) {
      dropped.push({ id: l.id, why: `source already used: ${hit.url}` });
      continue;
    }
    const k = tokens(`${l.title} ${l.docs[0].text.slice(0, 600)}`);
    const twin = pastKeys.find((p) => jaccard(p.k, k) >= threshold);
    if (twin) {
      dropped.push({ id: l.id, why: `same scam as #${twin.n}` });
      continue;
    }
    kept.push(l);
  }
  return { kept, dropped };
}
