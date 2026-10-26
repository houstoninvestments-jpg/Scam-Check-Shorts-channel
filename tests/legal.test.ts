import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { checkReadability } from "../src/lib/readability";
import { config, resetConfigCache } from "../src/lib/config";
import { fixtureScript, tmp } from "./helpers";

const ep = { number: 1, leadId: "l", date: "2026-10-22", skin: "imessage", cta: "none", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC", capture: "page" }], slug: "001-x", status: "published" };

let dir: string;
beforeEach(() => {
  const t = tmp();
  dir = join(t, "site");
  process.env.LEDGER_FILE = join(t, "ledger.json");
  writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 2, episodes: [ep], skipped: [] }));
  resetConfigCache();
});

const text = (html: string) => {
  const $ = cheerio.load(html);
  $("script, footer, .small").remove();
  $("p, h1, h2, li").each((_, e) => { $(e).append("\n"); });
  return $("main").text();
};

describe("privacy and terms", () => {
  it("exist and are linked in the footer of every page", async () => {
    const { buildSite } = await import("../src/site/build");
    const r = await buildSite({ dir, fireDrillDir: join(dir, "..", "fd"), date: "2026-10-22" });
    expect(r.pages).toContain("privacy/index.html");
    expect(r.pages).toContain("terms/index.html");
    for (const p of r.pages) {
      const $ = cheerio.load(readFileSync(join(dir, p), "utf8"));
      const hrefs = $("footer a").map((_, a) => $(a).text()).get();
      expect(hrefs, p).toEqual(expect.arrayContaining(["Privacy", "Terms"]));
    }
  });

  it("pass the grade 8 reading gate", async () => {
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: join(dir, "..", "fd"), date: "2026-10-22" });
    for (const p of ["privacy/index.html", "terms/index.html"]) {
      const r = checkReadability(text(readFileSync(join(dir, p), "utf8")));
      expect(r.problems, p).toEqual([]);
    }
  });

  it("say what the code does: no email collected while the signup box is off, contact, removal, no selling, YouTube use", async () => {
    const { privacyPage } = await import("../src/site/legal");
    const c = config();
    c.supabase.url = "";
    c.supabase.publishableKey = "";
    const off = privacyPage(c, "../");
    expect(off).toMatch(/that box is turned off, so the site collects no email addresses at all/);
    expect(off).toContain("mailto:houstoninvestments@gmail.com");
    expect(off).toMatch(/delete it within 30 days/);
    expect(off).toMatch(/We don't sell your information/);
    expect(off).toMatch(/Scam or Not uses YouTube API Services/);
    expect(off).toMatch(/posts our own videos to our channel/);
    expect(off).toContain("https://www.youtube.com/t/terms");
    expect(off).toContain("http://www.google.com/policies/privacy");
    expect(off).toContain("https://security.google.com/settings/security/permissions");
    expect(off).toMatch(/stats for each video for 30 days at most, then delete them/);
    c.supabase.url = "https://x.supabase.co";
    c.supabase.publishableKey = "pk";
    expect(privacyPage(c, "../")).not.toMatch(/turned off/);
    resetConfigCache();
  });
});

describe("Watch on YouTube link", () => {
  it("sits next to Privacy in the footer, as plain text linking to the channel, once the channel is known", async () => {
    const { join } = await import("node:path");
    const ch = join(tmp(), "ch.json");
    writeFileSync(ch, JSON.stringify({ id: "UC123", title: "Scam or Not", handle: "@scamornot" }));
    process.env.YOUTUBE_CHANNEL_FILE = ch;
    const { buildSite } = await import("../src/site/build");
    await buildSite({ dir, fireDrillDir: join(dir, "..", "fd"), date: "2026-10-22" });
    const $ = cheerio.load(readFileSync(join(dir, "index.html"), "utf8"));
    const links = $("footer a").map((_, a) => $(a).text()).get();
    expect(links.indexOf("Watch on YouTube")).toBe(links.indexOf("Terms") + 1);
    expect($("footer a:contains('Watch on YouTube')").attr("href")).toBe("https://www.youtube.com/@scamornot");
    expect($("footer img").length).toBe(0); // no logo drawn by us
    process.env.YOUTUBE_CHANNEL_FILE = join(tmp(), "missing.json");
    await buildSite({ dir, fireDrillDir: join(dir, "..", "fd"), date: "2026-10-22" });
    expect(readFileSync(join(dir, "index.html"), "utf8")).not.toContain("Watch on YouTube");
    delete process.env.YOUTUBE_CHANNEL_FILE;
  });

  it("with the Family Pass on: say Stripe takes the card, what is kept, the refund window, and still pass the reading gate", async () => {
    const { privacyPage, termsPage } = await import("../src/site/legal");
    const c = config();
    c.familyPass.enabled = true;
    c.site.fireDrillBaseUrl = "";
    const priv = privacyPage(c, "../");
    const terms = termsPage(c, "../");
    expect(priv).toMatch(/We never see or store your card number/);
    expect(priv).toMatch(/Your email, the date, the amount, and Stripe's payment number/);
    expect(priv).toMatch(/Resend/);
    expect(priv).not.toMatch(/Fire Drill/); // no address yet, so no Fire Drill
    expect(terms).toMatch(/\$19 one time/);
    expect(terms).toMatch(/Within 30 days of buying/);
    expect(terms).toMatch(/up to 5 family members/);
    for (const html of [priv, terms]) expect(checkReadability(text(html)).problems).toEqual([]);
    c.site.fireDrillBaseUrl = "https://drill.example";
    expect(privacyPage(c, "../")).toMatch(/Fire Drill/);
    resetConfigCache();
  });
});
