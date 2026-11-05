import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SourceDoc } from "../src/types";
import { path, readJson, sha } from "../src/lib/util";
import { systemPrompt } from "../src/writer/index";
import { pickHook } from "../src/learn/hooks";
import { expectedVerdict } from "../src/checker/index";
import { realLeads } from "../src/scout/library";
import { videoTitle } from "../src/publish/youtube";
import { buildTimeline } from "../src/render/timeline";
import { buildRound } from "../src/site/round";
import { reward } from "../src/learn/index";
import { maskLink } from "../remotion/Marks";
import { fixtureScript } from "./helpers";

let t: string;
beforeEach(() => {
  t = mkdtempSync(join(tmpdir(), "fmt-"));
  process.env.LIBRARY_DIR = mkdtempSync(join(tmpdir(), "lib-"));
  process.env.LEDGER_FILE = join(t, "ledger.json");
  process.env.LAST_RUN_FILE = join(t, "last-run.json");
  process.env.SLOT_RUNS_FILE = join(t, "slot-runs.json");
  writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 40, episodes: [], skipped: [] }));
});

describe("three kinds of video", () => {
  it("punch: frame-one hit, brand the scammers fake; classic: the old calm rules; real: the twist", () => {
    const punch = systemPrompt({ verdict: "scam", opener: "punch" });
    expect(punch).toMatch(/stop a doomscroller/);
    expect(punch).toMatch(/name the company or agency the source says scammers pretend to be/);
    const classic = systemPrompt({ verdict: "scam", opener: "classic" });
    expect(classic).toMatch(/Hook \(spoken while a scam message sits on a phone screen\)/);
    expect(classic).toMatch(/Calm, kind, and direct/);
    expect(classic).toMatch(/use generic names/);
    const real = systemPrompt({ verdict: "real", opener: "punch" });
    expect(real).toMatch(/green REAL stamp/);
    expect(real).toMatch(/Never reveal that it's real/);
    expect(real).not.toMatch(/Pick a scam people can meet/);
  });

  it("openers are picked from their own style", () => {
    const h = readJson<any>(path("data/hooks.json"));
    expect(pickHook(h, [], "classic").style).toBe("classic");
    expect(pickHook(h, [], "real").style).toBe("real");
    expect(pickHook(h, [], "punch").style).toBe("punch");
  });

  it("both reviewers must answer not_scam for the REAL twist, scam otherwise", () => {
    expect(expectedVerdict({ ...fixtureScript(), verdict: "real" })).toBe("not_scam");
    expect(expectedVerdict(fixtureScript())).toBe("scam");
  });

  it("REAL titles keep the number but never call it a scam", () => {
    const ep: any = { number: 41, script: { ...fixtureScript(), title: "Everyone Deletes This Text", verdict: "real" } };
    expect(videoTitle(ep)).toBe("Scam or Not No. 041: Everyone Deletes This Text");
    expect(videoTitle({ ...ep, script: { ...ep.script, verdict: undefined } })).toMatch(/^Scam No\. 041:/);
  });

  it("the punch speaks on frame two; the classic control keeps its beat of still phone", () => {
    const segs: any = Object.fromEntries(["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, { id, text: "x y", file: "", duration: 1 }]));
    expect(buildTimeline(segs, (id) => id, "punch").beats[0].from).toBe(2);
    expect(buildTimeline(segs, (id) => id, "classic").beats[0].from).toBe(11);
  });

  it("fake links show blacked out, like a redacted real one", () => {
    expect(maskLink("Pay now: https://pay-tolls.example/confirm")).toMatch(/^Pay now: https:\/\/█{6,14}\/confirm$/);
    expect(maskLink("no link here")).toBe("no link here");
  });

  it("a REAL twist video joins the safe messages in the website round, never the scams", () => {
    const ep = (n: number, verdict?: "real") => ({ number: n, date: "2026-11-05", status: "published", slug: `${n}`, script: { ...fixtureScript(), verdict }, cta: "none", hookVariant: "x", skin: "imessage", sources: [], leadId: `${n}` }) as any;
    const r = buildRound("2026-11-05", [ep(1), ep(2, "real")], [{ id: "a", sender: "s", body: "b", why: "w" }] as any, "https://x");
    expect(r!.items.filter((i) => i.answer === "scam").every((i) => i.page !== "https://x/scam/2/")).toBe(true);
  });

  it("learning counts the share that didn't swipe away most", () => {
    expect(reward({ averageViewPercentage: 60, holdAt10: 0.8, viewedPct: 30 })).toBeCloseTo(0.6 * 0.3 + 0.25 * 0.6 + 0.15 * 0.8, 4);
    expect(reward({ averageViewPercentage: 60, holdAt10: 0.8 })).toBeCloseTo(0.7, 4);
  });
});

describe("the REAL twist slot", () => {
  const advice = (url: string): SourceDoc => ({ kind: "ftc", name: "FTC Consumer Advice", url, title: "How to spot a fake alert", publishedAt: null, fetchedAt: "2026-11-05T00:00:00Z", capture: "page", text: "If you get an alert, contact the company using a phone number or website you know is real. ".repeat(10) });
  const seed = (docs: SourceDoc[]) => {
    const dir = process.env.LIBRARY_DIR!;
    for (const d of docs) writeFileSync(join(dir, `${sha(d.url)}.json`), JSON.stringify(d));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ refreshedAt: "2026-11-05T00:00:00Z", entries: docs.map((d) => ({ id: sha(d.url), url: d.url, title: d.title, kind: d.kind, name: d.name, fetchedAt: d.fetchedAt, chars: d.text.length })) }));
  };

  it("uses official pages with safe-checking advice, not ones already used for a REAL video", () => {
    seed([advice("https://consumer.ftc.gov/a"), advice("https://consumer.ftc.gov/b")]);
    const ledger: any = { episodes: [{ leadId: `real:${sha("https://consumer.ftc.gov/a")}`, date: "2026-11-01" }], skipped: [] };
    expect(realLeads(ledger, "2026-11-05").map((l) => l.id)).toEqual([`real:${sha("https://consumer.ftc.gov/b")}`]);
  });

  it("tries the twist first, with the REAL rules, and both reviewers must call it safe", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const page = "https://consumer.ftc.gov/alerts";
    seed([advice(page)]);
    const quote = "contact the company using a phone number or website you know is real.";
    const script = { ...fixtureScript(), hook: "Everyone deletes this. Wrong." };
    script.message = { ...script.message, sender: "Card Alerts", body: "Did you make a purchase of $42.10 today? If not, call the number on the back of your card.", hasQr: false, provenance: "recreated", provenanceNote: "A typical safe message built by the channel from FTC guidance.", evidence: [{ quote, url: page }] };
    script.flags = script.flags.map((f: any) => ({ ...f, target: { kind: "text", match: "call the number on the back of your card" }, evidence: { quote, url: page } }));
    script.safeMove = { ...script.safeMove, evidence: { quote, url: page } };
    const systems: string[] = [];
    const llm: any = {
      mode: "fixture",
      roles: [] as string[],
      async json(call: any) {
        this.roles.push(call.role);
        if (call.role.startsWith("writer")) return systems.push(call.system), call.schema.parse(script);
        expect(call.user).toMatch(/CALL: REAL/);
        return call.schema.parse({ verdict: "not_scam", confidence: 0.9, problems: [] });
      },
    };
    process.env.KOKORO_DIR = "/nonexistent"; // stop before voice
    const r = await runDaily({ dryRun: true, llm, fixtureSources: ["ftc-traffic-qr.json"], library: true, real: true, voice: "kokoro", workDir: join(t, "w") });
    expect(r.steps.find((s) => s.step === "real twist")?.ok).toBe(true);
    expect(systems[0]).toMatch(/green REAL stamp/);
    expect(r.summary.scam).toMatch(/both reviews agree: real/);
    const ep = readJson<any>(process.env.LEDGER_FILE!).episodes[0];
    expect(ep.script.verdict).toBe("real");
    expect(ep.leadId).toMatch(/^real:/);
  });

  it("the control slot uses the classic opening until its end date", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const llm: any = { mode: "fixture", calls: [], async json() { throw new Error("stop here"); } };
    const r = await runDaily({ dryRun: true, llm, fixtureSources: ["ftc-traffic-qr.json"], opener: "classic", workDir: join(t, "w2") });
    expect(r.steps.find((s) => s.step === "format")?.detail).toMatch(/classic opening/);
  });
});
