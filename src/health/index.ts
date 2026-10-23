import { loadLedger, published } from "../lib/ledger.js";
import { path, readJson } from "../lib/util.js";
import type { RunReport } from "../pipeline/daily.js";
import type { SourceHealth } from "../scout/index.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

export interface HealthInput {
  lastRun: RunReport | null;
  ledger: ReturnType<typeof loadLedger>;
  sources: SourceHealth;
  now?: Date;
}

/** Everything that counts as broken. An empty list means stay quiet. */
export function findProblems({ lastRun, ledger, sources, now = new Date() }: HealthInput): string[] {
  const out: string[] = [];
  if (lastRun?.status === "failed") out.push(`The daily run on ${lastRun.date} failed: ${lastRun.errors[0]?.split("\n")[0] ?? "unknown error"}`);
  for (const w of lastRun?.warnings ?? []) if (/ElevenLabs/.test(w)) out.push(`Voice: ${w}`);
  if (ledger.firstUploadCheck?.locked)
    out.push("YouTube has locked uploads to private. The audit answers are ready in docs/youtube-audit-request.md; the form must be sent from the channel owner's Google account.");
  const live = ledger.firstUploadCheck && !ledger.firstUploadCheck.locked;
  const last = published(ledger).at(-1);
  if (live && last) {
    const hours = (now.getTime() - Date.parse(`${last.date}T23:59:00Z`)) / 3_600_000;
    if (hours > 48) out.push(`No new Short in ${Math.round(hours)} hours (last: Scam #${last.number} on ${last.date}).`);
  }
  const ids = Object.keys(sources);
  const down = ids.filter((id) => sources[id].consecutiveFailures >= 3);
  if (ids.length && down.length === ids.length) out.push("Every scam source has failed 3 days running. The scout has nothing to work with.");
  else for (const id of down.filter((id) => sources[id].consecutiveFailures >= 7)) out.push(`Source ${id} has failed ${sources[id].consecutiveFailures} days running: ${sources[id].lastError ?? ""}`);
  const skips = ledger.skipped.filter((s) => (now.getTime() - Date.parse(s.date)) / 86_400_000 <= 4);
  const days = new Set(skips.map((s) => s.date));
  if (days.size >= 3 && !published(ledger).some((e) => (now.getTime() - Date.parse(e.date)) / 86_400_000 <= 4))
    out.push(`The checker has skipped every scam for ${days.size} days. Last reason: ${skips.at(-1)?.reason}`);
  return out;
}

/** Exit 0 and say nothing when healthy. Exit 2 with an issue body when something broke. */
export async function health(): Promise<number> {
  const lastRun = existsSync(path("data/last-run.json")) ? readJson<RunReport>(path("data/last-run.json")) : null;
  const problems = findProblems({ lastRun, ledger: loadLedger(), sources: readJson<SourceHealth>(path("data/source-health.json"), {}) });
  if (!problems.length) return 0;
  const body = `Scam or Not health check found ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n\nThis issue closes itself when the next check passes.`;
  mkdirSync(path("work"), { recursive: true });
  writeFileSync(path("work/health-issue.md"), body);
  console.log(body);
  return 2;
}
