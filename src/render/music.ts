import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Timeline } from "./timeline.js";

/**
 * A quiet tension bed made entirely in code with ffmpeg (no downloaded or licensed audio, so no
 * copyright claims): a low drone and a steady pulse, shaped to the video's own timing.
 *  - quiet from the start (short fade in so the loop doesn't click)
 *  - builds through the 3-2-1, the pulse speeding up
 *  - cuts to silence just before the SCAM stamp, so the stamp lands on nothing
 *  - comes back softly after the stamp, fades out at the end
 * Its level is set from the voice: about `belowVoiceDb` quieter than the narration.
 * Each video gets its own key, tempo and timbre, seeded by its Scam number: fresh every time, the same on a re-render.
 */

const sec = (frames: number, fps: number) => +(frames / fps).toFixed(3);

/** The ffmpeg expression for the bed's loudness over time (0..1). */
export function musicEnvelope(t: { readFrom: number; readTo: number; stamp: number; total: number }): string {
  const { readFrom: r0, readTo: r1, stamp: s, total: T } = t;
  const bed = 0.35;
  const cutFrom = +(Math.min(s, r1) - 0.15).toFixed(3);
  const backFrom = +(s + 0.6).toFixed(3);
  // Pieces, in order: quiet bed, the build (all the way to the cut), silence over the stamp, the soft return.
  // The countdown ends exactly where the stamp starts, so the build runs to the cut, not to the countdown's end.
  const shape =
    `if(lt(t,${r0}),${bed},` +
    `if(lt(t,${cutFrom}),${bed}+${(1 - bed).toFixed(2)}*min(1,(t-${r0})/${(cutFrom - r0).toFixed(3)}),` +
    `if(lt(t,${backFrom}),0,` +
    `${bed}*min(1,(t-${backFrom})/1.5))))`;
  return `min(1,t/0.4)*max(0,min(1,(${T}-t)/1.5))*${shape}`;
}

/** The musical choices for one video. Picked from a safe tense range, seeded by the Scam number. */
export interface MusicParams {
  key: string; // name of the drone's root note
  root: number; // Hz, low register
  third: number; // ratio of the third drone partial to the root: an open fifth, a tritone or a dark minor tenth
  thirdName: string;
  bpm: number; // pulse speed before the countdown (the countdown runs at 1.6x)
  decay: number; // how fast each pulse dies away (texture: soft thud vs tight tick)
  h2: number; // pulse overtone weights (timbre)
  h3: number;
  lfoHz: number; // drone breathing rate and depth
  lfoDepth: number;
  detune: number; // Hz between the two lowest drone voices (slow beating)
  cutoff: number; // low-pass on the whole bed, Hz
}

const KEYS: [string, number][] = [["G", 49.0], ["G#", 51.91], ["A", 55.0], ["A#", 58.27], ["B", 61.74], ["C", 65.41], ["C#", 69.3], ["D", 73.42]];
const THIRDS: [string, number][] = [["fifth", 3], ["tritone", 2.828], ["minor tenth", 2.378]];

/** Small seeded random generator (mulberry32): the same number always gives the same music. */
function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function musicParams(seed: number): MusicParams {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const span = (lo: number, hi: number, dp = 2) => +(lo + (hi - lo) * r()).toFixed(dp);
  const [key, root] = pick(KEYS);
  const [thirdName, third] = pick(THIRDS);
  return { key, root, third, thirdName, bpm: Math.round(span(66, 82, 0)), decay: span(6, 10, 1), h2: span(0.3, 0.65), h3: span(0.1, 0.3), lfoHz: span(0.15, 0.35), lfoDepth: span(0.1, 0.2), detune: span(0.2, 0.6), cutoff: Math.round(span(1400, 2200, 0)) };
}

