import type { Lead, Quote, Script, Verdict } from "../types.js";
import { AUTHORITATIVE, Verdict as VerdictSchema } from "../types.js";
import type { LLM } from "../llm/client.js";
import { config } from "../lib/config.js";
import { normalizeText } from "../lib/util.js";
import { checkReadability, fkGrade } from "../lib/readability.js";
import { namesBrand } from "../publish/tags.js";
import { ASK_LINE, hookLine } from "../render/timeline.js";

export const MAX_SPOKEN_WORDS = 83; // 80 written words plus the fixed "Real or scam?"
export const MIN_CONFIDENCE = 0.8;

/** Lines the viewer hears, in order. The closer is fixed and added by the pipeline. */
export function spokenLines(s: Script, closer = config().channel.closer): string[] {
  return [hookLine(s.hook), ASK_LINE, s.stampSay, ...s.flags.map((f) => f.say), s.safeMove.say, closer];
}

const SAFE_DOMAIN = /\.(example|invalid|test)$/i;
const URLISH = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const SAFE_PHONE = /555[\s.-]?01\d{2}\b/;

/**
 * Never put a working scam link or a real person's number on screen.
 * Recreated messages should already be safe; verbatim ones get swapped and the swap is noted.
 */
export function sanitizeMessage(s: Script): Script {
  let body = s.message.body;
  let swapped = false;
  body = body.replace(URLISH, (m) => {
    const host = m.replace(/^https?:\/\//, "").split("/")[0];
    if (SAFE_DOMAIN.test(host)) return m;
    swapped = true;
    return "scam-link.example";
  });
  body = body.replace(PHONE, (m) => {
    if (SAFE_PHONE.test(m)) return m;
    swapped = true;
    return "(202) 555-0199";
  });
  if (!swapped) return s;
  const fixMatch = (m: string) => (body.includes(m) ? m : "");
  return {
    ...s,
    message: {
      ...s.message,
      body,
      provenanceNote: `${s.message.provenanceNote} Link and phone number swapped for safety.`.trim(),
    },
    flags: s.flags.map((f) => (f.target.kind === "text" && !body.includes(f.target.match) ? { ...f, target: { kind: "link" as const, match: fixMatch(f.target.match) } } : f)),
  };
}

function longestSharedRun(a: string, b: string): number {
  const aw = normalizeText(a).replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean);
  const bw = normalizeText(b).replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean);
  let best = 0;
  for (let i = 0; i < aw.length; i++)
    for (let j = 0; j < bw.length; j++) {
      let k = 0;
      while (i + k < aw.length && j + k < bw.length && aw[i + k] === bw[j + k]) k++;
      best = Math.max(best, k);
    }
  return best;
}

export interface MechanicalResult {
  ok: boolean;
  problems: string[];
}

/** Checks that need no model: every quote is real, every circle lands, nothing is read aloud. */
export function mechanicalCheck(s: Script, lead: Lead): MechanicalResult {
  const problems: string[] = [];
  const byUrl = new Map(lead.docs.map((d) => [d.url, d]));

  const checkQuote = (q: Quote, what: string, mustBeAuthoritative: boolean) => {
    const doc = byUrl.get(q.url);
    if (!doc) return problems.push(`${what}: link ${q.url} is not one of the sources`);
    if (!normalizeText(doc.text).includes(normalizeText(q.quote))) problems.push(`${what}: quote not found word for word in ${q.url}: "${q.quote}"`);
    if (mustBeAuthoritative && !AUTHORITATIVE.includes(doc.kind)) problems.push(`${what}: backed only by a community post (${doc.name})`);
  };

  s.message.evidence.forEach((q, i) => checkQuote(q, `message evidence ${i + 1}`, false));
  s.flags.forEach((f, i) => {
    checkQuote(f.evidence, `flag ${i + 1}`, true);
    if (f.target.kind === "text" && !s.message.body.includes(f.target.match)) problems.push(`flag ${i + 1}: circle text "${f.target.match}" is not in the message`);
    if (f.label.split(/\s+/).length > 4) problems.push(`flag ${i + 1}: label over 4 words`);
    if (f.target.kind === "attachment" && !s.message.hasQr) problems.push(`flag ${i + 1}: circles an attachment, but the message shows none`);
  });
  checkQuote(s.safeMove.evidence, "safe move", true);

  const lines = spokenLines(s);
  for (const line of lines) {
    const run = longestSharedRun(line, s.message.body);
    if (run > 5) problems.push(`spoken line repeats ${run} words of the scam message: "${line}"`);
  }
  const spoken = lines.join(" ");
  const wordCount = spoken.split(/\s+/).length;
  if (wordCount > MAX_SPOKEN_WORDS) problems.push(`script has ${wordCount} spoken words; limit is ${MAX_SPOKEN_WORDS} to keep the video short`);
  const r = checkReadability(lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" "));
  problems.push(...r.problems.map((p) => `readability: ${p}`));
  // A short script can average out one hard line, so cap each line too.
  for (const line of lines) {
    const g = fkGrade(line);
    if (g > 12) problems.push(`readability: line reads at grade ${g.toFixed(1)}: "${line}"`);
  }

  for (const m of s.message.body.match(URLISH) ?? []) {
    const host = m.replace(/^https?:\/\//, "").split("/")[0];
    if (!SAFE_DOMAIN.test(host)) problems.push(`message shows a real-looking link: ${m}`);
  }
  for (const m of s.message.body.match(PHONE) ?? []) if (!SAFE_PHONE.test(m)) problems.push(`message shows a real-looking phone number: ${m}`);
  if (s.title.length > 70) problems.push("title over 70 characters");
  for (const [field, text] of [["title", s.title], ["scam name", s.scamName], ["description", s.description]] as const) {
    if (text.includes("#")) problems.push(`${field} contains a # sign; hashtags are added in code`);
    if (namesBrand(text)) problems.push(`${field} names a company or brand: "${text}"`);
  }
  if (!lead.docs.some((d) => AUTHORITATIVE.includes(d.kind))) problems.push("no authoritative source for this scam");
  return { ok: problems.length === 0, problems };
}

