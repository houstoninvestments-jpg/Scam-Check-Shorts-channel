import * as cheerio from "cheerio";

const UA = "ScamOrNotScout/1.0 (+public-interest scam education; contact via channel page)";

export type Fetcher = (url: string) => Promise<string>;

export const httpFetch: Fetcher = async (url) => {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml" },
        signal: AbortSignal.timeout(25_000),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.text();
    } catch (e) {
      last = e;
      if (String(e).includes("not retried")) break;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  throw new Error(`fetch failed for ${url}: ${String(last)}`);
};

/** Pull readable article text out of a government or news page. */
export function articleText(html: string): { title: string; text: string; publishedAt: string | null } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, form, aside, iframe, svg, .breadcrumb, .share, .social").remove();
  const title = ($("h1").first().text() || $("title").text()).replace(/\s+/g, " ").trim();
  const container = [
    "article .field--name-body",
    ".field--name-body",
    "article",
    "main",
    "[role=main]",
    "#content",
    "body",
  ]
    .map((s) => $(s).first())
    .find((el) => el.length && el.text().trim().length > 200);
  const blocks: string[] = [];
  (container ?? $("body"))
    .find("p, li, h2, h3, blockquote, pre")
    .each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
    });
  const time = $("time[datetime]").first().attr("datetime") || $("meta[property='article:published_time']").attr("content") || null;
  return { title, text: blocks.join("\n"), publishedAt: time ? new Date(time).toISOString() : null };
}

export function listLinks(html: string, pattern: RegExp, base: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href")!;
    const abs = href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href;
    const m = abs.match(pattern);
    if (m) out.add(abs.split("#")[0].split("?")[0]);
  });
  return [...out];
}
