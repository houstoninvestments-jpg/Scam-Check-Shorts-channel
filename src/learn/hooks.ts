import type { HookVariant } from "../writer/index.js";
import { path, readJson, writeJson } from "../lib/util.js";

export interface HookStats {
  n: number; // videos measured
  sum: number; // sum of reward (0..1)
}

export interface HookFile {
  variants: HookVariant[];
  stats: Record<string, HookStats>;
}

const FILE = () => process.env.HOOKS_FILE || path("data/hooks.json");

export const loadHooks = () => readJson<HookFile>(FILE());
export const saveHooks = (h: HookFile) => writeJson(FILE(), h);

/**
 * Pick the next hook. Untested hooks go first; after that, mostly the best average
 * (upper confidence bound), so a lucky early video can't lock in one hook forever.
 */
export function pickHook(h: HookFile, recent: string[] = []): HookVariant {
  const untested = h.variants.filter((v) => !h.stats[v.id]?.n);
  if (untested.length) return untested.find((v) => !recent.includes(v.id)) ?? untested[0];
  const total = h.variants.reduce((n, v) => n + (h.stats[v.id]?.n ?? 0), 0);
  let best = h.variants[0];
  let bestScore = -Infinity;
  for (const v of h.variants) {
    const s = h.stats[v.id]!;
    const ucb = s.sum / s.n + Math.sqrt((2 * Math.log(total)) / s.n) * 0.35;
    const penalty = recent[0] === v.id ? 0.05 : 0; // light nudge against the same hook two days running
    if (ucb - penalty > bestScore) {
      bestScore = ucb - penalty;
      best = v;
    }
  }
  return best;
}

export function recordReward(h: HookFile, id: string, reward: number) {
  const s = (h.stats[id] ??= { n: 0, sum: 0 });
  s.n += 1;
  s.sum += Math.max(0, Math.min(1, reward));
}
