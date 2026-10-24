import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildRedirectSite, cloudflareApi, deployCommand, pickSiteTarget, resolveCloudflareProject, WRANGLER } from "../src/site/target";
import { fakeCloudflare } from "../src/site/deploy-dry-run";
import { path } from "../src/lib/util";
import { tmp } from "./helpers";

beforeEach(() => {
  process.env.SITE_TARGET_FILE = join(tmp(), "site-target.json");
});

const secrets = { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", GITHUB_REPOSITORY: "houstoninvestments-jpg/Scam-Check-Shorts-channel" } as any;

describe("where the website goes", () => {
  it("stays on GitHub Pages until both Cloudflare secrets exist", async () => {
    const t = await pickSiteTarget({ GITHUB_REPOSITORY: "houstoninvestments-jpg/Scam-Check-Shorts-channel" } as any);
    expect(t).toEqual({ kind: "github-pages", baseUrl: "https://houstoninvestments-jpg.github.io/Scam-Check-Shorts-channel" });
    const half = await pickSiteTarget({ CLOUDFLARE_API_TOKEN: "t", GITHUB_REPOSITORY: "o/r" } as any);
    expect(half.kind).toBe("github-pages");
  });

  it("switches to Cloudflare Pages by itself once they are set", async () => {
    const t = await pickSiteTarget(secrets, fakeCloudflare());
    expect(t).toEqual({ kind: "cloudflare", baseUrl: "https://scamornot.pages.dev", project: "scamornot" });
    expect(JSON.parse(readFileSync(process.env.SITE_TARGET_FILE!, "utf8")).project).toBe("scamornot");
  });

  it("tries scamornot, then scamornotdaily, then scamornotshorts", async () => {
    expect((await pickSiteTarget(secrets, fakeCloudflare(["scamornot"]))).baseUrl).toBe("https://scamornotdaily.pages.dev");
    process.env.SITE_TARGET_FILE = join(tmp(), "s.json");
    expect((await pickSiteTarget(secrets, fakeCloudflare(["scamornot", "scamornotdaily"]))).baseUrl).toBe("https://scamornotshorts.pages.dev");
    process.env.SITE_TARGET_FILE = join(tmp(), "s2.json");
    await expect(pickSiteTarget(secrets, fakeCloudflare(["scamornot", "scamornotdaily", "scamornotshorts"]))).rejects.toThrow(/no Cloudflare Pages name worked/);
  });

  it("cleans up a project that came back on the wrong address", async () => {
    const f = fakeCloudflare(["scamornot"]);
    await resolveCloudflareProject(cloudflareApi("t", "a", f));
    const api = cloudflareApi("t", "a", f);
    expect((await api.get("scamornot")).success).toBe(false);
    expect((await api.get("scamornotdaily")).result.subdomain).toBe("scamornotdaily.pages.dev");
  });

  it("reuses the saved project when Cloudflare's API is down, so the day still runs", async () => {
    await pickSiteTarget(secrets, fakeCloudflare());
    const down = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    expect(await pickSiteTarget(secrets, down)).toEqual({ kind: "cloudflare", baseUrl: "https://scamornot.pages.dev", project: "scamornot" });
  });

  it("deploys with pinned Wrangler direct upload, free plan only", () => {
    const cmd = deployCommand({ kind: "cloudflare", baseUrl: "https://scamornot.pages.dev", project: "scamornot" });
    expect(cmd).toBe(`npx --yes ${WRANGLER} pages deploy site/dist --project-name=scamornot --branch=main --commit-dirty=true`);
    const wf = readFileSync(path(".github/workflows/daily.yml"), "utf8");
    expect(wf).toContain(`npx --yes ${WRANGLER} pages deploy site/dist`);
    expect(wf).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(wf).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
  });

  it("forwards every old GitHub Pages link to the same page on the new address", () => {
    const dir = buildRedirectSite(join(tmp(), "r"), "https://scamornot.pages.dev", "/Scam-Check-Shorts-channel");
    expect(readdirSync(dir).sort()).toEqual([".nojekyll", "404.html", "index.html"]);
    const html = readFileSync(join(dir, "404.html"), "utf8");
    expect(html).toContain('location.replace("https://scamornot.pages.dev"+p');
    expect(html).toContain('"/Scam-Check-Shorts-channel"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});

describe("nothing points at the old address", () => {
  it("only the GitHub Pages fallback code mentions github.io", () => {
    const files = ["config/channel.json", "src/publish/youtube.ts", "src/site/templates.ts", "src/site/build.ts", "src/site/cards.ts", "site/static/round.js", "site/static/signup.js", "README.md"];
    for (const f of files) expect(readFileSync(path(f), "utf8"), f).not.toMatch(/github\.io/);
  });
});
