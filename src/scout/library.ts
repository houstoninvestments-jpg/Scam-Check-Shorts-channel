import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Ledger, Lead, SourceDoc, SourceKind } from "../types.js";
import { log, path, readJson, sha, writeJson } from "../lib/util.js";
import { articleText, httpFetch, listLinks, type Fetcher } from "./fetch.js";
import { dedupe, detectChannel, isScamDoc, skipReason } from "./rank.js";

/**
 * Evergreen library: official pages that document scams people get right now (FTC, FBI IC3, USPIS,
 * IRS, SSA, CFPB, FCC, AARP). When the day's fresh leads don't produce a script that passes both
 * reviews, the slot falls back to these. Every page is stored whole, so quotes are checked word for
 * word exactly like fresh leads, and both reviews still decide.
 */

interface LibraryConfig {
  minEntries: number;
  refreshDays: number;
  maxAgeYears: number;
  lists: { kind: SourceKind; name: string; base: string; pattern: string; pages: string[] }[];
  pages: { kind: SourceKind; name: string; url: string }[];
}

export interface LibraryIndexEntry {
  id: string;
  url: string;
  title: string;
  kind: SourceKind;
  name: string;
  fetchedAt: string;
  chars: number;
}

export const libraryDir = () => process.env.LIBRARY_DIR || path("data/library");
const indexFile = () => join(libraryDir(), "index.json");
export const libraryConfig = () => readJson<LibraryConfig>(path("config/library.json"));

export function loadLibraryIndex(): { refreshedAt?: string; entries: LibraryIndexEntry[] } {
  return readJson(indexFile(), { entries: [] });
}

export function loadLibraryDoc(id: string): SourceDoc | null {
  const f = join(libraryDir(), `${id}.json`);
  return existsSync(f) ? readJson<SourceDoc>(f) : null;
}

/** Old dated pages (FTC alerts carry the year in the URL) are left out: the scam may have moved on. */
function tooOld(url: string, maxAgeYears: number, now = new Date()) {
  const m = url.match(/\/(20\d{2})\//);
  return m ? now.getUTCFullYear() - Number(m[1]) > maxAgeYears : false;
}

/** Could this page make a video? Same rules the scout uses, plus enough text to quote from. */
export function libraryWorthy(d: SourceDoc): string | undefined {
  if (d.text.length < 500) return "too little text";
  return skipReason(d) ?? (isScamDoc(d) ? undefined : "not about a scam");
}

/**
 * Fetch the configured official pages, keep the ones that can make a video, store each whole.
 * Pages that fail or block us are skipped (and kept from the last good fetch if we had one).
 */
export async function refreshLibrary(get: Fetcher = httpFetch, opts: { force?: boolean; now?: Date } = {}) {
  const cfg = libraryConfig();
  const now = opts.now ?? new Date();
  const idx = loadLibraryIndex();
  if (!opts.force && idx.refreshedAt && now.getTime() - Date.parse(idx.refreshedAt) < cfg.refreshDays * 86_400_000 && idx.entries.length >= cfg.minEntries) {
    return { refreshed: false, entries: idx.entries.length, added: 0, notes: [`library is fresh (${idx.entries.length} entries, refreshed ${idx.refreshedAt.slice(0, 10)})`] };
  }
  mkdirSync(libraryDir(), { recursive: true });
  const notes: string[] = [];
  const candidates = new Map<string, { kind: SourceKind; name: string; url: string }>();
  for (const p of cfg.pages) candidates.set(p.url, p);
  for (const l of cfg.lists) {
    let found = 0;
    for (const page of l.pages) {
      try {
        for (const url of listLinks(await get(page), new RegExp(l.pattern, "i"), l.base)) {
          if (tooOld(url, cfg.maxAgeYears, now) || candidates.has(url)) continue;
          candidates.set(url, { kind: l.kind, name: l.name, url });
          found++;
        }
      } catch (e) {
        notes.push(`${l.name} list ${page}: ${String(e).slice(0, 120)}`);
      }
    }
    notes.push(`${l.name}: ${found} links`);
  }

  const byId = new Map(idx.entries.map((e) => [e.id, e]));
  let added = 0;
  const rejected: Record<string, number> = {};
  for (const c of candidates.values()) {
    const id = sha(c.url);
    try {
      const page = articleText(await get(c.url));
      const doc: SourceDoc = { kind: c.kind, name: c.name, url: c.url, title: page.title, publishedAt: page.publishedAt, fetchedAt: now.toISOString(), text: page.text, capture: "page" };
      const why = libraryWorthy(doc);
      if (why) {
        rejected[why] = (rejected[why] ?? 0) + 1;
        continue;
      }
      if (!byId.has(id)) added++;
      writeJson(join(libraryDir(), `${id}.json`), doc);
      byId.set(id, { id, url: c.url, title: doc.title, kind: c.kind, name: c.name, fetchedAt: doc.fetchedAt, chars: doc.text.length });
    } catch (e) {
      rejected[String(e).includes("403") ? "blocked (403), skipped" : "fetch failed"] = (rejected[String(e).includes("403") ? "blocked (403), skipped" : "fetch failed"] ?? 0) + 1;
    }
  }
  // Drop index rows whose page file is gone.
  const files = new Set(readdirSync(libraryDir()).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.slice(0, -5)));
  const entries = [...byId.values()].filter((e) => files.has(e.id)).sort((a, b) => a.url.localeCompare(b.url));
  writeJson(indexFile(), { refreshedAt: now.toISOString(), entries });
  notes.push(`not kept: ${Object.entries(rejected).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  log(`library: ${entries.length} entries (${added} new)`);
  return { refreshed: true, entries: entries.length, added, notes };
}

/** Deterministic shuffle so one day's order is stable and different days try different pages. */
function seeded<T>(xs: T[], seed: string): T[] {
  const out = [...xs];
  let h = parseInt(sha(seed, 8), 16);
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const LIBRARY_RETRY_DAYS = 30;

/**
 * Library leads for today: not already on the channel (same page or same scam), not failed in the
 * last 30 days, in a stable per-day order.
 */
export function libraryLeads(ledger: Ledger, date: string, dedupeSimilarity: number): Lead[] {
  const recentFail = new Set(ledger.skipped.filter((s) => Date.parse(date) - Date.parse(s.date) <= LIBRARY_RETRY_DAYS * 86_400_000).map((s) => s.leadId));
  const leads: Lead[] = [];
  for (const e of loadLibraryIndex().entries) {
    if (recentFail.has(e.id)) continue;
    const doc = loadLibraryDoc(e.id);
    if (!doc) continue;
    leads.push({ id: sha(doc.url), title: doc.title, channel: detectChannel(doc), docs: [doc], score: 0.3, reasons: ["evergreen library"] });
  }
  return seeded(dedupe(leads, ledger.episodes, dedupeSimilarity).kept, `library-${date}`);
}
