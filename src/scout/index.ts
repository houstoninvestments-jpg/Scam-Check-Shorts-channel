import type { Lead, SourceDoc } from "../types.js";
import { config } from "../lib/config.js";
import { loadLedger } from "../lib/ledger.js";
import { log, path, readJson, writeJson } from "../lib/util.js";
import { httpFetch, type Fetcher } from "./fetch.js";
import { buildLeads, dedupe } from "./rank.js";
import { pullSource, type SourceDef, type SourceResult } from "./sources.js";

export interface SourceHealth {
  [id: string]: { lastOk?: string; lastError?: string; consecutiveFailures: number; lastFailDay?: string; verified: boolean };
}

export function updateSourceHealth(results: SourceResult[], file = path("data/source-health.json")): SourceHealth {
  const h = readJson<SourceHealth>(file, {});
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  for (const r of results) {
    const cur = h[r.id] ?? { consecutiveFailures: 0, verified: false };
    if (r.ok) h[r.id] = { ...cur, lastOk: now, consecutiveFailures: 0, lastFailDay: undefined, verified: true, lastError: undefined };
    // Counted in days, not runs: up to three runs a day must not make a source look broken three times as fast.
    else h[r.id] = { ...cur, lastError: r.error, consecutiveFailures: cur.lastFailDay === day ? cur.consecutiveFailures : cur.consecutiveFailures + 1, lastFailDay: day };
  }
  writeJson(file, h);
  return h;
}

export interface ScoutOutput {
  leads: Lead[];
  results: SourceResult[];
  dropped: { id: string; why: string }[];
}

/** Live scout: pull every source, group, rank by freshness, drop what we already covered. */
export async function scout(get: Fetcher = httpFetch, extraDocs: SourceDoc[] = []): Promise<ScoutOutput> {
  const defs = readJson<{ sources: SourceDef[] }>(path("config/sources.json")).sources;
  const results: SourceResult[] = [];
  for (const def of defs) {
    const r = await pullSource(def, get);
    log(`scout ${def.id}: ${r.ok ? `${r.docs.length} docs` : `FAILED ${r.error}`}`);
    results.push(r);
  }
  const weights = Object.fromEntries(defs.map((d) => [d.name, d.weight]));
  const docs = [...results.flatMap((r) => r.docs), ...extraDocs];
  const ranked = buildLeads(docs, weights, { maxAgeDays: config().scout.maxAgeDays });
  const { kept, dropped } = dedupe(ranked, loadLedger().episodes, config().scout.dedupeSimilarity);
  const leads = kept.filter((l) => l.score >= config().scout.minScore);
  return { leads, results, dropped };
}

/** Dry-run scout: reads saved source captures from fixtures/sources instead of the network. */
export function scoutFromFixtures(files: string[]): ScoutOutput {
  const docs = files.map((f) => readJson<SourceDoc>(path("fixtures/sources", f)));
  const ranked = buildLeads(docs, {}, { maxAgeDays: 3650 });
  const { kept, dropped } = dedupe(ranked, loadLedger().episodes, config().scout.dedupeSimilarity);
  return { leads: kept, results: [], dropped };
}
