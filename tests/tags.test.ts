import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertHashtags, backendTags, categoryFor, hashtagsFor, MAX_HASHTAGS, namesBrand, noHash, TAG_CHAR_LIMIT, tagCharCount, tagConfig,
} from "../src/publish/tags";
import { uploadRequest, videoDescription } from "../src/publish/youtube";
import { mechanicalCheck } from "../src/checker";
import { fixtureLead, fixtureScript } from "./helpers";
import { path } from "../src/lib/util";

const cfg = tagConfig();
const cat = (id: string) => cfg.categories.find((c) => c.id === id)!;
const ep = (over: any = {}) => ({ number: 7, slug: "007-x", sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], ...over, script: { ...fixtureScript(), ...(over.script ?? {}) } }) as any;
const hashtagsIn = (s: string) => s.match(/#[A-Za-z][A-Za-z0-9]*/g) ?? [];

describe("hashtags", () => {
  it("are exactly four, in order: brand, scam type, #ScamAlert, #Shorts", () => {
    expect(hashtagsFor(cat("toll"))).toEqual(["#ScamOrNot", "#TollScam", "#ScamAlert", "#Shorts"]);
    for (const c of cfg.categories) {
      const h = hashtagsFor(c);
      expect(h).toHaveLength(4);
      expect(h[0]).toBe("#ScamOrNot");
      expect(h[1]).toBe(c.hashtag);
      expect(h.slice(2)).toEqual(["#ScamAlert", "#Shorts"]);
    }
  });

  it("end the description and are the only hashtags in it, even if the writer slips a # in", () => {
    const d = videoDescription(ep({ script: { description: "Case #4821 says pay now. #urgent" } }), "AI voice");
    expect(d.trim().split("\n").at(-1)).toBe("#ScamOrNot #TrafficTicketScam #ScamAlert #Shorts");
    expect(hashtagsIn(d)).toEqual(["#ScamOrNot", "#TrafficTicketScam", "#ScamAlert", "#Shorts"]);
    expect(d).toContain("Case No. 4821");
  });

  it("are never more than five, never spaced, never a brand", () => {
    expect(() => assertHashtags(["#A", "#B", "#C", "#D", "#E", "#F"])).toThrow(/too many/);
    expect(() => assertHashtags(["#ScamOrNot", "#Toll Scam"])).toThrow(/spaces/);
    expect(() => assertHashtags(["#ScamOrNot", "#AmazonScam"])).toThrow(/brand/);
    expect(() => assertHashtags(["#ScamOrNot", "#PayPalScam"])).toThrow(/brand/);
    expect(MAX_HASHTAGS).toBe(5);
  });

  it("come only from the approved list, which has no brands and no duplicates", () => {
    const all = cfg.categories.map((c) => c.hashtag);
    expect(new Set(all).size).toBe(all.length);
    for (const c of cfg.categories) {
      expect(namesBrand(c.hashtag.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2"))).toBe(false);
      for (const p of c.phrases) expect(namesBrand(p)).toBe(false);
    }
  });
});

describe("scam type", () => {
  it("matches the scam's category from its own words", () => {
    expect(categoryFor(fixtureScript()).id).toBe("traffic_ticket");
    const s = (body: string, scamName = "Sample") => ({ ...fixtureScript(), scamName, title: "Real or scam?", message: { ...fixtureScript().message, body } });
    expect(categoryFor(s("You have an unpaid toll. Pay now.")).id).toBe("toll");
    expect(categoryFor(s("We're hiring for remote work. Reply YES.")).id).toBe("job");
    expect(categoryFor(s("Your package is held. Pay the customs fee.")).id).toBe("package");
    expect(categoryFor(s("Hi, is this Anna? Sorry, wrong number!")).id).toBe("wrong_number");
  });

  it("uses the writer's pick only when it is on the list", () => {
    expect(categoryFor({ ...fixtureScript(), category: "bank" }).id).toBe("bank");
    expect(categoryFor({ ...fixtureScript(), category: "#MadeUpScam" }).id).toBe("traffic_ticket");
  });

  it("falls back to #TextScam when nothing matches", () => {
    const s = { ...fixtureScript(), scamName: "Odd message", title: "Real or scam?", message: { ...fixtureScript().message, subject: "", body: "Hello there, please respond soon." } };
    expect(categoryFor(s).id).toBe("text");
    expect(hashtagsFor(categoryFor(s))[1]).toBe("#TextScam");
  });
});

describe("backend tags", () => {
  it("are search phrases for this scam, plus 'scam or not' and 'scam alert'", () => {
    const t = backendTags(fixtureScript(), cat("traffic_ticket"));
    expect(t).toContain("traffic ticket text scam");
    expect(t.slice(-2)).toEqual(["scam or not", "scam alert"]);
    expect(t.every((x) => !x.includes("#"))).toBe(true);
  });

  it("drop any phrase that names a brand", () => {
    const t = backendTags({ scamName: "Fake USPS package text" }, cat("package"));
    expect(t.some((x) => /usps/i.test(x))).toBe(false);
    expect(namesBrand("is this e-zpass text real")).toBe(true);
    expect(namesBrand("unpaid toll text scam")).toBe(false);
  });

  it("stay under YouTube's 500-character limit, counting quotes and commas", () => {
    expect(tagCharCount(["a b", "c"])).toBe(3 + 2 + 1 + 1);
    const long = { scamName: "very long scam name ".repeat(3) };
    for (const c of cfg.categories) expect(tagCharCount(backendTags(long, c))).toBeLessThanOrEqual(TAG_CHAR_LIMIT);
    const r = uploadRequest(ep(), "AI voice");
    expect(tagCharCount(r.snippet.tags)).toBeLessThanOrEqual(TAG_CHAR_LIMIT);
  });

  it("never come from the writer", () => {
    expect(readFileSync(path("src/types.ts"), "utf8")).not.toMatch(/tags: z\.array/);
  });
});

describe("guards", () => {
  it("the checker sends back a script whose title names a brand or has a #", () => {
    const s = fixtureScript();
    s.title = "Fake Amazon refund text #scam";
    const p = mechanicalCheck(s, fixtureLead()).problems.join("\n");
    expect(p).toMatch(/names a company or brand/);
    expect(p).toMatch(/# sign/);
  });
  it("noHash keeps numbers readable", () => {
    expect(noHash("Case #12 #now")).toBe("Case No. 12 now");
  });
});
