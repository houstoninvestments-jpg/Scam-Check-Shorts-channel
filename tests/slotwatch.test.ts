import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SourceDoc } from "../src/types";
import { path, readJson, sha } from "../src/lib/util";
import { config } from "../src/lib/config";
import { loadSlotRuns, missedTwiceAlert, pacificInstant, sendAlert, slotEnd, slotStart, watchSlots, type SlotRuns } from "../src/pipeline/slotwatch";
// @ts-expect-error plain JS module
import { plan } from "../timer/worker.js";
import { fixtureScript } from "./helpers";

const iso = (s: string) => new Date(s).toISOString();
const failingLLM: any = { mode: "fixture", calls: [], async json() { throw new Error("must not be called"); } };

let t: string;
beforeEach(() => {
  t = mkdtempSync(join(tmpdir(), "sw-"));
  process.env.SLOT_RUNS_FILE = join(t, "slot-runs.json");
  process.env.LEDGER_FILE = join(t, "ledger.json");
  process.env.LAST_RUN_FILE = join(t, "last-run.json");
  process.env.LIBRARY_DIR = mkdtempSync(join(tmpdir(), "lib-"));
  writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 9, episodes: [], skipped: [] }));
});

describe("slot starts", () => {
  const now = new Date("2026-10-27T20:00:00Z");
  it("first start goes; a running slot, a posted slot and a twice-missed slot exit; a miss gets one retry", () => {
    expect(slotStart(undefined, now)).toMatchObject({ go: true, attempt: 1 });
    expect(slotStart({ attempts: [{ startedAt: iso("2026-10-27T19:21:00Z") }] }, now).go).toBe(false);
    expect(slotStart({ attempts: [{ startedAt: iso("2026-10-27T19:21:00Z"), endedAt: iso("2026-10-27T19:40:00Z"), ok: true }] }, now).go).toBe(false);
    const missed = { attempts: [{ startedAt: iso("2026-10-27T19:21:00Z"), endedAt: iso("2026-10-27T19:40:00Z"), ok: false, why: "no lead passed both checks" }] };
    expect(slotStart(missed, now)).toMatchObject({ go: true, attempt: 2 });
    expect(slotStart({ attempts: [...missed.attempts, { ...missed.attempts[0] }] }, now).go).toBe(false);
    // A start that never finished counts as a miss after 90 minutes.
    expect(slotStart({ attempts: [{ startedAt: iso("2026-10-27T18:00:00Z") }] }, now)).toMatchObject({ go: true, attempt: 2 });
    // The run that saved its own start at the top of the job carries on as that try.
    expect(slotStart({ attempts: [{ startedAt: iso("2026-10-27T19:21:00Z"), runId: "42" }] }, now, "42")).toMatchObject({ go: true, attempt: 1, recorded: true });
  });

  it("older records (just a start time) count as done, never retried", () => {
    writeFileSync(process.env.SLOT_RUNS_FILE!, JSON.stringify({ "2026-10-27": { "1": "2026-10-27T14:21:45Z" } }));
    expect(slotStart(loadSlotRuns(process.env.SLOT_RUNS_FILE!)["2026-10-27"]["1"], now).go).toBe(false);
  });
});

