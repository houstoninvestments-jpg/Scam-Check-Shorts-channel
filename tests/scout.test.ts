import { describe, expect, it } from "vitest";
import { articleText, listLinks } from "../src/scout/fetch";
import { buildLeads, dedupe, detectChannel, freshness } from "../src/scout/rank";
import { pullSource } from "../src/scout/sources";
import type { SourceDoc } from "../src/types";
import { fixtureScript } from "./helpers";

// Synthetic pages shaped like a typical government CMS. Real-page parsing is proven on the first live run.
const LIST = `<html><body><nav><a href="/consumer-alerts/2026/10/nav-link">nav</a></nav><main>
<a href="/consumer-alerts/2026/10/fake-toll-texts">Fake toll texts</a>
<a href="https://consumer.ftc.gov/consumer-alerts/2026/09/job-scam-texts?utm=x">Job texts</a>
<a href="/about">About</a></main></body></html>`;
const ARTICLE = (title: string, p: string) => `<html><head><title>${title}</title></head><body><header>Site</header>
<article><h1>${title}</h1><time datetime="2026-10-20T10:00:00Z">Oct 20</time><div class="field--name-body">
<p>${p}</p><p>Scammers send a text that says you owe an unpaid toll and must pay today through a link.</p>
<p>If you get a text like this, don't click the link. Report it to the FTC and delete it.</p>
<p>Real toll agencies do not text you a link and demand payment the same day. Check your account by going to the site you already use.</p></div></article>
<footer>footer text</footer><script>var x=1</script></body></html>`;

const doc = (over: Partial<SourceDoc>): SourceDoc => ({
  kind: "ftc", name: "FTC Consumer Alerts", url: "https://consumer.ftc.gov/consumer-alerts/2026/10/a", title: "That toll text is a scam",
  publishedAt: "2026-10-20T00:00:00Z", fetchedAt: "", text: "Scammers send fake unpaid toll texts with a link. This is a scam.", capture: "page", ...over,
});

describe("scout parsing", () => {
  it("finds article links and skips the rest", () => {
    const links = listLinks(LIST, /\/consumer-alerts\/20\d{2}\/\d{2}\/[a-z0-9-]+/, "https://consumer.ftc.gov");
    expect(links).toContain("https://consumer.ftc.gov/consumer-alerts/2026/10/fake-toll-texts");
    expect(links).toContain("https://consumer.ftc.gov/consumer-alerts/2026/09/job-scam-texts");
    expect(links.some((l) => l.includes("about"))).toBe(false);
  });

  it("pulls the article body, title and date without page chrome", () => {
    const a = articleText(ARTICLE("That toll text is a scam", "Here is what to know."));
    expect(a.title).toBe("That toll text is a scam");
    expect(a.publishedAt).toBe("2026-10-20T10:00:00.000Z");
    expect(a.text).toMatch(/don't click the link/);
    expect(a.text).not.toMatch(/footer text|var x/);
  });

  it("pulls a whole source through a fetcher, and fails soft", async () => {
    const pages: Record<string, string> = {
      "https://consumer.ftc.gov/consumer-alerts": LIST,
      "https://consumer.ftc.gov/consumer-alerts/2026/10/fake-toll-texts": ARTICLE("Toll text scam", "One."),
      "https://consumer.ftc.gov/consumer-alerts/2026/09/job-scam-texts": ARTICLE("Job text scam", "Two."),
    };
    const def = { id: "ftc", kind: "ftc" as const, name: "FTC", type: "html-list" as const, listUrl: "https://consumer.ftc.gov/consumer-alerts", linkPattern: "/consumer-alerts/20\\d{2}/\\d{2}/[a-z0-9-]+", base: "https://consumer.ftc.gov", maxArticles: 5, weight: 1 };
    const r = await pullSource(def, async (u) => {
      if (!(u in pages)) throw new Error("404");
      return pages[u];
    });
    expect(r.ok).toBe(true);
    expect(r.docs.length).toBe(2);
    const down = await pullSource(def, async () => { throw new Error("blocked"); });
    expect(down.ok).toBe(false);
  });

  it("reads Reddit's Atom feed", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Got this text, scam?</title>
<link href="https://www.reddit.com/r/Scams/comments/abc/got_this/"/><updated>2026-10-22T12:00:00+00:00</updated>
<content type="html">&lt;p&gt;It says my package is held and I must pay a fee at a link. Is this a scam?&lt;/p&gt;</content></entry></feed>`;
    const r = await pullSource({ id: "r", kind: "reddit", name: "r/Scams", type: "rss", listUrl: "x", maxArticles: 5, weight: 0.4 }, async () => atom);
    expect(r.docs[0].url).toMatch(/reddit/);
    expect(r.docs[0].text).toMatch(/package is held/);
  });
});

describe("ranking and dedupe", () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  it("prefers fresh scams and boosts ones seen in several kinds of source", () => {
    const leads = buildLeads(
      [
        doc({ url: "u1", title: "Old gift card scam", text: "A gift card scam from long ago. Scam.", publishedAt: "2026-09-25T00:00:00Z" }),
        doc({ url: "u2" }),
        doc({ kind: "bbb", name: "BBB", url: "u3", title: "Toll text scam warning", text: "BBB warns of fake unpaid toll texts with a link. Scam." }),
      ],
      { "FTC Consumer Alerts": 1, BBB: 0.9 },
      { maxAgeDays: 45, now },
    );
    expect(leads[0].docs.map((d) => d.url).sort()).toEqual(["u2", "u3"]);
    expect(leads[0].reasons.join()).toMatch(/2 kinds/);
  });

  it("drops community-only leads to the bottom", () => {
    const leads = buildLeads([doc({ kind: "reddit", name: "r/Scams", url: "r1", title: "Weird crypto DM scam", text: "Someone DMed me about crypto. Scam?" }), doc({ url: "f1" })], {}, { maxAgeDays: 45, now });
    expect(leads.at(-1)!.reasons).toContain("no authoritative source");
  });

  it("ignores pages that are not about scams and pages that are too old", () => {
    expect(buildLeads([doc({ title: "Recall notice", text: "A product recall for heaters." })], {}, { maxAgeDays: 45, now })).toEqual([]);
    expect(buildLeads([doc({ publishedAt: "2025-01-01T00:00:00Z" })], {}, { maxAgeDays: 45, now })).toEqual([]);
  });

  it("drops leads we already covered", () => {
    const s = fixtureScript();
    const past = [{ number: 1, script: s, sources: [{ url: "u-used", name: "FTC", capture: "page" }] }] as any;
    const leads = buildLeads(
      [doc({ url: "u-used", title: "Toll scam" }), doc({ url: "u-new", title: "Fake traffic ticket text with a QR code", text: s.message.body + " Traffic violation scam text QR code." })],
      {},
      { maxAgeDays: 45, now },
    );
    const { kept, dropped } = dedupe(leads, past, 0.3);
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.why).join()).toMatch(/already used/);
    expect(dropped.map((d) => d.why).join()).toMatch(/same scam as #1/);
  });

  it("sorts channels and decays freshness", () => {
    expect(detectChannel(doc({ title: "Voicemail scam", text: "A caller leaves a voicemail." }))).toBe("voicemail");
    expect(detectChannel(doc({ title: "Fake buyer scam", text: "A buyer on marketplace sends a fake payment." }))).toBe("marketplace");
    expect(detectChannel(doc({}))).toBe("text");
    expect(freshness("2026-10-13T00:00:00Z", now)).toBeCloseTo(0.5, 2);
  });
});
