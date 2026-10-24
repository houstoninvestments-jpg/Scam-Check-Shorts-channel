import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline, coverOpacity, COVER_FADE } from "../src/render/timeline";
import { extractCover, loopSimilarity, THUMB_MAX_BYTES } from "../src/render/cover";
import { tmp } from "./helpers";

const segs = Object.fromEntries(["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, { id, text: "One two three.", file: "", duration: 2 }]));
const t = buildTimeline(segs, (id) => id);
const at = (id: string) => t.beats.find((b) => b.id === id)!;

describe("cover frame timing", () => {
  it("shows the cover on frame 0 and on the last frame, so the loop lands on it", () => {
    expect(coverOpacity(0, t.beats)).toBe(1);
    expect(coverOpacity(t.total - 1, t.beats)).toBe(1);
  });
  it("clears the cover once the hook starts and keeps it off until the tail", () => {
    expect(coverOpacity(at("hook").from + COVER_FADE, t.beats)).toBe(0);
    for (const id of ["ask", "read", "stamp", "flag1", "flag2", "flag3", "safe", "closer"]) expect(coverOpacity(at(id).from + 2, t.beats)).toBe(0);
  });
  it("never shows the cover while the verdict is on screen", () => {
    for (let f = at("stamp").from; f < at("tail").from; f++) expect(coverOpacity(f, t.beats)).toBe(0);
  });
});

/** Tiny videos made with ffmpeg: one holds still (clean loop), one ends on a different picture. */
function video(name: string, filter: string) {
  const f = join(tmp(), name);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", filter, "-t", "1", "-pix_fmt", "yuv420p", f]);
  return f;
}

describe("cover export and loop check", () => {
  it("exports frame 0 as a JPEG under YouTube's 2 MB limit", () => {
    const v = video("still.mp4", "testsrc2=size=1080x1920:rate=30");
    const out = extractCover(v, join(tmp(), "cover.jpg"));
    expect(out.bytes).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    expect(statSync(out.file).size).toBe(out.bytes);
    expect(readFileSync(out.file).subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });
  it("scores a clean loop near 1 and a broken loop low", () => {
    expect(loopSimilarity(video("same.mp4", "color=c=0x223344:size=320x568:rate=30"))).toBeGreaterThan(0.99);
    const broken = video("broken.mp4", "color=c=black:size=320x568:rate=30,drawbox=x=0:y=0:w=320:h=568:color=white:t=fill:enable='gte(t,0.5)'");
    expect(loopSimilarity(broken)).toBeLessThan(0.9);
  });
});
