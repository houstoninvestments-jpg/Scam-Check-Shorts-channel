import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { plan } from "../timer/worker.js";
import { path } from "../src/lib/util";

const day = (iso: string) => {
  // every minute of a UTC day, collect the jobs
  const out: { at: string; repo: string; inputs: Record<string, string> }[] = [];
  const start = Date.parse(iso);
  for (let m = 0; m < 1440; m++) for (const j of plan(new Date(start + m * 60000), { CONGRESS_ENABLED: "true" })) out.push({ at: new Date(start + m * 60000).toISOString(), ...j });
  return out;
};

describe("Cloudflare timer", () => {
  it("starts Scam or Not at 7:20, 12:20 and 5:20 Pacific, in summer and in winter", () => {
    for (const d of ["2026-10-25", "2026-11-03", "2026-03-10", "2026-11-01"]) {
      // A Pacific day runs from 07:00/08:00 UTC to the next; check slots by their Pacific date
      const jobs = [...day(`${d}T00:00:00Z`), ...day(`${new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)}T00:00:00Z`)].filter((j) => j.repo.endsWith("Scam-Check-Shorts-channel") && j.inputs.slot_date === d);
      expect(jobs.map((j) => j.inputs.slot), d).toEqual(["1", "2", "3"]);
      const clocks = jobs.map((j) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(j.at)));
      expect(clocks, d).toEqual(["07:20", "12:20", "17:20"]);
    }
  });

  it("starts Congress Receipts at its UTC times only when switched on", () => {
    const on = day("2026-10-27T00:00:00Z").filter((j) => j.repo.endsWith("congress-receipts")).map((j) => j.at.slice(11, 16));
    expect(on).toEqual(["02:37", "16:37", "21:37"]);
    expect(plan(new Date("2026-10-27T16:37:00Z"), { CONGRESS_ENABLED: "false" })).toEqual([]);
    expect(readFileSync(path("timer/wrangler.toml"), "utf8")).toMatch(/CONGRESS_ENABLED = "false"/);
  });
});
