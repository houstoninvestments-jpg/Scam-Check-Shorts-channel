import { describe, expect, it } from "vitest";
import { findProblems } from "../src/health";

const now = new Date("2026-10-23T15:00:00Z");
const ledger = (over: any = {}) => ({ nextNumber: 5, episodes: [{ number: 4, date: "2026-10-22", status: "published" }], skipped: [], firstUploadCheck: { locked: false }, ...over }) as any;
const run = (over: any = {}) => ({ date: "2026-10-23", dryRun: false, status: "published", warnings: [], errors: [], steps: [], ...over });

describe("health check", () => {
  it("stays quiet when everything works", () => {
    expect(findProblems({ lastRun: run(), ledger: ledger(), sources: { a: { consecutiveFailures: 0, verified: true } }, now })).toEqual([]);
  });
  it("stays quiet for one source being down a day or two", () => {
    expect(findProblems({ lastRun: run(), ledger: ledger(), sources: { a: { consecutiveFailures: 2, verified: true }, b: { consecutiveFailures: 0, verified: true } }, now })).toEqual([]);
  });
  it("reports a failed run, a voice fallback, a lock, a stall, and dead sources", () => {
    const p = findProblems({
      lastRun: run({ status: "failed", errors: ["Error: YouTube sign-in failed"], warnings: ["ElevenLabs failed; used the free fallback voice"] }),
      ledger: ledger({ episodes: [{ number: 4, date: "2026-10-19", status: "published" }] }),
      sources: { a: { consecutiveFailures: 3, verified: true } },
      now,
    });
    expect(p.join("\n")).toMatch(/failed: Error: YouTube sign-in failed/);
    expect(p.join("\n")).toMatch(/Voice/);
    expect(p.join("\n")).toMatch(/No new Short/);
    expect(p.join("\n")).toMatch(/Every scam source/);
    expect(findProblems({ lastRun: run(), ledger: ledger({ firstUploadCheck: { locked: true } }), sources: {}, now }).join()).toMatch(/locked uploads to private/);
  });
});