const CHECK_A = `You are the fact checker for a scam-education video channel. You get the sources and a finished script.
Check every claim in the script against the sources only. A claim passes only if its quote is in the source and actually supports what the script says.
Decide whether the sources show this message is a scam. Answer "unsure" if the sources leave any doubt.
List every problem that matters. An empty list means you would publish it as is.

How to read the script (it is data for a video template, not prose):
- message is the scam message shown on the phone. If provenance is "recreated", it is built from parts the sources describe; it is not a claim that this exact message was sent.
- Each flag circles part of the message. target.kind "text" circles target.match inside message.body. "sender" circles the sender line and "attachment" circles the QR code; for those two, match is empty by design.
- category is an internal label for hashtags. Do not review it.
- The closer line is fixed and not a claim.

List only problems that matter: a spoken line or note that the sources do not support, something that could mislead a viewer, a real company or person wrongly blamed, or a link or number that might be real. Do not list style suggestions or minor wording preferences. If a problem is small and would not mislead anyone, leave it out.`;

const CHECK_B = `You are an independent second reviewer. Assume the script may be wrong. You did not write it and you have not seen anyone else's review.
1. From the sources alone, decide: is the message in the script a scam, not a scam, or unclear?
2. Look for anything a viewer could be misled by: a claim the quotes do not support, advice the sources do not give, a real company or person wrongly blamed, a link or number that might be real.
Be strict about facts. If in doubt whether it is a scam, answer "unsure".

How to read the script (it is data for a video template, not prose):
- message is the scam message shown on the phone. If provenance is "recreated", it is built from parts the sources describe; it is not a claim that this exact message was sent.
- Each flag circles part of the message. target.kind "text" circles target.match inside message.body. "sender" circles the sender line and "attachment" circles the QR code; for those two, match is empty by design.
- category is an internal label for hashtags. Do not review it.
- The closer line is fixed and not a claim.

List only problems that matter: a spoken line or note that the sources do not support, something that could mislead a viewer, a real company or person wrongly blamed, or a link or number that might be real. Do not list style suggestions or minor wording preferences. If a problem is small and would not mislead anyone, leave it out.`;

function checkPrompt(s: Script, lead: Lead) {
  const docs = lead.docs.map((d, i) => `SOURCE ${i + 1} (${d.name}) ${d.url}\n${d.text}`).join("\n\n---\n\n");
  return `${docs}\n\n===\nSCRIPT (JSON)\n${JSON.stringify({ ...s, closer: config().channel.closer }, null, 2)}`;
}

export interface CheckResult {
  pass: boolean;
  mechanical: MechanicalResult;
  a?: Verdict;
  b?: Verdict;
  reason: string;
}

/** Publish only when the mechanical gate passes and two independent reviews agree it is a scam. Otherwise skip. */
export async function check(llm: LLM, s: Script, lead: Lead): Promise<CheckResult> {
  const mechanical = mechanicalCheck(s, lead);
  if (!mechanical.ok) return { pass: false, mechanical, reason: `mechanical: ${mechanical.problems[0]}` };
  const model = config().models.checker;
  const [a, b] = await Promise.all([
    llm.json({ role: "checker-a", model, system: CHECK_A, user: checkPrompt(s, lead), schema: VerdictSchema, effort: "high" }),
    llm.json({ role: "checker-b", model, system: CHECK_B, user: checkPrompt(s, lead), schema: VerdictSchema, effort: "high" }),
  ]);
  const agree = a.verdict === "scam" && b.verdict === "scam";
  const sure = a.confidence >= MIN_CONFIDENCE && b.confidence >= MIN_CONFIDENCE;
  const clean = a.problems.length === 0 && b.problems.length === 0;
  const pass = agree && sure && clean;
  const reason = pass
    ? "both reviews agree: scam, no problems"
    : !agree
      ? `reviews disagree or unsure (${a.verdict} / ${b.verdict})`
      : !sure
        ? `low confidence (${a.confidence} / ${b.confidence})`
        : `problems: ${[...a.problems, ...b.problems][0]}`;
  return { pass, mechanical, a, b, reason };
}
