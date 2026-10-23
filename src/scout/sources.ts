import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import type { SourceDoc, SourceKind } from "../types.js";
import { articleText, listLinks, type Fetcher } from "./fetch.js";

export interface SourceDef {
  id: string;
  kind: SourceKind;
  name: string;
  type: "html-list" | "rss";
  listUrl: string;
  linkPattern?: string;
  base?: string;
  maxArticles: number;
  weight: number;
}

export interface SourceResult {
  id: string;
  ok: boolean;
  docs: SourceDoc[];
  error?: string;
}

/** Year/month in FTC-style URLs is a good fallback date when the page has no machine-readable date. */
function dateFromUrl(url: string): string | null {
  const m = url.match(/\/(20\d{2})\/(\d{2})\//);
  return m ? new Date(`${m[1]}-${m[2]}-15T12:00:00Z`).toISOString() : null;
}

async function htmlList(def: SourceDef, get: Fetcher): Promise<SourceDoc[]> {
  const list = await get(def.listUrl);
  const links = listLinks(list, new RegExp(def.linkPattern!, "i"), def.base!).slice(0, def.maxArticles);
  const docs: SourceDoc[] = [];
  for (const url of links) {
    try {
      const page = articleText(await get(url));
      if (page.text.length < 200) continue;
      docs.push({
        kind: def.kind,
        name: def.name,
        url,
        title: page.title,
        publishedAt: page.publishedAt ?? dateFromUrl(url),
        fetchedAt: new Date().toISOString(),
        text: page.text,
        capture: "page",
      });
    } catch {
      // One bad article never sinks the source; the source fails only if nothing comes back.
    }
  }
  return docs;
}

async function rss(def: SourceDef, get: Fetcher): Promise<SourceDoc[]> {
  const xml = await get(def.listUrl);
  const feed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const entries: any[] = [].concat(feed?.feed?.entry ?? feed?.rss?.channel?.item ?? []);
  return entries.slice(0, def.maxArticles).flatMap((e) => {
    const url = typeof e.link === "string" ? e.link : e.link?.["@_href"];
    const html = typeof e.content === "string" ? e.content : e.content?.["#text"] ?? e.description ?? "";
    const text = cheerio.load(html).text().replace(/\s+\n/g, "\n").trim();
    const title = typeof e.title === "string" ? e.title : e.title?.["#text"] ?? "";
    if (!url || text.length < 40) return [];
    return [
      {
        kind: def.kind,
        name: def.name,
        url,
        title,
        publishedAt: e.updated || e.published || e.pubDate ? new Date(e.updated || e.published || e.pubDate).toISOString() : null,
        fetchedAt: new Date().toISOString(),
        text,
        capture: "feed",
      } satisfies SourceDoc,
    ];
  });
}

export async function pullSource(def: SourceDef, get: Fetcher): Promise<SourceResult> {
  try {
    const docs = def.type === "rss" ? await rss(def, get) : await htmlList(def, get);
    return { id: def.id, ok: docs.length > 0, docs, error: docs.length ? undefined : "no articles found" };
  } catch (e) {
    return { id: def.id, ok: false, docs: [], error: String(e).slice(0, 300) };
  }
}
