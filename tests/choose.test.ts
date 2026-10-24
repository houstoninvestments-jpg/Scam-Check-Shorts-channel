import { describe, expect, it } from "vitest";
import { chooseCta, chooseSkin } from "../src/pipeline/choose";
import { pickHook, recordReward } from "../src/learn/hooks";
import { reward, summarize } from "../src/learn";

describe("call-to-action spread", () => {
  it("spreads none, soft and direct evenly", () => {
    const past: any[] = [];
    for (let i = 0; i < 30; i++) past.push({ cta: chooseCta(past), skin: "imessage" });
    const n = (s: string) => past.filter((e) => e.cta === s).length;
    expect([n("none"), n("soft"), n("direct")]).toEqual([10, 10, 10]);
    for (let i = 1; i < past.length; i++) expect(past[i].cta).not.toBe(past[i - 1].cta);
  });
});

describe("skins", () => {
  it("matches the screen to how the scam arrives and alternates phone styles", () => {
    expect(chooseSkin("email", [])).toBe("email");
    expect(chooseSkin("voicemail", [])).toBe("voicemail");
    expect(chooseSkin("text", [{ skin: "imessage" }] as any)).toBe("android");
    expect(chooseSkin("text", [{ skin: "android" }] as any)).toBe("imessage");
  });
});

describe("hook learning", () => {
  const h = () => ({ variants: [{ id: "a", pattern: "A" }, { id: "b", pattern: "B" }, { id: "c", pattern: "C" }], stats: {} as any });
  it("tries every hook before favoring one", () => {
    const f = h();
    recordReward(f, "a", 0.9);
    expect(["b", "c"]).toContain(pickHook(f).id);
  });
  it("favors the hook that holds viewers once all are tested", () => {
    const f = h();
    for (let i = 0; i < 12; i++) {
      recordReward(f, "a", 0.3);
      recordReward(f, "b", 0.8);
      recordReward(f, "c", 0.4);
    }
    expect(pickHook(f).id).toBe("b");
  });
  it("scores retention and summarizes by hook and CTA", () => {
    expect(reward({ averageViewPercentage: 80, holdAt10: 0.9 })).toBeCloseTo(0.85);
    const s = summarize([{ videoId: "v", number: 1, hookVariant: "a", cta: "soft", views: 100, averageViewPercentage: 60, holdAt10: 0.7, scored: true, measuredAt: "" }]);
    expect(s.byHook.a.videos).toBe(1);
    expect(s.byCta.soft.avgWatchPct).toBe(60);
  });
});

describe("YouTube data is kept 30 days at most", () => {
  it("deletes per-video stats older than 30 days and never re-measures a scored video", async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const t = mkdtempSync(join(tmpdir(), "ret-"));
    process.env.METRICS_FILE = join(t, "m.json");
    process.env.SCORED_FILE = join(t, "s.json");
    process.env.LEDGER_FILE = join(t, "l.json");
    process.env.HOOKS_FILE = join(t, "h.json");
    writeFileSync(process.env.HOOKS_FILE, JSON.stringify({ variants: [{ id: "a", pattern: "A" }], stats: {} }));
    writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 2, episodes: [{ number: 1, date: "2026-09-01", status: "published", youtubeId: "old", hookVariant: "a", cta: "none" }], skipped: [] }));
    writeFileSync(process.env.METRICS_FILE, JSON.stringify({ old: { videoId: "old", number: 1, hookVariant: "a", cta: "none", views: 900, averageViewPercentage: 70, holdAt10: 0.8, scored: true, measuredAt: "2026-09-05T00:00:00Z" } }));
    const calls: string[] = [];
    const u: any = { token: async () => "t", fetch: async (url: string) => { calls.push(url); return new Response("{}"); } };
    const { learn } = await import("../src/learn");
    await learn(u, new Date("2026-10-24T00:00:00Z"));
    expect(JSON.parse(readFileSync(process.env.METRICS_FILE, "utf8"))).toEqual({});
    expect(JSON.parse(readFileSync(process.env.SCORED_FILE, "utf8"))).toEqual(["old"]);
    await learn(u, new Date("2026-10-25T00:00:00Z"));
    expect(calls).toEqual([]); // scored once, never fetched again
  });
});
