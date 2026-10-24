import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { checkReadability } from "../src/lib/readability";
import { resetConfigCache } from "../src/lib/config";
import { faviconSvg, icoFrom } from "../src/site/favicon";
import { fixtureScript, tmp } from "./helpers";
import { path } from "../src/lib/util";

const ep = (n: number, date: string) => ({ number: n, leadId: `l${n}`, date, skin: "imessage", cta: "none", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], slug: `${String(n).padStart(3, "0")}-case`, status: "published", youtubeId: `yt${n}` });

let dir: string;
beforeEach(() => {
  const t = tmp();
  dir = join(t, "site");
  process.env.LEDGER_FILE = join(t, "ledger.json");
  writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 4, episodes: [ep(1, "2026-10-20"), ep(2, "2026-10-21"), ep(3, "2026-10-22")], skipped: [] }));
  resetConfigCache();
});

async function build() {
  const { buildSite } = await import("../src/site/build");
  return buildSite({ dir, fireDrillDir: join(dir, "..", "fd"), date: "2026-10-22" });
}

describe("brand look", () => {
  it("uses the video's tokens: near-black, white ink, dim grey, red, Inter", async () => {
    await build();
    const css = readFileSync(join(dir, "assets/site.css"), "utf8");
    for (const token of ["--bg:#0A0C0F", "--ink:#FFFFFF", "--dim:#A9B0BA", "--red:#FF3B30", "font-family:Inter"]) expect(css).toContain(token);
    expect(existsSync(join(dir, "assets/inter.woff2"))).toBe(true);
  });

  it("home page, top to bottom: phone with REAL OR SCAM? stamp, red round button, tagline, case files, the never line", async () => {
    await build();
    const html = readFileSync(join(dir, "index.html"), "utf8");
    const $ = cheerio.load(html);
    expect($(".stage .stamp").first().text()).toBe("REAL ORSCAM?");
    expect($(".verdict-stamp").length).toBe(0); // no spoiler on the home page
    const order = [".stage", "a.btn.main", ".tagline", ".cases", ".never"].map((sel) => html.indexOf($(sel).first().toString().slice(0, 40)));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect($("a.btn.main").attr("href")).toBe("round/");
    expect($(".tagline").text()).toBe("One real scam text a day. Real or scam?");
    expect($(".case .no").map((_, e) => $(e).text()).get()).toEqual(["Scam No. 003", "Scam No. 002", "Scam No. 001"]);
    expect($(".never").text()).toBe("This channel never texts you, calls you, or asks for money.");
  });

  it("case files use the video's cover frame when we have it", async () => {
    mkdirSync(path("data/covers"), { recursive: true });
    const had = existsSync(path("data/covers/002.jpg"));
    if (!had) copyFileSync(path("data/covers/001.jpg"), path("data/covers/002.jpg"));
    try {
      await build();
      const $ = cheerio.load(readFileSync(join(dir, "index.html"), "utf8"));
      expect($(".case img[src='covers/002.jpg']").length).toBe(1);
      expect(existsSync(join(dir, "covers/002.jpg"))).toBe(true);
    } finally {
      if (!had) (await import("node:fs")).rmSync(path("data/covers/002.jpg"));
    }
  });

  it("every page links the favicon set and passes the grade 8 check (scam messages are quotes, not our copy)", async () => {
    const r = await build();
    for (const p of r.pages) {
      const $ = cheerio.load(readFileSync(join(dir, p), "utf8"));
      expect($("link[rel='icon'][href$='favicon.svg']").length, p).toBe(1);
      expect($("link[rel='icon'][href$='favicon.ico']").length, p).toBe(1);
      expect($("link[rel='apple-touch-icon'][href$='apple-touch-icon.png']").length, p).toBe(1);
      $("script, footer, .small, [data-quote], .stamp, .tags, .flags .small").remove();
      $("p, h1, h2, li, a, div, span").each((_, e) => { $(e).append("\n"); });
      expect(checkReadability($("main").text()).problems, p).toEqual([]);
    }
  });
});

describe("favicon", () => {
  it("is the approved design with the ? drawn as a path, no font needed", async () => {
    const svg = await faviconSvg();
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<rect width='64' height='64' rx='14' fill='#0A0C0F'/>");
    expect(svg).toContain("rotate(-10 32 32)");
    expect(svg).toMatch(/<path transform='translate\([-\d. ]+\)' d='M[^']+' fill='#FF3B30'\/>/);
  });

  it("ships favicon.ico with 16, 32 and 48 px images and a 180 px apple-touch-icon", async () => {
    await build();
    const ico = readFileSync(join(dir, "favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    const n = ico.readUInt16LE(4);
    expect([...Array(n)].map((_, i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
    const apple = readFileSync(join(dir, "apple-touch-icon.png"));
    expect([apple.readUInt32BE(16), apple.readUInt32BE(20)]).toEqual([180, 180]);
    expect(icoFrom([]).length).toBe(6);
  });
});