describe("a missed slot is retried once, then emailed", () => {
  it("forced miss: first try asks for a retry, the retry goes library first, the second miss sends one email", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const date = "2026-10-27";
    process.env.GITHUB_RUN_ID = "101";
    const first = await runDaily({ dryRun: true, llm: failingLLM, fixtureSources: ["ftc-traffic-qr.json"], slot: 2, slotDate: date, fakeMiss: true, workDir: join(t, "w1") });
    expect(first.status).toBe("skipped");
    expect(first.attempt).toBe(1);
    const end1 = await slotEnd({ slot: 2, date, dryRun: true, runId: "101", jobStatus: "success", report: first, send: async () => { throw new Error("no email on the first miss"); } });
    expect(end1.action).toBe("retry");

    process.env.GITHUB_RUN_ID = "102";
    const second = await runDaily({ dryRun: true, llm: failingLLM, fixtureSources: ["ftc-traffic-qr.json"], slot: 2, slotDate: date, fakeMiss: true, workDir: join(t, "w2") });
    expect(second.attempt).toBe(2);
    expect(second.steps.map((s) => s.step)).toContain("library first");
    const emails: any[] = [];
    const end2 = await slotEnd({ slot: 2, date, dryRun: true, runId: "102", jobStatus: "success", report: second, runUrl: "https://github.com/x/y/actions/runs/102", send: async (a) => (emails.push(a), { sent: true, detail: "sent" }) });
    expect(end2.action).toBe("alert");
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("TEST: Scam or Not: slot 2 (12:20pm) missed on Tue, Oct 27");
    expect(emails[0].text).toMatch(/Slot 2 \(12:20pm Pacific\) on Tue, Oct 27 did not post a video/);
    expect(emails[0].text).toMatch(/Why: test: forced miss/);
    expect(emails[0].text).toMatch(/First try at .*\nRetry \(evergreen library first\) at /s);
    expect(emails[0].text).toMatch(/would try 0 evergreen library pages/);

    // A third start exits, and no second email.
    process.env.GITHUB_RUN_ID = "103";
    const third = await runDaily({ dryRun: true, llm: failingLLM, fixtureSources: ["ftc-traffic-qr.json"], slot: 2, slotDate: date, fakeMiss: true, workDir: join(t, "w3") });
    expect(third.steps[0].detail).toMatch(/missed twice/);
    expect((await slotEnd({ slot: 2, date, dryRun: true, runId: "103", jobStatus: "success", report: third })).action).toBe("none");
    expect(readJson<SlotRuns>(process.env.SLOT_RUNS_FILE!)[date]["2"].alerted).toEqual(["missed twice"]);
    delete process.env.GITHUB_RUN_ID;
  });

  it("a job that broke before the slot ran counts as a failed try and is retried", async () => {
    const r = await slotEnd({ slot: 1, date: "2026-10-28", dryRun: false, runId: "7", jobStatus: "failure", report: undefined });
    expect(r.action).toBe("retry");
    expect(r.detail).toMatch(/stopped before the slot could run/);
  });

  it("a forced miss is refused on a live run", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const r = await runDaily({ dryRun: false, llm: failingLLM, slot: 1, slotDate: "2026-10-28", fakeMiss: true, workDir: join(t, "w") });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/test runs only/);
  });

  it("the retry tries the evergreen library before fresh leads", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const ftc = readJson<SourceDoc>(path("fixtures/sources/ftc-traffic-qr.json"));
    const copy = "https://consumer.ftc.gov/library-copy";
    const dir = process.env.LIBRARY_DIR!;
    writeFileSync(join(dir, `${sha(copy)}.json`), JSON.stringify({ ...ftc, url: copy }));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ refreshedAt: "2026-10-27T00:00:00Z", entries: [{ id: sha(copy), url: copy, title: ftc.title, kind: ftc.kind, name: ftc.name, fetchedAt: ftc.fetchedAt, chars: ftc.text.length }] }));
    writeFileSync(process.env.SLOT_RUNS_FILE!, JSON.stringify({ "2026-10-27": { "3": { attempts: [{ startedAt: iso("2026-10-28T00:21:00Z"), endedAt: iso("2026-10-28T00:40:00Z"), ok: false, why: "no lead passed both checks today; skipped" }] } } }));
    const llm: any = {
      mode: "fixture",
      roles: [] as string[],
      async json(call: any) {
        this.roles.push(call.role);
        if (call.role.startsWith("writer")) return call.schema.parse(JSON.parse(JSON.stringify(fixtureScript()).split(ftc.url).join(copy)));
        return call.schema.parse({ verdict: "scam", confidence: 0.9, problems: [] });
      },
    };
    process.env.KOKORO_DIR = "/nonexistent"; // stop before voice
    const r = await runDaily({ dryRun: true, llm, fixtureSources: ["ftc-traffic-qr.json"], library: true, slot: 3, slotDate: "2026-10-27", voice: "kokoro", workDir: join(t, "w") });
    expect(r.attempt).toBe(2);
    const order = r.steps.map((s) => s.step);
    expect(order.indexOf("library")).toBeLessThan(order.indexOf("check"));
    expect(llm.roles).toEqual(["writer", "checker-a", "checker-b"]); // the library page passed; no fresh lead needed
  });
});

