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
