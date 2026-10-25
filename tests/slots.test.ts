import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cronLines, scheduledInstant, slotFor } from "../src/pipeline/slots";
import { brandsIn, chooseSkin, sameDayClash } from "../src/pipeline/choose";
import { costSummary, usageCost } from "../src/llm/client";
import { path } from "../src/lib/util";
import { fixtureScript } from "./helpers";

const pacificDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);

describe("three daily slots", () => {
  it("the workflow schedules exactly the UTC times the slots need", () => {
    const wf = readFileSync(path(".github/workflows/daily.yml"), "utf8");
    const crons = [...wf.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]);
    expect(crons.sort()).toEqual(cronLines().sort());
  });

  it("each Pacific day gets slots 1, 2 and 3 exactly once, through both clock changes, even if a run starts late", () => {
    // Every UTC day from before the spring change to after the Nov 1 change.
    const byDay = new Map<string, number[]>();
    for (let t = Date.UTC(2026, 2, 5); t <= Date.UTC(2026, 10, 8); t += 86_400_000) {
      for (const cron of cronLines()) {
        const [m, h] = cron.split(" ").map(Number);
        const at = new Date(t + (h * 60 + m) * 60_000);
        for (const late of [2, 95]) {
          // started 2 or 95 minutes after its scheduled time: same answer
          const r = slotFor(cron, new Date(at.getTime() + late * 60_000));
          expect(scheduledInstant(cron, new Date(at.getTime() + late * 60_000)).getTime()).toBe(at.getTime());
          if (r.go && late === 2) byDay.set(pacificDay(at), [...(byDay.get(pacificDay(at)) ?? []), r.slot!]);
        }
      }
    }
    for (const [day, slots] of byDay) {
      if (day < "2026-03-05" || day > "2026-11-07") continue; // edges of the loop
      expect(slots.sort(), day).toEqual([1, 2, 3]);
    }
    expect(byDay.get("2026-11-01")!.sort()).toEqual([1, 2, 3]);
    expect(byDay.get("2026-10-31")!.sort()).toEqual([1, 2, 3]);
  });

  it("names the slot times in Pacific", () => {
    expect(slotFor("20 14 * * *", new Date("2026-10-25T14:25:00Z"))).toMatchObject({ go: true, slot: 1 }); // 7:20am PDT
    expect(slotFor("20 15 * * *", new Date("2026-10-25T15:25:00Z")).go).toBe(false); // 8:20am PDT: the winter twin sits out
    expect(slotFor("20 15 * * *", new Date("2026-11-02T15:25:00Z"))).toMatchObject({ go: true, slot: 1 }); // 7:20am PST
    expect(slotFor("20 1 * * *", new Date("2026-11-03T01:25:00Z"))).toMatchObject({ go: true, slot: 3 }); // 5:20pm PST, Nov 2
  });
});

describe("same-day variety", () => {
  it("never uses a screen style twice in a day", () => {
    expect(chooseSkin("dm", [], new Set(["dm"]))).toBeNull();
    expect(chooseSkin("text", [{ skin: "android" }] as any, new Set(["imessage"]))).toBe("android");
    expect(chooseSkin("text", [], new Set(["imessage", "android"]))).toBeNull();
    expect(chooseSkin("email", [], new Set(["imessage"]))).toBe("email");
  });

  it("allows the same type only with a different brand", () => {
    const today = [{ category: "package", brands: ["usps"] }];
    expect(sameDayClash({ category: "package", brands: ["usps"] }, today)).toBeTruthy();
    expect(sameDayClash({ category: "package", brands: ["fedex"] }, today)).toBeUndefined();
    expect(sameDayClash({ category: "toll", brands: [] }, today)).toBeUndefined();
    expect(sameDayClash({ category: "text", brands: [] }, [{ category: "text", brands: [] }])).toBeTruthy();
    expect(brandsIn("Fake USPS text about a package")).toContain("usps");
  });

  it("stops at the daily ceiling without spending anything", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const { today } = await import("../src/lib/util");
    const { config } = await import("../src/lib/config");
    const t = mkdtempSync(join(tmpdir(), "slots-"));
    process.env.LEDGER_FILE = join(t, "ledger.json");
    process.env.LAST_RUN_FILE = join(t, "last-run.json"); // never touch the real run record
    const date = today(config().cadence.timezone);
    const ep = (n: number, skin: string) => ({ number: n, leadId: `l${n}`, date, skin, cta: "none", hookVariant: "a", script: fixtureScript(), sources: [], slug: `${n}`, status: "published" });
    writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 4, episodes: [ep(1, "imessage"), ep(2, "email"), ep(3, "dm")], skipped: [] }));
    const llm: any = { mode: "fixture", calls: [], async json() { throw new Error("must not be called"); } };
    const r = await runDaily({ dryRun: false, llm, slot: 3, workDir: join(t, "work") });
    expect(r.status).toBe("skipped");
    expect(r.steps[0].detail).toMatch(/already 3 today/);
  });
});

describe("run cost", () => {
  it("prices each call by the model that served it", () => {
    expect(usageCost("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(6);
    expect(usageCost("claude-fable-5-1", { input_tokens: 10_000, output_tokens: 10_000 })).toBeCloseTo(0.6);
    expect(Number.isNaN(usageCost("some-unknown-model", { input_tokens: 1 }))).toBe(true);
    const s = costSummary([
      { role: "writer", model: "claude-fable-5-1", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0.5 },
      { role: "writer-retry", model: "claude-fable-5-1", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0.25 },
      { role: "checker-a", model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0.1 },
    ]);
    expect(s.usd).toBeCloseTo(0.85);
    expect(s.byRole.writer).toEqual({ calls: 2, usd: 0.75 });
  });
});
