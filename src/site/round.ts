import type { Episode } from "../types.js";
import { sha } from "../lib/util.js";
import { episodeHashtags } from "../publish/youtube.js";

export interface RoundItem {
  sender: string;
  body: string;
  answer: "scam" | "real";
  why: string;
  flags?: string[];
  page?: string; // breakdown page for scam items
}

export interface Round {
  date: string;
  number: number; // the newest Scam # on that day, used in the share line
  hashtags: string[]; // the newest scam's hashtags, added to the share text
  items: RoundItem[];
}

export interface LegitItem {
  id: string;
  sender: string;
  body: string;
  why: string;
}

/** Deterministic shuffle so a given day's round is the same for everyone. */
function seeded<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let h = parseInt(sha(seed, 8), 16);
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Three messages: always at least one scam and one real. The newest scam is always in,
 * so the round matches that day's Short; the rest come from past scams and the real pool.
 */
export function buildRound(date: string, episodes: Episode[], legit: LegitItem[], baseUrl: string): Round | null {
  const eps = episodes.filter((e) => e.date <= date && (e.status === "published" || e.status === "rendered"));
  if (!eps.length || legit.length < 2) return null;
  const newest = eps.at(-1)!;
  const scamCount = parseInt(sha(date, 2), 16) % 2 === 0 ? 2 : 1; // varies day to day: 2 scams + 1 real, or 1 + 2
  const otherScams = seeded(eps.slice(0, -1), date).slice(0, scamCount - 1);
  const scams = [newest, ...otherScams];
  const reals = seeded(legit, date + "real").slice(0, 3 - scams.length);
  const items: RoundItem[] = [
    ...scams.map((e) => ({
      sender: e.script.message.sender,
      body: e.script.message.body,
      answer: "scam" as const,
      why: e.script.safeMove.say,
      flags: e.script.flags.map((f) => f.label),
      page: `${baseUrl}/scam/${e.slug}/`,
    })),
    ...reals.map((r) => ({ sender: r.sender, body: r.body, answer: "real" as const, why: r.why })),
  ];
  return { date, number: newest.number, hashtags: episodeHashtags(newest), items: seeded(items, date + "order") };
}

export function shareLine(number: number, caught: number, total = 3) {
  return `Scam #${String(number).padStart(3, "0")} · I caught ${caught} of ${total}`;
}
