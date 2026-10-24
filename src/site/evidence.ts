import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

/** Evidence for Google's API audit form, taken from the live site: privacy and home screenshots, terms as PDF. */
export async function captureEvidence(base: string, out: string) {
  mkdirSync(out, { recursive: true });
  const exe = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(
    (p) => p && existsSync(p),
  );
  if (!exe) throw new Error("no Chrome found for the evidence screenshots");
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const files: string[] = [];
  const shot = async (rel: string, file: string) => {
    await page.goto(`${base}/${rel}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(out, file), fullPage: true });
    files.push(join(out, file));
  };
  await shot("privacy/", "privacy-policy.png");
  await shot("", "homepage.png");
  await page.goto(`${base}/terms/`, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "screen" });
  await page.pdf({ path: join(out, "terms.pdf"), format: "Letter", printBackground: true, margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" } });
  files.push(join(out, "terms.pdf"));
  await browser.close();
  return files;
}