/** The sound itself: drone + pulse (faster during the countdown) + a soft noise swell under the build. */
export function musicExpression(t: { readFrom: number; readTo: number; stamp: number; total: number }, m: MusicParams = musicParams(0)): string {
  const { readFrom: r0, readTo: r1 } = t;
  const slow = +(60 / m.bpm).toFixed(3);
  const fast = +(slow / 1.6).toFixed(3);
  const period = `if(lt(t,${r0}),${slow},if(lt(t,${r1}),${fast},${slow}))`;
  const f = (x: number) => x.toFixed(2);
  const drone = `0.30*(sin(2*PI*${f(m.root)}*t)+0.6*sin(2*PI*${f(m.root * 2 + m.detune)}*t)+0.3*sin(2*PI*${f(m.root * m.third)}*t))*(${f(1 - m.lfoDepth)}+${f(m.lfoDepth)}*sin(2*PI*${f(m.lfoHz)}*t))`;
  const p = m.root * 2;
  const pulse = `0.55*(sin(2*PI*${f(p)}*t)+${f(m.h2)}*sin(2*PI*${f(p * 2)}*t)+${f(m.h3)}*sin(2*PI*${f(p * 3)}*t))*exp(-mod(t,${period})*${m.decay})`;
  const swell = `if(between(t,${r0},${r1}),0.12*(random(0)*2-1)*(t-${r0})/${(r1 - r0).toFixed(3)},0)`;
  return `(${drone}+${pulse}+${swell})*(${musicEnvelope(t)})`;
}

/** Integrated loudness (LUFS) of an audio file, measured by ffmpeg's EBU R128 meter. */
export function loudness(file: string, from?: number, to?: number): number {
  const trim = from !== undefined && to !== undefined ? ["-ss", String(from), "-to", String(to)] : [];
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...trim, "-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
  const m = [...(r.stderr ?? "").matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  if (!m) throw new Error(`could not measure loudness of ${file}`);
  return Number(m[1]);
}

/** The narration's loudness: each line measured, combined by length. */
export function voiceLoudness(publicDir: string, timeline: Timeline): number {
  let energy = 0;
  let total = 0;
  for (const b of timeline.beats.filter((x) => x.audio)) {
    const d = (b.to - b.from) / timeline.fps;
    energy += d * 10 ** (loudness(join(publicDir, b.audio!)) / 10);
    total += d;
  }
  return 10 * Math.log10(energy / total);
}

export interface MusicResult {
  file: string;
  voiceLufs: number;
  musicLufs: number; // the bed under the opening lines, after leveling
  belowVoiceDb: number;
  params: MusicParams;
}

/** Write music.wav into the render's public folder, leveled against the voice. */
export function makeMusic(timeline: Timeline, publicDir: string, belowVoiceDb = 20, seed = 0): MusicResult {
  const params = musicParams(seed);
  const fps = timeline.fps;
  const get = (id: string) => timeline.beats.find((b) => b.id === id)!;
  const t = { readFrom: sec(get("read").from, fps), readTo: sec(get("read").to, fps), stamp: sec(get("stamp").from, fps), total: sec(timeline.total, fps) };
  const raw = join(publicDir, "music-raw.wav");
  const out = join(publicDir, "music.wav");
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  // Mono synthesis; the low end is trimmed so phone speakers aren't asked for what they can't play.
  ff(["-f", "lavfi", "-i", `aevalsrc='${musicExpression(t, params)}':s=44100:d=${t.total}`, "-af", `highpass=f=40,lowpass=f=${params.cutoff}`, "-ac", "1", raw]);
  const voice = voiceLoudness(publicDir, timeline);
  // Level from the quiet bed under the opening lines (after the fade in, before the countdown).
  const bedBefore = loudness(raw, 0.5, Math.max(1, t.readFrom));
  const gainDb = voice - belowVoiceDb - bedBefore;
  ff(["-i", raw, "-af", `volume=${gainDb.toFixed(2)}dB`, "-ac", "2", out]);
  const bedAfter = loudness(out, 0.5, Math.max(1, t.readFrom));
  return { file: out, voiceLufs: +voice.toFixed(1), musicLufs: +bedAfter.toFixed(1), belowVoiceDb: +(voice - bedAfter).toFixed(1), params };
}
