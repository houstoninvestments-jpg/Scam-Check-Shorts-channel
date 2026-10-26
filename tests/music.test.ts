import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { musicExpression, musicParams } from "../src/render/music";
import { tmp } from "./helpers";

// The bed is synthesized by ffmpeg from a formula; render one and check its shape by measurement.
const mean = (file: string, from: number, to: number) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-to", String(to), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.match(/mean_volume: (-?[\d.]+) dB/)![1]);
};

describe("tension music bed", () => {
  it("is fresh per video but repeatable: seeded by the Scam number, within the tense range", () => {
    expect(musicParams(3)).toEqual(musicParams(3));
    const all = [1, 2, 3, 4, 5, 6, 7, 8].map(musicParams);
    expect(new Set(all.map((m) => `${m.key}-${m.bpm}-${m.thirdName}`)).size).toBeGreaterThan(5);
    for (const m of all) {
      expect(m.root).toBeGreaterThanOrEqual(49);
      expect(m.root).toBeLessThanOrEqual(73.42);
      expect(m.bpm).toBeGreaterThanOrEqual(66);
      expect(m.bpm).toBeLessThanOrEqual(82);
    }
  });

  it.each([3, 4, 11])("keeps the same shape for every seed (%i): quiet, builds, silent on the stamp, returns, fades", (seed) => {
    const t = { readFrom: 4.4, readTo: 7.4, stamp: 7.4, total: 20 };
    const m = musicParams(seed);
    const f = join(tmp(), "m.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc='${musicExpression(t, m)}':s=44100:d=${t.total}`, "-af", `highpass=f=40,lowpass=f=${m.cutoff}`, f]);
    const bed = mean(f, 1, 4);
    const peak = mean(f, 6.8, 7.2);
    expect(peak - bed).toBeGreaterThan(6); // builds
    expect(mean(f, 7.3, 7.95)).toBeLessThan(-80); // silence over the stamp
    expect(Math.abs(mean(f, 11, 15) - bed)).toBeLessThan(3); // soft return to the bed
    expect(mean(f, 19.8, 20)).toBeLessThan(bed - 15); // fades out
  });
});
