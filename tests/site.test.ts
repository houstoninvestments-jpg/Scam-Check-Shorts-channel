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
    const r = buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    expect(r.pages).toContain("scam/002-fake-traffic-ticket/index.html");
    const $ = cheerio.load(readFileSync(join(dir, "scam/002-fake-traffic-ticket/index.html"), "utf8"));
    expect($("title").text()).toBe(fixtureScript().message.body.replace(/\s+/g, " "));
    expect($("a[href='../../']").length).toBeGreaterThan(0);
    expect($(".verdict").text()).toBe("SCAM");
    expect($("a[href='https://www.youtube.com/shorts/yt2']").length).toBe(1);
  });

  it("link page says we never ask for money, labels the paid slot, and passes the reading gate", async () => {
    const { buildSite } = await import("../src/site/build");
    buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
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
    const r = buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    expect(config().familyPass.enabled).toBe(false);
    expect(r.pages.some((p) => p.startsWith("family"))).toBe(false);
    expect(existsSync(join(dir, "assets/family.js"))).toBe(false);
  });

  it("builds Family Pass and Fire Drill when switched on", async () => {
    const { buildSite } = await import("../src/site/build");
    config().familyPass.enabled = true;
    const r = buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
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
    buildSite({ dir, fireDrillDir: fd, date: "2026-10-22" });
    const js = readFileSync(join(dir, "assets/config.js"), "utf8");
    expect(Object.keys(JSON.parse(js.replace(/^window\.SON=|;$/g, ""))).sort()).toEqual(["baseUrl", "fireDrillBase", "maxMembers", "supabaseKey", "supabaseUrl"]);
    expect(js).not.toMatch(/service_role|sk_|secret/i);
  });
});
