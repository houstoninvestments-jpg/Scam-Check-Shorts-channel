import type { Script } from "../types.js";
import { path, readJson } from "../lib/util.js";

/** Hashtags and search tags. Everything comes from config/hashtags.json; nothing is invented per video. */

export interface TagCategory {
  id: string;
  hashtag: string;
  keywords: string[];
  phrases: string[];
}

export interface TagConfig {
  brand: string;
  tail: string[];
  fallback: string;
  alwaysTags: string[];
  categories: TagCategory[];
  blockedBrands: string[];
}

export const MAX_HASHTAGS = 5;
/** YouTube's limit is 500 characters for all tags together. We stop a little short. */
export const TAG_CHAR_LIMIT = 500;
export const TAG_CHAR_BUDGET = 480;
const HASHTAG = /^#[A-Za-z][A-Za-z0-9]*$/;

let cached: TagConfig | undefined;
export function tagConfig(): TagConfig {
  cached ??= readJson<TagConfig>(path("config/hashtags.json"));
  return cached;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${esc(word.toLowerCase())}`, "i").test(text);

/** True if the text names a company or brand on the blocklist. */
export function namesBrand(text: string, cfg = tagConfig()): boolean {
  const t = text.toLowerCase();
  return cfg.blockedBrands.some((b) => new RegExp(`(^|[^a-z0-9])${esc(b)}($|[^a-z0-9])`, "i").test(t));
}

/** Pick the scam's category: the writer's choice if it is on the list, else the best keyword match, else the fallback. */
export function categoryFor(script: Pick<Script, "scamName" | "title" | "message"> & { category?: string }, extra = "", cfg = tagConfig()): TagCategory {
  const byId = new Map(cfg.categories.map((c) => [c.id, c]));
  if (script.category && byId.has(script.category)) return byId.get(script.category)!;
  const text = `${script.scamName} ${script.title} ${script.message.subject} ${script.message.body} ${extra}`.toLowerCase();
  let best: TagCategory | undefined;
  let bestHits = 0;
  for (const c of cfg.categories) {
    const hits = c.keywords.filter((k) => hasWord(text, k)).length;
    if (hits > bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best ?? byId.get(cfg.fallback)!;
}

/** Exactly four, in this order: brand, scam type, #ScamAlert, #Shorts. YouTube shows the first three by the title. */
export function hashtagsFor(category: TagCategory, cfg = tagConfig()): string[] {
  const tags = [cfg.brand, category.hashtag, ...cfg.tail];
  assertHashtags(tags, cfg);
  return tags;
}

export function assertHashtags(tags: string[], cfg = tagConfig()) {
  if (tags.length > MAX_HASHTAGS) throw new Error(`too many hashtags: ${tags.length}`);
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) throw new Error("duplicate hashtag");
  for (const t of tags) {
    if (!HASHTAG.test(t)) throw new Error(`bad hashtag (spaces or symbols): ${t}`);
    // Hashtags have no spaces, so look for each brand inside the joined-up word.
    const body = t.slice(1).toLowerCase();
    if (cfg.blockedBrands.some((b) => body.includes(b.replace(/[^a-z0-9]/g, "")))) throw new Error(`hashtag names a brand: ${t}`);
  }
}

/** Characters YouTube counts: each tag, plus quotes around tags with spaces, plus the commas between. */
export function tagCharCount(tags: string[]): number {
  return tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

function clean(tag: string) {
  return tag
    .toLowerCase()
    .replace(/[<>#"]/g, "")
    .replace(/[^a-z0-9 '-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Backend tags: the phrases people actually search for this kind of scam, from the approved list,
 * then a couple drawn from this scam's own name, then the channel tags. Brand names never pass.
 */
export function backendTags(script: Pick<Script, "scamName">, category: TagCategory, cfg = tagConfig()): string[] {
  const own = clean(script.scamName);
  const words = own.split(" ").length;
  const fromScript = own && words <= 8 ? [own, ...(words <= 5 ? [`is this ${own.replace(/^(fake|a|the) /, "")} real`] : [])] : [];
  const fallback = cfg.categories.find((c) => c.id === cfg.fallback)!;
  const candidates = [...category.phrases, ...fromScript, ...(category.id === fallback.id ? [] : fallback.phrases.slice(0, 1))];
  const out: string[] = [];
  const reserved = cfg.alwaysTags.map(clean);
  for (const raw of candidates) {
    const t = clean(raw);
    if (!t || t.length > 60 || namesBrand(t, cfg) || out.includes(t) || reserved.includes(t)) continue;
    if (tagCharCount([...out, t, ...reserved]) > TAG_CHAR_BUDGET) continue;
    out.push(t);
  }
  return [...out, ...reserved];
}

/** Writer text goes into the description, so strip any '#' it contains; only our four hashtags may appear. */
export const noHash = (s: string) => s.replace(/#\s?(\d)/g, "No. $1").replace(/#/g, "");
