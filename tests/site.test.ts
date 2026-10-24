import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { buildRound, shareLine } from "../src/site/round";
import { checkReadability } from "../src/lib/readability";
import { config, resetConfigCache } from "../src/lib/config";
import { fixtureScript, tmp } from "./helpers";

const ep = (n: number, date: string) => ({ number: n, leadId: `l${n}`, date, skin: "imessage", cta: "none", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], slug: `${String(n).padStart(3, "0")}-fake-traffic-ticket`, status: "published", youtubeId: `yt${n}` }) as any;
const legit = [1, 2, 3].map((i) => ({ id: `r${i}`, sender: "Pharmacy", body: `Your order ${i} is ready.`, why: "Asks for nothing." }));

describe("daily round", () => {
  it("always has 3 messages with at least one scam and one real, and today's scam is in", () => {
    const eps = [ep(1, "2026-10-20"), ep(2, "2026-10-21"), ep(3, "2026-10-22")];
    for (const d of ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]) {
      const r = buildRound(d, eps, legit, "https://x")!;
      expect(r.items.length).toBe(3);
      expect(r.items.some((i) => i.answer === "scam")).toBe(true);
      expect(r.items.some((i) => i.answer === "real")).toBe(true);
      expect(r.number).toBe(3);
    }
    expect(buildRound("2026-10-23", eps, legit, "x")).toEqual(buildRound("2026-10-23", eps, legit, "x"));
  });

  it("makes the share line", () => {
    expect(shareLine(47, 2)).toBe("Scam #047 · I caught 2 of 3");
  });
});

describe("website", () => {
  let dir: string, fd: string;
  beforeEach(async () => {
    const t = tmp();
    dir = join(t, "site");
    fd = join(t, "fd");
    process.env.LEDGER_FILE = join(t, "ledger.json");
    writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 3, episodes: [ep(1, "2026-10-21"), ep(2, "2026-10-22")], skipped: [] }));
    resetConfigCache();
  });

  it("builds a page per scam, titled with the exact scam text, linking to the link page", async () => {
    const { buildSite } = await import("../src/site/build");
    const r = await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    expect(r.pages).toContain("scam/002-fake-traffic-ticket/index.html");
    const $ = cheerio.load(readFileSync(join(dir, "scam/002-fake-traffic-ticket/index.html"), "utf8"));
    expect($("title").text()).toBe(fixtureScript().message.body.replace(/\s+/g, " "));
    expect($("a[href='../../']").length).toBeGreaterThan(0);
    expect($(".verdict-stamp").text()).toBe("SCAM");
    expect($("a[href='https://www.youtube.com/shorts/yt2']").length).toBe(1);
  });

  it("every page carries a share card: one per scam, the default for the link page and the round", async () => {
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const base = config().site.baseUrl;
    const meta = (rel: string) => {
      const $ = cheerio.load(readFileSync(join(dir, rel), "utf8"));
      return (k: string) => $(`meta[property='${k}'], meta[name='${k}']`).attr("content");
    };
    const scam = meta("scam/002-fake-traffic-ticket/index.html");
    expect(scam("og:image")).toBe(`${base}/og/002-fake-traffic-ticket.png`);
    expect(scam("twitter:card")).toBe("summary_large_image");
    expect(scam("twitter:image")).toBe(scam("og:image"));
    expect(scam("og:image:width")).toBe("1200");
    expect(scam("og:url")).toBe(`${base}/scam/002-fake-traffic-ticket/`);
    expect(scam("og:description")).not.toMatch(/is a scam|it's a scam|says .* scam/i); // no spoiler in the preview
    expect(existsSync(join(dir, "og/002-fake-traffic-ticket.png"))).toBe(true);
    for (const rel of ["index.html", "round/index.html", "scams/index.html"]) expect(meta(rel)("og:image")).toBe(`${base}/og/default.png`);
    expect(existsSync(join(dir, "og/default.png"))).toBe(true);
    expect(readFileSync(join(dir, "assets/round.js"), "utf8")).toMatch(/"\?d=" \+ round\.date/);
  });

  it("uses the video's hashtags in the scam page title area and in the round's share text", async () => {
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const $ = cheerio.load(readFileSync(join(dir, "scam/002-fake-traffic-ticket/index.html"), "utf8"));
    expect($("h1 + .tags").text()).toBe("#ScamOrNot #TrafficTicketScam #ScamAlert #Shorts");
    const round = JSON.parse(readFileSync(join(dir, "rounds/latest.json"), "utf8"));
    expect(round.hashtags).toEqual(["#ScamOrNot", "#TrafficTicketScam", "#ScamAlert", "#Shorts"]);
    expect(readFileSync(join(dir, "assets/round.js"), "utf8")).toMatch(/round\.hashtags\.join\(" "\)/);
  });

  it("publishes the page for an uploaded private video, without linking the video", async () => {
    writeFileSync(process.env.LEDGER_FILE!, JSON.stringify({ nextNumber: 2, episodes: [{ ...ep(1, "2026-10-22"), status: "rendered", youtubePrivacy: "private" }], skipped: [] }));
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const html = readFileSync(join(dir, "scam/001-fake-traffic-ticket/index.html"), "utf8");
    expect(html).not.toContain("youtube.com/shorts/yt1");
  });

  it("link page says we never ask for money, labels the paid slot, and passes the reading gate", async () => {
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const $ = cheerio.load(readFileSync(join(dir, "index.html"), "utf8"));
    expect($(".never").text()).toMatch(/never texts you, calls you, or asks for money/);
    expect($(".paid").text()).toBe("Paid link");
    $("script, footer, .hidden").remove();
    $("p, h1, h2, li, a, div, span").each((_, e) => { $(e).append("\n"); });
    const text = $("main").text();
    const r = checkReadability(text);
    expect(r.problems).toEqual([]);
  });

  it("keeps Family Pass off: no pages, no scripts", async () => {
    const { buildSite } = await import("../src/site/build");
    const r = await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    expect(config().familyPass.enabled).toBe(false);
    expect(r.pages.some((p) => p.startsWith("family"))).toBe(false);
    expect(existsSync(join(dir, "assets/family.js"))).toBe(false);
  });

  it("builds Family Pass and Fire Drill when switched on", async () => {
    const { buildSite } = await import("../src/site/build");
    config().familyPass.enabled = true;
    const r = await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    expect(r.pages).toContain("family/index.html");
    expect(r.pages).toContain("family/app/index.html");
    expect(readFileSync(join(dir, "family/index.html"), "utf8")).toMatch(/\$19, one time/);
    expect(readFileSync(join(dir, "family/index.html"), "utf8")).toMatch(/within 30 days/);
    const gotcha = readFileSync(join(fd, "index.html"), "utf8");
    expect(gotcha).toMatch(/Gotcha, kindly/);
    expect(gotcha).toMatch(/does not ask for or keep any of your information/);
    resetConfigCache();
  });

  it("puts no secret in the browser config", async () => {
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const js = readFileSync(join(dir, "assets/config.js"), "utf8");
    expect(Object.keys(JSON.parse(js.replace(/^window\.SON=|;$/g, ""))).sort()).toEqual(["baseUrl", "fireDrillBase", "maxMembers", "supabaseKey", "supabaseUrl"]);
    expect(js).not.toMatch(/service_role|sk_|secret/i);
  });
});
