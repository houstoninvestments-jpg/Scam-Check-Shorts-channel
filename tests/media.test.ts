import { describe, expect, it } from "vitest";
import { buildTimeline, captionChunks, hookLine, readSeconds } from "../src/render/timeline";
import { wordsFromAlignment } from "../src/voice";

const seg = (id: string, duration: number, text = "One two three four five six seven.") => ({ id, text, file: `/x/${id}.wav`, duration });
const segs = (d: number) => Object.fromEntries(["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, seg(id, d)]));

describe("timeline", () => {
  it("asks once, then gives a silent read window, all under 60 seconds", () => {
    const t = buildTimeline(segs(2.2), (id) => `vo-${id}.wav`, 7);
    expect(t.beats.map((b) => b.id)).toEqual(["hook", "ask", "read", "stamp", "flag1", "flag2", "flag3", "safe", "closer", "tail"]);
    expect(t.total / t.fps).toBeLessThan(60);
    const read = t.beats.find((b) => b.id === "read")!;
    expect(read.to - read.from).toBe(210);
    expect(read.audio).toBeUndefined(); // no voice while reading
    expect(t.captions.some((c) => c.from < read.to && c.to > read.from)).toBe(false); // no captions either
    for (let i = 1; i < t.beats.length; i++) expect(t.beats[i].from).toBe(t.beats[i - 1].to);
  });

  it("sizes the read window at 3 words a second, 4 to 7 seconds", () => {
    expect(readSeconds({ body: "Your package is held." })).toBe(4);
    expect(readSeconds({ body: Array(15).fill("word").join(" ") })).toBe(5);
    expect(readSeconds({ subject: "Final notice", body: Array(40).fill("word").join(" ") })).toBe(7);
  });

  it("drops the hook's own real-or-scam so the question is asked once", () => {
    expect(hookLine("Real or scam? You get three seconds.")).toBe("You get three seconds.");
    expect(hookLine("Someone you love gets this today. Real or scam?")).toBe("Someone you love gets this today.");
    expect(hookLine("Would you tap this? Decide fast.")).toBe("Would you tap this? Decide fast.");
    expect(hookLine("Real or scam?")).toBe("Read this one closely.");
  });

  it("refuses a voice track that runs past the limit", () => {
    expect(() => buildTimeline(segs(6.5), (id) => id, 7)).toThrow(/limit is 59s/);
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
