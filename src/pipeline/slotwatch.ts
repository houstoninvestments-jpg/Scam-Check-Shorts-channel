import { config } from "../lib/config.js";
import { path, readJson, writeJson } from "../lib/util.js";
import type { RunReport } from "./daily.js";

/**
 * A missed slot never sits unnoticed:
 *  - every slot start is recorded, and how it ended (posted, or why not)
 *  - a slot that ends without posting is retried once, right away, library first
 *  - if the retry misses too, one plain-English email goes out
 *  - a separate watch emails if a slot hasn't started 30 minutes after its time, if a retry never
 *    started, or if a start never finished
 */

export interface SlotAttempt {
  startedAt: string;
  runId?: string;
  endedAt?: string;
  ok?: boolean; // posted (or the day was already full)
  why?: string;
  tried?: string[];
}
export interface SlotEntry {
  attempts: SlotAttempt[];
  alerted?: string[]; // which alerts were sent for this slot (each kind once)
}
export type SlotRuns = Record<string, Record<string, SlotEntry>>;

/** How long a start may run before it counts as stuck (the job's own limit is 60 minutes). */
export const STUCK_MINUTES = 90;
/** How long after a miss the retry has to start before the watch emails. */
export const RETRY_GRACE_MINUTES = 45;
/** How long after its time a slot has to start before the watch emails. */
export const START_GRACE_MINUTES = 30;

export const slotRunsFile = (dryRun = false) => process.env.SLOT_RUNS_FILE || path(dryRun ? "data/dry-run/slot-runs.json" : "data/slot-runs.json");

/** Reads the record. Older entries (just a start time) count as finished, outcome unknown: never retried. */
export function loadSlotRuns(file: string): SlotRuns {
  const raw = readJson<Record<string, Record<string, string | SlotEntry>>>(file, {});
  const out: SlotRuns = {};
  for (const [date, slots] of Object.entries(raw)) {
    out[date] = {};
    for (const [slot, v] of Object.entries(slots)) {
      out[date][slot] = typeof v === "string" ? { attempts: [{ startedAt: v, endedAt: v, ok: true, why: "older record, outcome not kept" }] } : v;
    }
  }
  return out;
}

export function saveSlotRuns(file: string, runs: SlotRuns) {
  for (const d of Object.keys(runs).sort().slice(0, -14)) delete runs[d]; // two weeks is plenty
  writeJson(file, runs);
}

const minutes = (a: Date, iso: string) => (a.getTime() - Date.parse(iso)) / 60_000;

/**
 * May this start of the slot go ahead, and as which attempt?
 * First start: attempt 1. After a miss: one retry (attempt 2, library first). Otherwise it exits.
 */
export function slotStart(entry: SlotEntry | undefined, now = new Date(), runId?: string): { go: boolean; attempt?: number; recorded?: boolean; why: string } {
  const attempts = entry?.attempts ?? [];
  // This run already recorded its start (the workflow saves it at the top of the job so the watch can see it).
  const own = runId ? attempts.findIndex((a) => a.runId === runId && !a.endedAt) : -1;
  if (own >= 0) return { go: true, attempt: own + 1, recorded: true, why: own ? "retry after a miss" : "first start" };
  if (!attempts.length) return { go: true, attempt: 1, why: "first start" };
  if (attempts.some((a) => a.ok)) return { go: false, why: "already posted (or the day was full)" };
  const last = attempts[attempts.length - 1];
  if (!last.endedAt && minutes(now, last.startedAt) < STUCK_MINUTES) return { go: false, why: `already running since ${last.startedAt}` };
  if (attempts.length >= 2) return { go: false, why: "already missed twice; the email went out" };
  return { go: true, attempt: 2, why: `retry after a miss (${last.why ?? "the first start never finished"})` };
}

/** Plain-English list of what a run tried, from its report. */
export function triedFrom(report: RunReport): string[] {
  const out: string[] = [];
  for (const s of report.steps) {
    if (s.step === "scout") out.push(`Looked for new scams: ${s.detail}`);
    else if (s.step === "library" || s.step === "library first") out.push(`Evergreen library: ${s.detail}`);
    else if (s.step === "check") out.push(`${s.ok ? "Passed" : "Did not pass"} the checks: ${s.detail}`);
    else if (s.step === "same day") out.push(`Held back: ${s.detail}`);
    else if (!s.ok) out.push(`${s.step}: ${s.detail}`);
  }
  return out.slice(0, 20);
}

/** Why a run did not post, in a sentence. */
export function whyFrom(report: RunReport | undefined, jobStatus: string): string {
  if (!report) return `the job stopped before the slot could run (GitHub job status: ${jobStatus})`;
  if (report.status === "failed") return `it broke: ${(report.errors[0] ?? "unknown error").split("\n")[0].slice(0, 300)}`;
  return report.warnings.at(-1) ?? report.steps.at(-1)?.detail ?? report.status;
}

