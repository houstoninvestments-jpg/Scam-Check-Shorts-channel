import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { musicExpression } from "../src/render/music";
import { tmp } from "./helpers";

// The bed is synthesized by ffmpeg from a formula; render one and check its shape by measurement.
const mean = (file: string, from: number, to: number) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-to", String(to), "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(r.stderr.match(/mean_volume: (-?[\d.]+) dB/)![1]);
};

describe("tension music bed", () => {
  it("is quiet at first, builds through the countdown, is silent on the stamp, returns, and fades out", () => {
    const t = { readFrom: 4.4, readTo: 7.4, stamp: 7.4, total: 20 };
    const f = join(tmp(), "m.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc='${musicExpression(t)}':s=44100:d=${t.total}`, "-af", "highpass=f=45,lowpass=f=1800", f]);
    const bed = mean(f, 1, 4);
    const peak = mean(f, 6.8, 7.2);
    expect(peak - bed).toBeGreaterThan(6); // builds
    expect(mean(f, 7.3, 7.95)).toBeLessThan(-80); // silence over the stamp
    expect(Math.abs(mean(f, 11, 15) - bed)).toBeLessThan(3); // soft return to the bed
    expect(mean(f, 19.8, 20)).toBeLessThan(bed - 15); // fades out
  });
});
