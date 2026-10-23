import type { Lead, Script } from "../types.js";
import { Script as ScriptSchema } from "../types.js";
import type { LLM } from "../llm/client.js";
import { config } from "../lib/config.js";

export interface HookVariant {
  id: string;
  pattern: string; // example line the writer adapts
}

export const SYSTEM = `You write 30-second YouTube Shorts for "Scam or Not", a channel that teaches people to spot real scams.

Every video has the same beats:
1. Hook (spoken while a scam message sits on a phone screen). Under 10 words.
2. A silent 3-2-1 countdown: "real or scam?"
3. A red SCAM stamp lands. One short spoken line.
4. Three red flags. Each one is circled on the message, named in 2-4 big words, and explained in one spoken sentence.
5. One safe move: the single best thing to do instead.
6. The closer is fixed and added later: "Send this to the one who'd tap it." Do not write it.

Hard rules:
- Explain the scam in the channel's own words. Never read the scam message aloud. Never copy more than five words in a row from the message into anything spoken.
- Every red flag and the safe move must carry a quote copied word for word from one of the sources given, with that source's link. Copy the quote exactly: same words, same order. If the sources do not back a claim, do not make the claim.
- Use only these sources. Add no facts from memory: no statistics, no dollar totals, no agency names that the sources do not name.
- message.provenance is "verbatim" only if a source quotes the full message. Otherwise "recreated": build the message only from parts the sources describe, and say which source in provenanceNote.
- In a recreated message, use generic names ("Toll Services", "State Court") rather than real company or agency names. Use phone numbers in the range set aside for fiction, like (202) 555-0142 (555-0100 to 555-0199) and links on example.com-style fake domains that cannot resolve, such as "pay-tolls.example". Never a real, working link.
- If you circle text, target.match must be an exact substring of message.body.
- Plain words. Grade 8 reading level. Every sentence under 18 words. No jargon. If you use a term like "QR code", the visual makes it clear.
- Calm, kind, and direct. Never mock the people who fall for scams.
- Title: what the scam is, under 70 characters, no fake urgency, no all caps words.`;

export function userPrompt(lead: Lead, hook: HookVariant, skin: string, feedback: string[] = []): string {
  const docs = lead.docs
    .map((d, i) => `SOURCE ${i + 1}\nname: ${d.name}\nlink: ${d.url}\ntitle: ${d.title}\npublished: ${d.publishedAt ?? "unknown"}\ntext:\n${d.text}`)
    .join("\n\n---\n\n");
  const fix = feedback.length ? `\n\nYour last draft failed these checks. Fix every one:\n- ${feedback.join("\n- ")}` : "";
  return `Write the video for this scam.

Screen style: ${skin} (the message appears in this kind of app).
Hook style to adapt: "${hook.pattern}"

${docs}${fix}`;
}

export async function write(llm: LLM, lead: Lead, hook: HookVariant, skin: string, feedback: string[] = []): Promise<Script> {
  return llm.json({
    role: feedback.length ? "writer-retry" : "writer",
    model: config().models.writer,
    system: SYSTEM,
    user: userPrompt(lead, hook, skin, feedback),
    schema: ScriptSchema,
    effort: "high",
  });
}
