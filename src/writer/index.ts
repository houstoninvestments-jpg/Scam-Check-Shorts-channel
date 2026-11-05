import type { Lead, Script } from "../types.js";
import { Script as ScriptSchema } from "../types.js";
import type { LLM } from "../llm/client.js";
import { config } from "../lib/config.js";
import { tagConfig } from "../publish/tags.js";

export interface HookVariant {
  id: string;
  pattern: string; // example line the writer adapts
  style?: "punch" | "classic" | "real"; // which opening it belongs to (absent: punch)
}

export type WriteMode = { verdict: "scam" | "real"; opener: "punch" | "classic" };
export const DEFAULT_MODE: WriteMode = { verdict: "scam", opener: "punch" };

const INTRO = `You write short YouTube Shorts (about 30 to 40 seconds spoken, never over 45) for "Scam or Not", a channel that teaches people to spot real scams.`;

const PUNCH_HOOK = `The punch (spoken on the very first frame and slammed on screen in giant letters). 2 to 6 words. Its only job is to stop a doomscroller mid-swipe: shocking, contrarian, an order or a threat, about the viewer, right now. Think "Don't tap this. Seriously." / "Your bank didn't send this." / "This text is a robbery." / "Delete this before your mom sees it." / "Everyone falls for this one." Never soft or polite ("Someone you love...", "Would you tap this?", "Look closer"). Do not ask "real or scam" in it, and never say "decide fast".`;
const CLASSIC_HOOK = `Hook (spoken while a scam message sits on a phone screen). Under 10 words. Do not ask "real or scam" in it, and never say "decide fast".`;
const REAL_HOOK = `The punch (spoken on the very first frame and slammed on screen in giant letters). 2 to 6 words that bait the wrong call: make the viewer sure it's a scam. Think "Everyone deletes this one. Wrong." / "Delete this? Big mistake." / "You'd block this. Don't." Never reveal that it's real. Do not ask "real or scam" in it.`;

const SCAM_BEATS = (hook: string) => `Every video has the same beats:
1. ${hook}
2. The voice asks "Real or scam?" (added later; do not write it). Then a silent pause so viewers can read the message.
3. A red SCAM stamp lands. One short spoken line.
4. Three red flags. Each one is circled on the message, named in 2-4 big words, and explained in one spoken sentence.
5. One safe move: the single best thing to do instead.
6. The closer is fixed and added later: "Send this to the one who'd tap it." Do not write it.`;

const REAL_BEATS = `This video is the twist: the message on the phone is REAL. It is a safe, genuine-style message that most people would wrongly call a scam.
Beats:
1. ${REAL_HOOK}
2. The voice asks "Real or scam?" (added later; do not write it). Then a silent pause so viewers can read the message.
3. A green REAL stamp lands. stampSay is one short spoken line, like "It's real. And it's safe either way."
4. Three safe signs (they go in "flags"). Each one is circled on the message, named in 2-4 big words, and explained in one spoken sentence. Each must be backed by a quote from the sources about how real messages behave or how to check safely.
5. One safe move: how to double-check without risk, like opening the app yourself or calling the number on your card.
6. The closer is fixed and added later. Do not write it.

The message: build a genuine-style message that follows the safe patterns the sources describe. It asks for nothing sensitive, has no link to tap and no number to call back except one the viewer already has, and puts on no pressure. It must still look like something people panic over (an alert, a code, a delivery, a charge). Because no one can prove a sender from a screen, the video's point is that this message is safe to deal with: even if it were fake, it asks for nothing and only points to a channel the viewer already trusts. Say that, never "this company really sent it". Use generic names, never a real company. provenance is "recreated"; provenanceNote says "A typical safe message built by the channel from <source name> guidance." message.evidence quotes the sources on how legitimate messages behave or how to check safely.
Examples of the kind of message (adapt, don't copy):
- "Your sign-in code is 482913. It expires in 10 minutes. Never share this code with anyone."
- "Did you make a purchase of $42.10 today? If not, call the number on the back of your card."
- "Your prescription is ready for pickup at the store you chose. Reply STOP to end texts."`;

