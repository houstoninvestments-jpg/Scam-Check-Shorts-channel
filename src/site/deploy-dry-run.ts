import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { resetConfigCache } from "../lib/config.js";
import { log, path } from "../lib/util.js";
import { buildSite } from "./build.js";
import { buildRedirectSite, deployCommand, pickSiteTarget, WRANGLER, type SiteTarget } from "./target.js";

/** A stand-in for Cloudflare's Pages API, used only by this dry run (this machine can't reach Cloudflare). */
export function fakeCloudflare(takenElsewhere: string[] = []) {
  const projects = new Map<string, string>();
  return (async (url: string, init: any = {}) => {
    const m = init.method ?? "GET";
    const name = url.split("/pages/projects")[1]?.replace(/^\//, "") || JSON.parse(init.body ?? "{}").name;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (m === "GET") return projects.has(name) ? json(200, { success: true, errors: [], result: { name, subdomain: projects.get(name) } }) : json(404, { success: false, errors: [{ code: 8000007, message: "Project not found" }], result: null });
    if (m === "POST") {
      const sub = takenElsewhere.includes(name) ? `${name}-7x2.pages.dev` : `${name}.pages.dev`;
      projects.set(name, sub);
      return json(200, { success: true, errors: [], result: { name, subdomain: sub } });
    }
    if (m === "DELETE") {
      projects.delete(name);
      return json(200, { success: true, errors: [], result: null });
    }
    return json(405, { success: false, errors: [{ code: 405, message: "method" }], result: null });
  }) as unknown as typeof fetch;
}

async function buildFor(t: SiteTarget, dir: string) {
  process.env.SITE_BASE_URL = t.baseUrl;
  resetConfigCache();
  const r = await buildSite({ dryRun: true, dir, fireDrillDir: join(dir, "..", "firedrill") });
  const $ = cheerio.load(readFileSync(join(dir, "index.html"), "utf8"));
  const og = $("meta[property='og:image']").attr("content") ?? "";
  if (!og.startsWith(t.baseUrl + "/")) throw new Error(`share card points at ${og}, expected ${t.baseUrl}`);
  const sitemap = readFileSync(join(dir, "sitemap.xml"), "utf8");
  if (/github\.io/.test(sitemap) && t.kind === "cloudflare") throw new Error("sitemap still points at GitHub Pages");
  return r.pages.length;
}

export async function deployDryRun() {
  process.env.LEDGER_FILE ??= path("data/dry-run/ledger.json");
  process.env.SITE_TARGET_FILE = path("work/deploy-dry-run/site-target.json");
  const repo = "houstoninvestments-jpg/Scam-Check-Shorts-channel";

  log("PATH 1: no Cloudflare secrets yet");
  const gh = await pickSiteTarget({ GITHUB_REPOSITORY: repo } as any);
  const ghPages = await buildFor(gh, path("work/deploy-dry-run/github/dist"));
  log(`  target ${gh.kind}, address ${gh.baseUrl}, ${ghPages} pages built`);
  log(`  deploy: ${deployCommand(gh)}`);

  log("PATH 2: Cloudflare secrets set (simulated Cloudflare API)");
  const cf = await pickSiteTarget({ CLOUDFLARE_API_TOKEN: "dry-run", CLOUDFLARE_ACCOUNT_ID: "dry-run", GITHUB_REPOSITORY: repo } as any, fakeCloudflare());
  const cfPages = await buildFor(cf, path("work/deploy-dry-run/cloudflare/dist"));
  log(`  target ${cf.kind}, address ${cf.baseUrl}, ${cfPages} pages built, every link and share card on ${cf.baseUrl}`);
  log(`  deploy: ${deployCommand(cf, "site/dist")}`);
  const redirect = buildRedirectSite(path("work/deploy-dry-run/github-redirect"), cf.baseUrl, "/Scam-Check-Shorts-channel");
  log(`  old GitHub Pages address gets a forwarder: ${redirect}`);

  log("PATH 2b: first name taken by someone else (simulated)");
  process.env.SITE_TARGET_FILE = path("work/deploy-dry-run/site-target-2.json");
  const cf2 = await pickSiteTarget({ CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "x" } as any, fakeCloudflare(["scamornot"]));
  log(`  falls back to ${cf2.baseUrl}`);

  log(`Checking the pinned ${WRANGLER} accepts the deploy flags`);
  const help = execFileSync("npx", ["--yes", WRANGLER, "pages", "deploy", "--help"], { encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  for (const flag of ["--project-name", "--branch", "--commit-dirty"]) {
    if (!help.includes(flag)) throw new Error(`wrangler pages deploy has no ${flag}`);
  }
  log("  ok: --project-name, --branch, --commit-dirty all present");
  delete process.env.SITE_BASE_URL;
  resetConfigCache();
}
