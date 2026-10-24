import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pagesBaseUrl } from "../lib/config.js";
import { path, readJson, writeJson } from "../lib/util.js";

/**
 * Where the website goes. Cloudflare Pages (free plan, allows selling later) once both
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set; until then, GitHub Pages as before.
 */

export const CF_PROJECT_CANDIDATES = ["scamornot", "scamornotdaily", "scamornotshorts"];
/** Pinned so a Wrangler release can't change the deploy under us. */
export const WRANGLER = "wrangler@4.151.2";

export type SiteTarget =
  | { kind: "github-pages"; baseUrl: string }
  | { kind: "cloudflare"; baseUrl: string; project: string };

const CF_API = "https://api.cloudflare.com/client/v4";
const SAVED = () => process.env.SITE_TARGET_FILE || path("data/site-target.json");

interface CfResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}
interface CfProject {
  name: string;
  subdomain: string; // e.g. "scamornot.pages.dev"
}

export function cloudflareApi(token: string, accountId: string, fetchImpl: typeof fetch = fetch) {
  const call = async <T>(method: string, rel: string, body?: unknown): Promise<CfResponse<T> & { status: number }> => {
    const res = await fetchImpl(`${CF_API}/accounts/${accountId}/pages/projects${rel}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => ({ success: false, errors: [{ code: res.status, message: res.statusText }], result: null }))) as CfResponse<T>;
    return { ...j, status: res.status };
  };
  return {
    get: (name: string) => call<CfProject>("GET", `/${name}`),
    create: (name: string) => call<CfProject>("POST", "", { name, production_branch: "main" }),
    remove: (name: string) => call<unknown>("DELETE", `/${name}`),
  };
}

/**
 * Use the first candidate whose address is exactly <name>.pages.dev.
 * A project already in this account is reused. A name owned by someone else either fails to
 * create or comes back with a different address; either way we clean up and try the next name.
 */
export async function resolveCloudflareProject(api: ReturnType<typeof cloudflareApi>, candidates = CF_PROJECT_CANDIDATES): Promise<{ project: string; baseUrl: string; tried: string[] }> {
  const tried: string[] = [];
  const saved = readJson<{ project?: string }>(SAVED(), {});
  const order = saved.project && candidates.includes(saved.project) ? [saved.project, ...candidates.filter((c) => c !== saved.project)] : candidates;
  for (const name of order) {
    const want = `${name}.pages.dev`;
    const existing = await api.get(name);
    if (existing.success && existing.result) {
      if (existing.result.subdomain === want) return done(name, tried);
      tried.push(`${name}: in this account but at ${existing.result.subdomain}`);
      continue;
    }
    const made = await api.create(name);
    if (!made.success || !made.result) {
      tried.push(`${name}: ${made.errors?.[0]?.message ?? `HTTP ${made.status}`}`);
      continue;
    }
    if (made.result.subdomain === want) return done(name, tried);
    tried.push(`${name}: address taken, got ${made.result.subdomain}`);
    await api.remove(name);
  }
  throw new Error(`no Cloudflare Pages name worked: ${tried.join("; ")}`);
}

function done(project: string, tried: string[]) {
  writeJson(SAVED(), { project, address: `https://${project}.pages.dev` });
  return { project, baseUrl: `https://${project}.pages.dev`, tried };
}

export async function pickSiteTarget(env = process.env, fetchImpl: typeof fetch = fetch): Promise<SiteTarget> {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (token && account) {
    try {
      const r = await resolveCloudflareProject(cloudflareApi(token, account, fetchImpl));
      return { kind: "cloudflare", baseUrl: r.baseUrl, project: r.project };
    } catch (e) {
      // A Cloudflare hiccup must not stop the day's video: reuse the last address that worked.
      const saved = readJson<{ project?: string }>(SAVED(), {});
      if (saved.project) return { kind: "cloudflare", baseUrl: `https://${saved.project}.pages.dev`, project: saved.project };
      throw e;
    }
  }
  const repo = env.GITHUB_REPOSITORY ?? "houstoninvestments-jpg/Scam-Check-Shorts-channel";
  return { kind: "github-pages", baseUrl: pagesBaseUrl(repo) };
}

/** The exact deploy command for a target. Cloudflare uses Wrangler's direct upload; GitHub Pages uses the Actions deploy step. */
export function deployCommand(t: SiteTarget, dir = "site/dist"): string {
  return t.kind === "cloudflare"
    ? `npx --yes ${WRANGLER} pages deploy ${dir} --project-name=${t.project} --branch=main --commit-dirty=true`
    : `actions/deploy-pages (artifact: ${dir})`;
}

/**
 * Once the site lives on Cloudflare, the old GitHub Pages address keeps working by forwarding
 * every page to the same path on the new address.
 */
export function buildRedirectSite(dir: string, newBase: string, oldPrefix: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scam or Not has moved</title><meta name="robots" content="noindex"><link rel="canonical" href="${newBase}/">
<meta http-equiv="refresh" content="2;url=${newBase}/">
<script>(function(){var p=location.pathname;var pre=${JSON.stringify(oldPrefix)};if(pre&&p.indexOf(pre)===0)p=p.slice(pre.length);if(p.charAt(0)!=="/")p="/"+p;location.replace(${JSON.stringify(newBase)}+p+location.search+location.hash);})();</script>
<style>body{margin:0;font:20px/1.5 system-ui,sans-serif;background:#fff;color:#0d0f12}main{max-width:560px;margin:15vh auto;padding:0 16px}</style>
</head><body><main><h1>Scam or Not has moved</h1><p>Taking you to <a href="${newBase}/">${newBase.replace(/^https:\/\//, "")}</a>.</p></main></body></html>
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "404.html"), html);
  writeFileSync(join(dir, ".nojekyll"), "");
  return dir;
}
