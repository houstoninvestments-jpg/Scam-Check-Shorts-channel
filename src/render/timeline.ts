import type { VoiceSegment, Word } from "../voice/index.js";

export const FPS = 30;
export const MAX_SECONDS = 59; // Shorts stay under 60s
export const ASK_LINE = "Real or scam?"; // spoken once, right before the read window
export const READ_WORDS_PER_SECOND = 3;
export const READ_MIN_SECONDS = 4;
export const READ_MAX_SECONDS = 7;
const GAP = 0.25; // breath between lines
const TAIL = 0.6; // hold after the closer, then fade back to the opening frame for a clean loop

export type BeatId = "hook" | "ask" | "read" | "stamp" | "flag1" | "flag2" | "flag3" | "safe" | "closer" | "tail";

export interface Beat {
  id: BeatId;
  from: number; // frame
  to: number; // frame (exclusive)
  audio?: string; // file name inside the render's public dir
  text?: string;
}

export interface Caption {
  from: number;
  to: number;
  text: string;
}

export interface Timeline {
  fps: number;
  total: number; // frames
  beats: Beat[];
  captions: Caption[];
}

const f = (s: number) => Math.round(s * FPS);

/** Silent read window: the message's words at 3 a second, between 4 and 7 seconds. */
export function readSeconds(message: { subject?: string; body: string }): number {
  const words = `${message.subject ?? ""} ${message.body}`.split(/\s+/).filter(Boolean).length;
  return Math.min(READ_MAX_SECONDS, Math.max(READ_MIN_SECONDS, +(words / READ_WORDS_PER_SECOND).toFixed(1)));
}

/** The hook without its own "real or scam?", since the video asks that once, right after the hook. */
export function hookLine(hook: string): string {
  const out = hook
    .replace(/\b(is (it|this) )?real or (a )?scam\b[?.!]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:!?-]+/, "")
    .trim();
  return out || "Read this one closely.";
}

/** Split a spoken line into short caption chunks, timed by real word timings when we have them. */
export function captionChunks(seg: VoiceSegment, startSec: number, maxWords = 4): Caption[] {
  const words: Word[] =
    seg.words && seg.words.length
      ? seg.words
      : (() => {
          // No timings (open-model voice): spread words by their length across the line.
          const ws = seg.text.split(/\s+/).filter(Boolean);
          const weight = ws.map((w) => w.length + 2);
          const totalW = weight.reduce((a, b) => a + b, 0);
          let t = 0;
          return ws.map((w, i) => {
            const d = (weight[i] / totalW) * seg.duration;
            const out = { word: w, start: t, end: t + d };
            t += d;
            return out;
          });
        })();
  const out: Caption[] = [];
  for (let i = 0; i < words.length; ) {
    let j = i + 1;
    // Break early after punctuation so chunks follow the sentence.
    while (j < words.length && j - i < maxWords && !/[.,!?;:]$/.test(words[j - 1].word)) j++;
    const chunk = words.slice(i, j);
    out.push({ from: f(startSec + chunk[0].start), to: f(startSec + chunk.at(-1)!.end), text: chunk.map((w) => w.word).join(" ") });
    i = j;
  }
  // Each chunk stays up until the next begins, so captions never blink off mid-line.
  for (let k = 0; k < out.length - 1; k++) out[k].to = Math.max(out[k].to, out[k + 1].from);
  return out;
}

/**
 * Lay the beats end to end: hook, "Real or scam?", silent read window, stamp, three flags, safe move, closer.
 * Throws if the voice runs long, so the writer gets another try instead of shipping a cut video.
 */
export function buildTimeline(segs: Record<string, VoiceSegment>, audioName: (id: string) => string, readSec = READ_MIN_SECONDS): Timeline {
  const beats: Beat[] = [];
  const captions: Caption[] = [];
  let t = 0.35; // a beat of the clean phone before the hook, matches the loop point
  const spoken = (id: BeatId, minSec = 0) => {
    const s = segs[id];
    const len = Math.max(s.duration, minSec);
    beats.push({ id, from: f(t), to: f(t + len + GAP), audio: audioName(id), text: s.text });
    captions.push(...captionChunks(s, t));
    t += len + GAP;
  };
  spoken("hook");
  if (segs.ask) spoken("ask");
  // No voice, no overlay: the message at full brightness, long enough to read it.
  beats.push({ id: "read", from: f(t), to: f(t + readSec) });
  t += readSec;
  spoken("stamp", 1.4);
  spoken("flag1", 2.4);
  spoken("flag2", 2.4);
  spoken("flag3", 2.4);
  spoken("safe", 2.4);
  spoken("closer", 1.8);
  beats.push({ id: "tail", from: f(t), to: f(t + TAIL) });
  t += TAIL;
  if (t > MAX_SECONDS) throw new Error(`video would run ${t.toFixed(1)}s; limit is ${MAX_SECONDS}s`);
  return { fps: FPS, total: f(t), beats, captions };
}

export const COVER_FADE = 8; // frames for the cover to clear once the hook starts

/**
 * How visible the cover is (0..1). The cover is the thumbnail: phone, scam text, "REAL OR SCAM?", Scam #.
 * Fully on at frame 0, clears as the hook starts, and comes back during the tail
 * so the last frame matches frame 0 and the loop lands on the cover again.
 */
export function coverOpacity(frame: number, beats: Beat[]): number {
  const hook = beats.find((b) => b.id === "hook")!;
  const tail = beats.find((b) => b.id === "tail")!;
  if (frame < hook.from) return 1;
  if (frame < tail.from) return Math.max(0, 1 - (frame - hook.from) / COVER_FADE);
  return Math.min(1, (frame - tail.from) / Math.max(1, tail.to - 2 - tail.from));
}
