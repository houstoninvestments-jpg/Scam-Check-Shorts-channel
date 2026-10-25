import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimeline, captionChunks, hookLine } from "../src/render/timeline";
import { wordsFromAlignment } from "../src/voice";
import { spokenLines } from "../src/checker";
import { path } from "../src/lib/util";

const seg = (id: string, duration: number, text = "One two three four five six seven.") => ({ id, text, file: `/x/${id}.wav`, duration });
const segs = (d: number) => Object.fromEntries(["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, seg(id, d)]));

describe("timeline", () => {
  it("asks once, then a silent 3-second countdown, all under 45 seconds", () => {
    const t = buildTimeline(segs(2.2), (id) => `vo-${id}.wav`);
    expect(t.beats.map((b) => b.id)).toEqual(["hook", "ask", "read", "stamp", "flag1", "flag2", "flag3", "safe", "closer", "tail"]);
    expect(t.total / t.fps).toBeLessThanOrEqual(45);
    const read = t.beats.find((b) => b.id === "read")!;
    expect(read.to - read.from).toBe(90); // exactly 3 seconds
    expect(read.audio).toBeUndefined(); // no voice while reading
    expect(t.captions.some((c) => c.from < read.to && c.to > read.from)).toBe(false); // no captions either
    for (let i = 1; i < t.beats.length; i++) expect(t.beats[i].from).toBe(t.beats[i - 1].to);
  });

  it("drops the hook's own real-or-scam so the question is asked once", () => {
    expect(hookLine("Real or scam? You get three seconds.")).toBe("You get three seconds.");
    expect(hookLine("Someone you love gets this today. Real or scam?")).toBe("Someone you love gets this today.");
    expect(hookLine("Would you tap this? Decide fast.")).toBe("Would you tap this?");
    expect(hookLine("Would you tap this?")).toBe("Would you tap this?");
    expect(hookLine("Real or scam?")).toBe("Read this one closely.");
  });

  it("never says decide fast: not in any hook pattern, the writer's rules allow it nowhere, and old scripts drop it", () => {
    const hooks = JSON.parse(readFileSync(path("data/hooks.json"), "utf8"));
    for (const v of hooks.variants) expect(v.pattern).not.toMatch(/decide fast/i);
    const ep2 = { hook: "Would you tap this? Decide fast.", stampSay: "Scam.", flags: [{ say: "a" }, { say: "b" }, { say: "c" }], safeMove: { say: "d" } } as any;
    const lines = spokenLines(ep2, "closer");
    expect(lines.join(" ")).not.toMatch(/decide fast/i);
    expect(lines.slice(0, 2)).toEqual(["Would you tap this?", "Real or scam?"]);
  });

  it("refuses a voice track that runs past the limit", () => {
    expect(() => buildTimeline(segs(7), (id) => id)).toThrow(/limit is 45s/);
  });

  it("chunks captions and keeps them on screen between chunks", () => {
    const c = captionChunks(seg("x", 3, "Real or scam? You get three seconds to decide."), 1);
    expect(c.length).toBeGreaterThan(1);
    expect(c[0].text).toBe("Real or scam?");
    for (let i = 0; i < c.length - 1; i++) expect(c[i].to).toBeGreaterThanOrEqual(c[i + 1].from);
    expect(c[0].from).toBe(30);
  });

  it("uses exact word timings when the voice provides them", () => {
    const words = wordsFromAlignment({
      characters: [..."Hi there"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    });
    expect(words).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "there", start: 0.3, end: 0.8 },
    ]);
  });
});

describe("real renders never carry the test label", () => {
  it("sample settings for the template have no test label to fall back on", async () => {
    const { readFileSync } = await import("node:fs");
    const { path } = await import("../src/lib/util");
    expect(JSON.parse(readFileSync(path("remotion/sample-props.json"), "utf8")).testLabel).toBeUndefined();
    expect(readFileSync(path("src/pipeline/daily.ts"), "utf8")).toContain('testLabel: opts.dryRun ? "TEST RENDER" : ""');
  });
});
