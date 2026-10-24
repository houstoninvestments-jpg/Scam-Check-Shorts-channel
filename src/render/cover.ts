import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** YouTube's thumbnail limit is 2 MB. */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/** Save frame 0 (the cover) as a JPEG thumbnail, stepping quality down until it fits the limit. */
export function extractCover(video: string, outJpg: string): { file: string; bytes: number } {
  for (const q of [2, 4, 6, 9, 13]) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-frames:v", "1", "-q:v", String(q), outJpg]);
    const bytes = statSync(outJpg).size;
    if (bytes <= THUMB_MAX_BYTES) return { file: outJpg, bytes };
  }
  throw new Error("cover image stays over 2 MB");
}

/** How alike the first and last frames are (SSIM, 1 = identical). A clean loop scores near 1. */
export function loopSimilarity(video: string): number {
  const dir = mkdtempSync(join(tmpdir(), "loop-"));
  const first = join(dir, "first.png");
  const last = join(dir, "last.png");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-frames:v", "1", first]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-sseof", "-0.1", "-i", video, "-update", "1", last]);
  const r = spawnSync("ffmpeg", ["-i", first, "-i", last, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  const m = r.stderr.match(/All:([0-9.]+)/);
  if (!m) throw new Error("could not measure loop similarity");
  return +m[1];
}

// The phone screen inside the bezel (remotion/ScamShort.tsx: phone at 130,470, 22px bezel).
const SCREEN = "crop=776:986:152:492";

function screenGray(video: string, frame: number): Buffer {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `select=eq(n\\,${frame}),${SCREEN}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error(`could not read frame ${frame}: ${r.stderr?.toString().slice(0, 200)}`);
  return r.stdout as Buffer;
}

/**
 * The read window must show the message exactly as it looked before: no dimming, nothing on top.
 * Compares the phone screen at the start, middle and end of the window with the frame just before it.
 * Returns the largest share of screen pixels that changed (0 means untouched).
 */
export function readWindowChange(video: string, read: { from: number; to: number }): number {
  const before = screenGray(video, Math.max(0, read.from - 1));
  let worst = 0;
  for (const n of [read.from + 2, Math.floor((read.from + read.to) / 2), read.to - 2]) {
    const b = screenGray(video, n);
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - b[i]) > 24) changed++;
    worst = Math.max(worst, changed / before.length);
  }
  return +worst.toFixed(4);
}