const SHARED_RULES = (m: WriteMode) => `Hard rules:
- Explain it in the channel's own words. Never read the message aloud. Never copy more than five words in a row from the message into anything spoken.
- Every ${m.verdict === "real" ? "safe sign" : "red flag"} and the safe move must carry a quote copied word for word from one of the sources given, with that source's link. Copy the quote exactly: same words, same order. If the sources do not back a claim, do not make the claim.
- Each spoken line may say only what its own quote says. Pick the sentence that directly supports the line. Never widen it into a general rule ("no real company ever..."), never add a result the quote doesn't state, and never name a company the source accuses unless you need to.
${m.verdict === "real" ? "" : "- Pick a scam people can meet in a message: a text, email, call, voicemail, DM or chat. Skip court cases and settlements unless the source describes the message itself.\n"}- target.kind "attachment" means the QR code or file shown in the message; use it only when message.hasQr is true.
- Use only these sources. Add no facts from memory: no statistics, no dollar totals, no agency names that the sources do not name.
${m.verdict === "real" ? "" : '- message.provenance is "verbatim" only if a source quotes the full message. Otherwise "recreated": build the message only from parts the sources describe, and say which source in provenanceNote.\n'}${
  m.opener === "classic" || m.verdict === "real"
    ? '- In a recreated message, use generic names ("Toll Services", "State Court") rather than real company or agency names.'
    : "- In a recreated message, name the company or agency the source says scammers pretend to be (a toll agency, the postal service, a bank by the name the source uses) so it looks like what really lands on phones. If the source names none, use a generic name. Never put a real company name in the title, scam name or description."
} Use phone numbers in the range set aside for fiction, like (202) 555-0142 (555-0100 to 555-0199) and links on example.com-style fake domains that cannot resolve, such as "pay-tolls.example". Never a real, working link.
- If you circle text, target.match must be an exact substring of message.body.
- Plain words. Grade 8 reading level. Every sentence under 18 words. No jargon. If you use a term like "QR code", the visual makes it clear.
${
  m.opener === "classic"
    ? "- Calm, kind, and direct. Never mock the people who fall for scams.\n- Title: what the scam is, under 70 characters, no fake urgency, no all caps words."
    : `- Tone: a sharp friend who is fed up with scammers. Fast, blunt, a little provocative. No filler, no gentle lead-ins. Never mock the people who fall for scams; aim the heat at the scammers.\n- Title: written to get the click. Bold, curious or contrarian, under 60 characters (${m.verdict === "real" ? '"Everyone Deletes This Text. It\'s Real."' : '"Don\'t Tap This Toll Text", "Your Bank Didn\'t Send This"'}). At most one all-caps word. It must not get the verdict wrong.`
}
- Never write hashtags or the # sign anywhere. Never name a real company or brand in the title, scam name or description.`;

/** The writer's instructions for one kind of video. */
export function systemPrompt(m: WriteMode = DEFAULT_MODE): string {
  const beats = m.verdict === "real" ? REAL_BEATS : SCAM_BEATS(m.opener === "classic" ? CLASSIC_HOOK : PUNCH_HOOK);
  return `${INTRO}\n\n${beats}\n\n${SHARED_RULES(m)}`;
}
export const SYSTEM = systemPrompt();

export function userPrompt(lead: Lead, hook: HookVariant, skin: string, feedback: string[] = [], previous?: Script, mode: WriteMode = DEFAULT_MODE): string {
  const docs = lead.docs
    .map((d, i) => `SOURCE ${i + 1}\nname: ${d.name}\nlink: ${d.url}\ntitle: ${d.title}\npublished: ${d.publishedAt ?? "unknown"}\ntext:\n${d.text}`)
    .join("\n\n---\n\n");
  const fix = feedback.length
    ? `\n\nYour last draft failed these checks. Fix every one:\n- ${feedback.join("\n- ")}${
        previous ? `\n\nYour last draft is below. Change only what the checks call out; keep everything else the same.\n${JSON.stringify(previous, null, 2)}` : ""
      }`
    : "";
  return `${mode.verdict === "real" ? "Write the twist video: a REAL, safe message, using what these sources say real messages look like and how to check safely." : "Write the video for this scam."}

Screen style: ${skin} (the message appears in this kind of app).
Hook style to adapt: "${hook.pattern}"
Category: pick the one id that fits best, or leave it empty: ${tagConfig().categories.map((c) => c.id).join(", ")}

${docs}${fix}`;
}

export async function write(llm: LLM, lead: Lead, hook: HookVariant, skin: string, feedback: string[] = [], previous?: Script, mode: WriteMode = DEFAULT_MODE): Promise<Script> {
  const script = await llm.json({
    role: feedback.length ? "writer-retry" : "writer",
    model: config().models.writer,
    system: systemPrompt(mode),
    user: userPrompt(lead, hook, skin, feedback, previous, mode),
    schema: ScriptSchema,
    effort: "high",
  });
  return { ...script, verdict: mode.verdict, opener: mode.opener };
}
