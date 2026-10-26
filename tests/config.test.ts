import { describe, expect, it } from "vitest";
import { config, pagesBaseUrl, resetConfigCache } from "../src/lib/config";

describe("site address", () => {
  it("defaults to our own domain", () => {
    const keep = process.env.SITE_BASE_URL;
    delete process.env.SITE_BASE_URL;
    resetConfigCache();
    expect(config().site.baseUrl).toBe("https://scamornotdaily.com");
    if (keep) process.env.SITE_BASE_URL = keep;
    resetConfigCache();
  });
  it("uses SITE_BASE_URL from the daily job when set", () => {
    process.env.SITE_BASE_URL = "https://scamornotdaily.pages.dev/";
    resetConfigCache();
    expect(config().site.baseUrl).toBe("https://scamornotdaily.pages.dev");
    delete process.env.SITE_BASE_URL;
    resetConfigCache();
  });
  it("knows the GitHub Pages fallback address", () => {
    expect(pagesBaseUrl("houstoninvestments-jpg/Scam-Check-Shorts-channel")).toBe("https://houstoninvestments-jpg.github.io/Scam-Check-Shorts-channel");
    expect(pagesBaseUrl("scamornot/scamornot.github.io")).toBe("https://scamornot.github.io");
  });
});
