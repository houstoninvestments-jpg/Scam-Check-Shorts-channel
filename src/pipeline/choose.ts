import type { Channel, CtaState, Episode, Lead, SkinId } from "../types.js";
import { categoryFor, namesBrand, tagConfig } from "../publish/tags.js";

/**
 * Match the screen to how the scam arrives. Texts alternate between the two phone styles.
 * A skin already used today is never used again that day: returns null, and that scam waits.
 */
export function chooseSkin(channel: Channel, past: Episode[], usedToday: Set<SkinId> = new Set()): SkinId | null {
  const direct: Partial<Record<Channel, SkinId>> = { email: "email", voicemail: "voicemail", marketplace: "marketplace", dm: "dm" };
  if (direct[channel]) return usedToday.has(direct[channel]!) ? null : direct[channel]!;
  const lastText = [...past].reverse().find((e) => e.skin === "imessage" || e.skin === "android");
  const order: SkinId[] = lastText?.skin === "imessage" ? ["android", "imessage"] : ["imessage", "android"];
  return order.find((s) => !usedToday.has(s)) ?? null;
}

/** What makes two scams "the same kind" for one day: the scam type and any brand named. */
export interface DayMark {
  category: string;
  brands: string[];
}

/** Brands from the blocklist named in a text (the source's words, not ours: we never name brands on screen). */
export function brandsIn(text: string, cfg = tagConfig()): string[] {
  return cfg.blockedBrands.filter((b) => namesBrand(text, { ...cfg, blockedBrands: [b] }));
}

/**
 * Two scams on the same day must differ in type or brand. Returns the earlier one this would echo, if any:
 * same type and the same brand, or same type with no brand on either side.
 */
export function sameDayClash(c: DayMark, today: DayMark[]): DayMark | undefined {
  return today.find((t) => t.category === c.category && ((!t.brands.length && !c.brands.length) || t.brands.some((b) => c.brands.includes(b))));
}

/** A published episode's mark. Episodes saved before brands were recorded fall back to the message text. */
export function episodeMark(e: Episode): DayMark {
  const category = e.category ?? categoryFor(e.script).id;
  return { category, brands: e.brands ?? brandsIn(`${e.script.message.sender} ${e.script.message.subject} ${e.script.message.body}`) };
}

/** Best guess at a lead's mark before writing anything, from the source's own words. Saves a write on obvious repeats. */
export function leadMark(lead: Lead): DayMark {
  const text = `${lead.title} ${lead.docs.map((d) => d.text.slice(0, 1500)).join(" ")}`;
  const category = categoryFor({ scamName: lead.title, title: "", message: { sender: "", subject: "", body: lead.docs[0]?.text.slice(0, 1500) ?? "", hasQr: false } } as any).id;
  return { category, brands: brandsIn(text) };
}

/**
 * Spread the three call-to-action states evenly so each can be measured.
 * Picks the state used least in the last 9 videos; ties go to the one used longest ago.
 */
export function chooseCta(past: Episode[], states: CtaState[] = ["none", "soft", "direct"]): CtaState {
  const window = past.slice(-9);
  const used = past.map((e) => e.cta);
  const counts = states.map((s) => ({ s, n: window.filter((e) => e.cta === s).length, lastAt: used.lastIndexOf(s) }));
  counts.sort((a, b) => a.n - b.n || a.lastAt - b.lastAt || states.indexOf(a.s) - states.indexOf(b.s));
  return counts[0].s;
}
