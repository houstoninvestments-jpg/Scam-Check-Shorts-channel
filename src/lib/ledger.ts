import type { Episode, Ledger } from "../types.js";
import { path, readJson, writeJson } from "./util.js";

const FILE = () => process.env.LEDGER_FILE || path("data/ledger.json");

export function loadLedger(): Ledger {
  return readJson<Ledger>(FILE(), { nextNumber: 1, episodes: [], skipped: [] });
}

export function saveLedger(l: Ledger) {
  writeJson(FILE(), l);
}

export function upsertEpisode(l: Ledger, ep: Episode) {
  const i = l.episodes.findIndex((e) => e.number === ep.number);
  if (i >= 0) l.episodes[i] = ep;
  else l.episodes.push(ep);
}

export const published = (l: Ledger) => l.episodes.filter((e) => e.status === "published");
