import { describe, expect, it } from "vitest";
import { config, pagesBaseUrl, resetConfigCache } from "../src/lib/config";

describe("site address", () => {
  it("serves an <owner>.github.io repo at the root", () => {
    expect(pagesBaseUrl("scamornot/scamornot.github.io")).toBe("https://scamornot.github.io");
    expect(pagesBaseUrl("ScamOrNot/ScamOrNot.github.io")).toBe("https://scamornot.github.io");
  });
  it("serves any other repo under a path", () => {
    expect(pagesBaseUrl("houstoninvestments-jpg/Scam-Check-Shorts-channel")).toBe("https://houstoninvestments-jpg.github.io/Scam-Check-Shorts-channel");
  });
  it("follows the repo when running in GitHub Actions, unless SITE_BASE_URL is set", () => {
    const keep = { ...process.env };
    try {
      delete process.env.SITE_BASE_URL;
      process.env.GITHUB_REPOSITORY = "scamornot/scamornot.github.io";
      resetConfigCache();
      expect(config().site.baseUrl).toBe("https://scamornot.github.io");
      process.env.SITE_BASE_URL = "https://example.test";
      resetConfigCache();
      expect(config().site.baseUrl).toBe("https://example.test");
    } finally {
      process.env = keep;
      resetConfigCache();
    }
  });
});
