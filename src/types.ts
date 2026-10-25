import { z } from "zod";

export const SourceKind = z.enum(["ftc", "bbb", "ag", "reddit"]);
export type SourceKind = z.infer<typeof SourceKind>;

/** A source is "authoritative" when it may back a red flag or safe move. */
export const AUTHORITATIVE: SourceKind[] = ["ftc", "bbb", "ag"];

export interface SourceDoc {
  kind: SourceKind;
  name: string; // "FTC Consumer Alerts"
  url: string;
  title: string;
  publishedAt: string | null; // ISO date
  fetchedAt: string;
  text: string; // plain text body, used for verbatim quote checks
  /** How the text was captured. "page" = full page fetch. Anything else is noted on the record. */
  capture: string;
}

export interface Lead {
  id: string; // stable hash of the primary URL
  title: string;
  channel: Channel;
  docs: SourceDoc[]; // primary first, then corroborating docs
  score: number;
  reasons: string[];
}

export const Channel = z.enum(["text", "email", "voicemail", "marketplace", "dm"]);
export type Channel = z.infer<typeof Channel>;

export const SkinId = z.enum(["imessage", "android", "email", "voicemail", "marketplace", "dm"]);
export type SkinId = z.infer<typeof SkinId>;

export const CtaState = z.enum(["none", "soft", "direct"]);
export type CtaState = z.infer<typeof CtaState>;

export const Quote = z.object({
  quote: z.string().min(8).describe("Exact words copied from the source text. No edits."),
  url: z.string().url().describe("The source link the quote comes from."),
});
export type Quote = z.infer<typeof Quote>;

export const Target = z.object({
  kind: z.enum(["sender", "text", "link", "attachment"]),
  match: z.string().describe("For kind=text: an exact substring of message.body to circle. Otherwise empty."),
});

export const Flag = z.object({
  label: z.string().describe("2 to 4 words, shown big. Plain words."),
  say: z.string().describe("One spoken sentence, under 16 words, in the channel's own words."),
  target: Target,
  evidence: Quote,
});
export type Flag = z.infer<typeof Flag>;

/** What the writer returns. Everything the viewer sees or hears lives here. */
export const Script = z.object({
  scamName: z.string().describe("Short name, e.g. 'Fake traffic ticket text'."),
  message: z.object({
    sender: z.string(),
    subject: z.string().describe("Email subject or empty."),
    body: z.string().describe("The scam message as it appears on the phone."),
    hasQr: z.boolean(),
    provenance: z.enum(["verbatim", "recreated"]),
    provenanceNote: z.string().describe("For recreated: which source it was recreated from."),
    evidence: z.array(Quote).min(1).describe("Quotes that show this message (or its parts) is real and circulating."),
  }),
  hook: z.string().describe("Spoken over the opening. Under 10 words."),
  stampSay: z.string().describe("Spoken as the SCAM stamp lands. Under 8 words."),
  flags: z.array(Flag).length(3),
  safeMove: z.object({
    label: z.string().describe("2 to 5 words, shown big."),
    say: z.string().describe("One spoken sentence, under 18 words."),
    evidence: Quote,
  }),
  title: z.string().describe("YouTube title, under 70 characters, no clickbait lies."),
  description: z.string().describe("2 to 3 short sentences. Plain words."),
  // The writer only picks a category id from config/hashtags.json. Hashtags and search tags are built in code.
  category: z.string().optional().describe("One category id from the list in the prompt. Leave empty if none fits."),
});
export type Script = z.infer<typeof Script>;

export const Verdict = z.object({
  verdict: z.enum(["scam", "not_scam", "unsure"]),
  confidence: z.number().min(0).max(1),
  problems: z.array(z.string()).describe("Each claim that is not backed by its quote, or any factual risk."),
});
export type Verdict = z.infer<typeof Verdict>;

export interface Episode {
  number: number; // Scam #001
  leadId: string;
  date: string; // YYYY-MM-DD
  skin: SkinId;
  cta: CtaState;
  hookVariant: string;
  script: Script;
  sources: { url: string; name: string; capture: string }[];
  slug: string;
  youtubeId?: string;
  status: "scripted" | "checked" | "rendered" | "published" | "skipped";
  skipReason?: string;
  voice?: string;
  thumbnail?: { ok: boolean; detail: string };
  category?: string; // id from config/hashtags.json
  youtubePrivacy?: "public" | "unlisted" | "private";
  youtubeHold?: string; // why an uploaded video is kept hidden
  slot?: number; // which of the day's posting slots made it (1-3)
  brands?: string[]; // brands the sources name, used only to keep one day's scams different
  costUsd?: number; // model cost of the run that made it, at list prices
  renderAttempts?: number; // tries at voice, render and upload after the checks passed
  loopSimilarity?: number;
}

export interface Ledger {
  nextNumber: number;
  episodes: Episode[];
  skipped: { leadId: string; date: string; reason: string }[];
  firstUploadCheck?: { videoId: string; checkedAt: string; locked: boolean; detail: string };
}
