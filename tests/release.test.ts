import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLedger } from "../src/lib/ledger";
import { uploadRequest } from "../src/publish/youtube";
import { LABEL_MIN_PIXELS, metadataProblems, yellowPixels } from "../src/publish/release";
import { tmp } from "./helpers";

const ep = loadLedger().episodes[0];
const want = uploadRequest(ep, "AI voice (ElevenLabs)", "private");
const live = (over: any = {}) => ({
  snippet: { ...want.snippet, ...over.snippet },
  status: { privacyStatus: "private", uploadStatus: "processed", containsSyntheticMedia: true, ...over.status },
});

describe("releasing a hidden upload", () => {
  it("passes a copy that matches today's format", () => {
    expect(metadataProblems(live(), want)).toEqual([]);
  });

  it("flags an old title, a changed description and a missing AI flag", () => {
    const p = metadataProblems(live({ snippet: { title: "Scam #001: old", description: want.snippet.description.replace("Safe move", "Tip") }, status: { containsSyntheticMedia: undefined } }), want);
    expect(p.join("\n")).toMatch(/title is/);
    expect(p.join("\n")).toMatch(/description differs from line 3/);
    expect(p.join("\n")).toMatch(/altered-or-synthetic flag is not returned/);
  });

  it("flags a hashtag line that is not the four tags", () => {
    const d = want.snippet.description.split("\n").slice(0, -1).concat("#ScamOrNot #Shorts").join("\n");
    expect(metadataProblems(live({ snippet: { description: d } }), want).join("\n")).toMatch(/hashtag line/);
  });

  it("finds the yellow test label and nothing on a clean frame", () => {
    const dir = tmp();
    const labeled = join(dir, "l.png");
    const clean = join(dir, "c.png");
    // a dark 1080x1920 frame, with and without a label-yellow box in the top row
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x0A0C0F:s=1080x1920", "-vf", "drawbox=x=600:y=90:w=190:h=36:color=0xFFD60A:t=fill", "-frames:v", "1", labeled]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x0A0C0F:s=1080x1920", "-frames:v", "1", clean]);
    expect(yellowPixels(labeled, undefined, { top: 0, bottom: 0.12 })).toBeGreaterThan(LABEL_MIN_PIXELS);
    expect(yellowPixels(clean, undefined, { top: 0, bottom: 0.12 })).toBe(0);
  });
});
