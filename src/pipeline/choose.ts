import type { Channel, CtaState, Episode, SkinId } from "../types.js";

/** Match the screen to how the scam arrives. Texts alternate between the two phone styles. */
export function chooseSkin(channel: Channel, past: Episode[]): SkinId {
  const direct: Partial<Record<Channel, SkinId>> = { email: "email", voicemail: "voicemail", marketplace: "marketplace", dm: "dm" };
  if (direct[channel]) return direct[channel]!;
  const lastText = [...past].reverse().find((e) => e.skin === "imessage" || e.skin === "android");
  return lastText?.skin === "imessage" ? "android" : "imessage";
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
