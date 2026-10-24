import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigCache } from "../src/lib/config";
import { fixtureScript, tmp } from "./helpers";

// A real browser plays the round and presses Share, once as a phone and once as a computer.
const BROWSERS = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean) as string[];
const chrome = BROWSERS.find((b) => existsSync(b));
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

let server: Server;
let base = "";
beforeAll(async () => {
  if (!chrome) return;
  const t = tmp();
  const dir = join(t, "site");
  process.env.LEDGER_FILE = join(t, "ledger.json");
  const ep = { number: 2, leadId: "l2", date: "2026-10-22", skin: "imessage", cta: "none", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], slug: "002-case", status: "published", youtubeId: "yt2", youtubePrivacy: "public" };
  writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 3, episodes: [ep], skipped: [] }));
  resetConfigCache();
  const { buildSite } = await import("../src/site/build");
  await buildSite({ dir, fireDrillDir: join(t, "fd"), date: "2026-10-22" });
  server = createServer((req, res) => {
    let f = join(dir, decodeURIComponent(new URL(req.url!, "http://x").pathname));
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server?.close());

async function playRound(context: any) {
  const page = await context.newPage();
  await page.goto(`${base}/round/`);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Scam" }).click();
    await page.getByRole("button", { name: /Next message|See my score/ }).click();
  }
  return page;
}

describe.skipIf(!chrome)("share button", () => {
  it("on a phone opens the share sheet with the round link", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chrome });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    // Record what the share sheet would get.
    await context.addInitScript(() => {
      (window as any).__shared = [];
      (navigator as any).share = (d: unknown) => ((window as any).__shared.push(d), Promise.resolve());
    });
    const page = await playRound(context);
    await page.getByRole("button", { name: "Share my result" }).click();
    const shared = await page.evaluate(() => (window as any).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].text).toMatch(/^Scam #002 · I caught \d of 3\n/);
    expect(shared[0].text).toContain(`${base}/round/?d=2026-10-22`);
    await browser.close();
  }, 60_000);

  it("on a computer copies the text with the round link and says Copied! for 2 seconds", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chrome });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    // Desktop browsers often have navigator.share too: it must not be used here.
    await context.addInitScript(() => {
      (window as any).__shared = [];
      (navigator as any).share = (d: unknown) => ((window as any).__shared.push(d), Promise.resolve());
    });
    const page = await playRound(context);
    const btn = page.locator("button.main");
    await btn.click();
    await expect.poll(() => btn.textContent()).toBe("Copied!");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^Scam #002 · I caught \d of 3\n/);
    expect(clip).toContain(`${base}/round/?d=2026-10-22`);
    expect(await page.evaluate(() => (window as any).__shared.length)).toBe(0);
    await page.waitForTimeout(1500);
    expect(await btn.textContent()).toBe("Copied!");
    await page.waitForTimeout(800);
    expect(await btn.textContent()).toBe("Share my result");
    await browser.close();
  }, 60_000);
});