describe("the 30-minute watch", () => {
  const date = "2026-10-27";
  const at = (min: number) => new Date(pacificInstant(date, "12:20").getTime() + min * 60_000);

  it("emails once when a slot has not started 30 minutes after its time", () => {
    expect(watchSlots({}, at(25)).filter((d) => d.slot === 2)).toEqual([]);
    const due = watchSlots({}, at(35)).filter((d) => d.date === date && d.slot === 2);
    expect(due).toHaveLength(1);
    expect(due[0].alert.subject).toBe("Scam or Not: slot 2 (12:20pm) did not start on Tue, Oct 27");
    expect(due[0].alert.text).toMatch(/had not started 35 minutes after its time/);
    expect(watchSlots({}, at(35), { [date]: { "2": ["not started"] } }).filter((d) => d.slot === 2)).toEqual([]);
  });

  it("quiet when the slot started; emails when a miss got no retry, or a start never finished", () => {
    const started: SlotRuns = { [date]: { "2": { attempts: [{ startedAt: at(1).toISOString() }] } } };
    expect(watchSlots(started, at(35)).filter((d) => d.slot === 2)).toEqual([]);
    expect(watchSlots(started, at(95)).find((d) => d.slot === 2)?.alert.kind).toBe("stuck");
    const missed: SlotRuns = { [date]: { "2": { attempts: [{ startedAt: at(1).toISOString(), endedAt: at(20).toISOString(), ok: false, why: "no lead passed both checks today; skipped" }] } } };
    expect(watchSlots(missed, at(50)).filter((d) => d.slot === 2)).toEqual([]);
    const late = watchSlots(missed, at(70)).find((d) => d.slot === 2)!;
    expect(late.alert.kind).toBe("retry not started");
    expect(late.alert.text).toMatch(/no lead passed both checks/);
    const twice: SlotRuns = { [date]: { "2": { attempts: [missed[date]["2"].attempts[0], { startedAt: at(25).toISOString(), endedAt: at(40).toISOString(), ok: false }], alerted: ["missed twice"] } } };
    expect(watchSlots(twice, at(120)).filter((d) => d.slot === 2)).toEqual([]);
  });

  it("the timer starts the watch 35 minutes after each slot, summer and winter", () => {
    for (const d of ["2026-10-27T00:00:00Z", "2026-11-03T00:00:00Z"]) {
      const out: string[] = [];
      for (let m = 0; m < 2880; m++) {
        const when = new Date(Date.parse(d) + m * 60000);
        for (const j of plan(when, {})) if (j.workflow === "slot-watch.yml") out.push(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when));
      }
      expect(out.slice(0, 3).sort(), d).toEqual(["07:55", "12:55", "17:55"]);
    }
    expect(readFileSync(path("timer/wrangler.toml"), "utf8")).toMatch(/"55 \* \* \* \*"/);
  });
});

describe("the alert email", () => {
  it("goes through Resend from the site's domain to ALERT_EMAIL, and never prints the address", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.ALERT_EMAIL = "the-alert-inbox"; // stand-in: no addresses in the repo
    let sent: any;
    const fake: any = async (url: string, init: any) => ((sent = { url, ...init, body: JSON.parse(init.body) }), new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const entry = { attempts: [{ startedAt: iso("2026-10-27T19:21:00Z"), endedAt: iso("2026-10-27T19:40:00Z"), ok: false, why: "no lead passed both checks today; skipped", tried: ["Looked for new scams: 3 leads"] }] };
    const r = await sendAlert(missedTwiceAlert("2026-10-27", 2, entry), fake);
    expect(sent.url).toBe("https://api.resend.com/emails");
    expect(sent.headers.authorization).toBe("Bearer test-key");
    expect(sent.body.from).toBe(`Scam or Not alerts <alerts@${new URL(config().site.baseUrl).hostname}>`);
    expect(sent.body.to).toEqual(["the-alert-inbox"]);
    expect(sent.body.text).not.toMatch(/TEST/);
    expect(r).toEqual({ sent: true, detail: "sent to ALERT_EMAIL, Resend id abc" });
    expect(r.detail).not.toMatch(/@/);
    delete process.env.RESEND_API_KEY;
    expect((await sendAlert(missedTwiceAlert("2026-10-27", 2, entry), fake)).sent).toBe(false);
    delete process.env.ALERT_EMAIL;
  });
});