/** A run counts as done for its slot when it posted, or the day already had its 3. Dry runs: rendered counts. */
export function postedOk(report: RunReport | undefined): boolean {
  if (!report) return false;
  if (report.status === "published" || (report.dryRun && report.status === "rendered")) return true;
  return report.status === "skipped" && report.steps.some((s) => s.step === "cadence");
}

const SLOT_TIMES = () => Object.fromEntries(config().cadence.slots.map((s) => [String(s.slot), s.pacific])) as Record<string, string>;

/** "12:20" -> "12:20pm" */
export const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const pacificTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" ", "").toLowerCase();
const niceDate = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));

export interface Alert {
  kind: "missed twice" | "not started" | "retry not started" | "stuck";
  subject: string;
  text: string;
}

function nextSlotLine(slot: number) {
  const next = config().cadence.slots.find((s) => s.slot === slot + 1);
  return next ? `The next slot is ${ampm(next.pacific)} Pacific today.` : "The next slot is 7:20am Pacific tomorrow.";
}

/** The email after a slot's retry also missed. */
export function missedTwiceAlert(date: string, slot: number, entry: SlotEntry, runUrl?: string, drill = false): Alert {
  const time = ampm(SLOT_TIMES()[String(slot)] ?? "00:00");
  const lines = [
    drill ? "THIS IS A TEST. Nothing is wrong: a test run forced this miss so the alert could be checked. Nothing was uploaded.\n" : "",
    `Slot ${slot} (${time} Pacific) on ${niceDate(date)} did not post a video.`,
    "",
    `Why: ${entry.attempts.at(-1)?.why ?? "unknown"}`,
    "",
    "What was tried:",
  ];
  entry.attempts.forEach((a, i) => {
    lines.push(`${i === 0 ? "First try" : "Retry (evergreen library first)"} at ${pacificTime(a.startedAt)}: ${a.why ?? "no outcome recorded"}`);
    for (const t of a.tried ?? []) lines.push(`  - ${t}`);
  });
  lines.push("", `Nothing more will be tried for this slot. ${nextSlotLine(slot)}`);
  if (runUrl) lines.push("", `Run: ${runUrl}`);
  return { kind: "missed twice", subject: `${drill ? "TEST: " : ""}Scam or Not: slot ${slot} (${time}) missed on ${niceDate(date)}`, text: lines.filter((l, i) => l || i > 0).join("\n") };
}

/** Wall-clock instant of a Pacific date + "HH:MM". */
export function pacificInstant(date: string, hhmm: string): Date {
  // Try both offsets; keep the one that reads back as the same Pacific clock time.
  for (const off of [7, 8]) {
    const [h, m] = hhmm.split(":").map(Number);
    const [y, mo, d] = date.split("-").map(Number);
    const at = new Date(Date.UTC(y, mo - 1, d, h + off, m));
    const back = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    if (back === hhmm) return at;
  }
  throw new Error(`no such Pacific time ${date} ${hhmm}`);
}

/**
 * The watch: which slots in the last 12 hours need an email right now. Each kind is sent once per slot.
 * Not started 30 minutes after its time; a miss whose retry never started; a start that never finished.
 */
export type SentAlerts = Record<string, Record<string, string[]>>;
export const slotAlertsFile = () => process.env.SLOT_ALERTS_FILE || path("data/slot-alerts.json");

export function watchSlots(runs: SlotRuns, now = new Date(), sentBefore: SentAlerts = {}): { date: string; slot: number; alert: Alert }[] {
  const out: { date: string; slot: number; alert: Alert }[] = [];
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
  const dates = [...new Set([day(new Date(now.getTime() - 86_400_000)), day(now)])];
  for (const date of dates) {
    for (const s of config().cadence.slots) {
      const due = pacificInstant(date, s.pacific);
      const late = (now.getTime() - due.getTime()) / 60_000;
      if (late < START_GRACE_MINUTES || late > 12 * 60) continue;
      const entry = runs[date]?.[String(s.slot)];
      const sent = new Set([...(entry?.alerted ?? []), ...(sentBefore[date]?.[String(s.slot)] ?? [])]);
      const head = `Slot ${s.slot} (${ampm(s.pacific)} Pacific) on ${niceDate(date)}`;
      const subj = (what: string) => `Scam or Not: slot ${s.slot} (${ampm(s.pacific)}) ${what} on ${niceDate(date)}`;
      const attempts = entry?.attempts ?? [];
      const last = attempts.at(-1);
      let alert: Alert | undefined;
      if (!attempts.length) {
        alert = {
          kind: "not started",
          subject: subj("did not start"),
          text: `${head} had not started ${Math.round(late)} minutes after its time.\n\nWhy: no start was recorded. The Cloudflare timer should have started it at ${ampm(s.pacific)}, and GitHub's own schedule is the backup.\n\nWhat was tried: nothing yet. If GitHub's backup start arrives late, the slot will still run then.\n\n${nextSlotLine(s.slot)}`,
        };
      } else if (attempts.some((a) => a.ok)) continue;
      else if (last && !last.endedAt && minutes(now, last.startedAt) >= STUCK_MINUTES) {
        alert = {
          kind: "stuck",
          subject: subj("never finished"),
          text: `${head} started at ${pacificTime(last.startedAt)} but never finished.\n\nWhy: the job stopped without recording how it ended.\n\nWhat was tried: ${attempts.length === 1 ? "the first try" : "the first try and the retry"}.\n\n${nextSlotLine(s.slot)}`,
        };
      } else if (attempts.length === 1 && last?.endedAt && minutes(now, last.endedAt) >= RETRY_GRACE_MINUTES) {
        alert = {
          kind: "retry not started",
          subject: subj("missed, retry did not start"),
          text: `${head} did not post, and its retry had not started ${Math.round(minutes(now, last.endedAt))} minutes later.\n\nWhy the first try missed: ${last.why ?? "unknown"}\n\nWhat was tried:\n${(last.tried ?? []).map((t) => `  - ${t}`).join("\n") || "  - the first try"}\n\n${nextSlotLine(s.slot)}`,
        };
      }
      if (alert && !sent.has(alert.kind)) out.push({ date, slot: s.slot, alert });
    }
  }
  return out;
}

