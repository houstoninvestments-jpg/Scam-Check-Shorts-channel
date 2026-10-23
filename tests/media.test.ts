import { describe, expect, it } from "vitest";
import { buildTimeline, captionChunks, MAX_SECONDS } from "../src/render/timeline";
import { wordsFromAlignment } from "../src/voice";

const seg = (id: string, duration: number, text = "One two three four five six seven.") => ({ id, text, file: `/x/${id}.wav`, duration });
const segs = (d: number) => Object.fromEntries(["hook", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, seg(id, d)]));

describe("timeline", () => {
  it("lays out every beat in order inside 30 seconds", () => {
    const t = buildTimeline(segs(2.2), (id) => `vo-${id}.wav`);
    expect(t.beats.map((b) => b.id)).toEqual(["hook", "countdown", "stamp", "flag1", "flag2", "flag3", "safe", "closer", "tail"]);
    expect(t.total / t.fps).toBeLessThanOrEqual(MAX_SECONDS);
    const cd = t.beats.find((b) => b.id === "countdown")!;
    expect(cd.to - cd.from).toBe(90);
    for (let i = 1; i < t.beats.length; i++) expect(t.beats[i].from).toBe(t.beats[i - 1].to);
  });

  it("refuses a voice track that runs past 30 seconds", () => {
    expect(() => buildTimeline(segs(4), (id) => id)).toThrow(/limit is 30s/);
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
