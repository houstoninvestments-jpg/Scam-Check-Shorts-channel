import type { Episode } from "../types.js";
import { loadLedger, published } from "../lib/ledger.js";
import { log, path, readJson, writeJson } from "../lib/util.js";
import type { Uploader } from "../publish/youtube.js";
import { loadHooks, recordReward, saveHooks } from "./hooks.js";

export interface VideoMetrics {
  videoId: string;
  number: number;
  hookVariant: string;
  cta: string;
  views: number;
  averageViewPercentage: number; // can pass 100 on Shorts because of loops
  holdAt10: number | null; // share of viewers still watching 10% in (about 3 seconds): the hook
  scored: boolean;
  measuredAt: string;
}

const METRICS = () => process.env.METRICS_FILE || path("data/metrics.json");
const SCORED = () => process.env.SCORED_FILE || path("data/metrics-scored.json");
export const RETENTION_DAYS = 30;
const MIN_AGE_DAYS = 3;
const MIN_VIEWS = 50;
const GIVE_UP_DAYS = 21;

async function report(u: Uploader, params: Record<string, string>) {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await u.fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${qs}`, { headers: { authorization: `Bearer ${await u.token()}` } });
  if (!res.ok) throw new Error(`analytics ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { columnHeaders: { name: string }[]; rows?: (string | number)[][] };
}

/** Reward in 0..1: half how much of the video people watch, half how many stay past the hook. */
export function reward(m: Pick<VideoMetrics, "averageViewPercentage" | "holdAt10">): number {
  const watch = Math.min(1, m.averageViewPercentage / 100);
  const hook = m.holdAt10 === null ? watch : Math.min(1, m.holdAt10 / 1.0);
  return +(0.5 * watch + 0.5 * hook).toFixed(4);
}

export async function measure(u: Uploader, ep: Episode, now = new Date()): Promise<VideoMetrics | null> {
  const start = ep.date;
  const end = now.toISOString().slice(0, 10);
  const totals = await report(u, { startDate: start, endDate: end, metrics: "views,averageViewPercentage", dimensions: "video", filters: `video==${ep.youtubeId}` });
  const row = totals.rows?.[0];
  if (!row) return null;
  const views = Number(row[1]);
  const avgPct = Number(row[2]);
  let holdAt10: number | null = null;
  try {
    const curve = await report(u, { startDate: start, endDate: end, metrics: "audienceWatchRatio", dimensions: "elapsedVideoTimeRatio", filters: `video==${ep.youtubeId}` });
    const point = curve.rows?.find((r) => Math.abs(Number(r[0]) - 0.1) < 0.006);
    holdAt10 = point ? Number(point[1]) : null;
  } catch {
    // retention curves need enough views; totals alone still teach us something
  }
  return { videoId: ep.youtubeId!, number: ep.number, hookVariant: ep.hookVariant, cta: ep.cta, views, averageViewPercentage: avgPct, holdAt10, scored: false, measuredAt: now.toISOString() };
}

/**
 * Read retention for each published video once it has a few days of data,
 * then credit its hook so the next scripts lean toward hooks that hold people.
 */
export async function learn(u: Uploader, now = new Date()) {
  const ledger = loadLedger();
  const metrics = readJson<Record<string, VideoMetrics>>(METRICS(), {});
  const hooks = loadHooks();
  const alreadyScored = new Set(readJson<string[]>(SCORED(), []));
  let scored = 0;
  for (const ep of published(ledger)) {
    if (!ep.youtubeId || metrics[ep.youtubeId]?.scored || alreadyScored.has(ep.youtubeId)) continue;
    const age = (now.getTime() - Date.parse(ep.date)) / 86_400_000;
    if (age < MIN_AGE_DAYS) continue;
    const m = await measure(u, ep, now);
    if (!m) continue;
    const ready = m.views >= MIN_VIEWS || age >= GIVE_UP_DAYS;
    if (ready && m.views > 0) {
      recordReward(hooks, ep.hookVariant, reward(m));
      m.scored = true;
      alreadyScored.add(ep.youtubeId);
      scored++;
    }
    metrics[ep.youtubeId] = m;
  }
  // YouTube data is kept 30 days at most: drop per-video stats older than that.
  // Only our own video IDs stay, so a scored video is never measured twice.
  for (const [id, m] of Object.entries(metrics)) {
    if (m.scored) alreadyScored.add(id);
    if (now.getTime() - Date.parse(m.measuredAt) > RETENTION_DAYS * 86_400_000) delete metrics[id];
  }
  writeJson(SCORED(), [...alreadyScored]);
  writeJson(METRICS(), metrics);
  saveHooks(hooks);
  writeJson(path("data/learn-report.json"), summarize(Object.values(metrics)));
  log(`learn: scored ${scored} videos`);
}

/** Per-hook and per-CTA averages, so the spread of CTA states is measured side by side. */
export function summarize(ms: VideoMetrics[]) {
  const group = (key: "hookVariant" | "cta") => {
    const out: Record<string, { videos: number; views: number; avgWatchPct: number; avgReward: number }> = {};
    for (const m of ms.filter((x) => x.scored)) {
      const g = (out[m[key]] ??= { videos: 0, views: 0, avgWatchPct: 0, avgReward: 0 });
      g.videos++;
      g.views += m.views;
      g.avgWatchPct += m.averageViewPercentage;
      g.avgReward += reward(m);
    }
    for (const g of Object.values(out)) {
      g.avgWatchPct = +(g.avgWatchPct / g.videos).toFixed(1);
      g.avgReward = +(g.avgReward / g.videos).toFixed(3);
    }
    return out;
  };
  return { updatedAt: new Date().toISOString(), byHook: group("hookVariant"), byCta: group("cta") };
}