/** Marks an alert as sent in the record so it is never sent twice. */
export function markAlerted(runs: SlotRuns, date: string, slot: number, kind: string) {
  runs[date] ??= {};
  const e = (runs[date][String(slot)] ??= { attempts: [] });
  e.alerted = [...new Set([...(e.alerted ?? []), kind])];
}

/** Sends one alert email through Resend. The address is never printed: run logs are public. */
export async function sendAlert(alert: Alert, fetcher: typeof fetch = fetch): Promise<{ sent: boolean; detail: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL || config().channel.contactEmail;
  const toLabel = process.env.ALERT_EMAIL ? "ALERT_EMAIL" : "the site's contact address (ALERT_EMAIL not set)";
  if (!key) return { sent: false, detail: "RESEND_API_KEY is not set; email not sent" };
  if (!to) return { sent: false, detail: "no address to send to; email not sent" };
  const domain = new URL(config().site.baseUrl).hostname;
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: `Scam or Not alerts <alerts@${domain}>`, to: [to], subject: alert.subject, text: alert.text }),
  });
  const body = await res.text();
  if (!res.ok) return { sent: false, detail: `Resend refused (${res.status}): ${body.slice(0, 200)}` };
  let id = "";
  try {
    id = JSON.parse(body).id ?? "";
  } catch {
    /* fine */
  }
  return { sent: true, detail: `sent to ${toLabel}${id ? `, Resend id ${id}` : ""}` };
}

/**
 * How a slot's run ended, recorded against its try. Posted: done. First miss: retry. Second miss: one email.
 * A run whose report isn't its own never got as far as the slot (setup broke): that counts as a failed try.
 */
export async function slotEnd(o: {
  slot: number;
  date: string;
  dryRun: boolean;
  runId?: string;
  jobStatus: string;
  report: RunReport | undefined;
  runUrl?: string;
  now?: Date;
  send?: (a: Alert) => Promise<{ sent: boolean; detail: string }>;
}): Promise<{ action: "done" | "retry" | "alert" | "none"; detail: string; alert?: Alert; sent?: { sent: boolean; detail: string } }> {
  const now = o.now ?? new Date();
  const file = slotRunsFile(o.dryRun);
  const runs = loadSlotRuns(file);
  const report = o.report?.runId === o.runId ? o.report : undefined; // an older run's report: this run never got that far
  const key = String(o.slot);
  let entry = runs[o.date]?.[key];
  let mine = entry?.attempts.find((a) => a.runId === o.runId && !a.endedAt);
  if (!mine) {
    if (report) return { action: "none", detail: "this start exited without running the slot (already running, posted, or retried)" };
    if (!slotStart(entry, now).go) return { action: "none", detail: "the job stopped early, but the slot is already done or running elsewhere" };
    runs[o.date] ??= {};
    entry = runs[o.date][key] ??= { attempts: [] };
    mine = { startedAt: now.toISOString(), runId: o.runId };
    entry.attempts.push(mine);
  }
  const ok = postedOk(report);
  Object.assign(mine, { endedAt: now.toISOString(), ok, why: ok ? "posted" : whyFrom(report, o.jobStatus), tried: report ? triedFrom(report) : [] });
  saveSlotRuns(file, runs);
  if (ok) return { action: "done", detail: `slot ${o.slot} done: ${report?.status}` };
  if (entry!.attempts.length < 2) return { action: "retry", detail: `slot ${o.slot} missed (${mine.why}); retrying once now, evergreen library first` };
  const alert = missedTwiceAlert(o.date, o.slot, entry!, o.runUrl, o.dryRun);
  const sent = await (o.send ?? sendAlert)(alert);
  if (sent.sent) {
    markAlerted(runs, o.date, o.slot, alert.kind);
    saveSlotRuns(file, runs);
  }
  return { action: "alert", detail: `slot ${o.slot} missed twice (${mine.why})`, alert, sent };
}
