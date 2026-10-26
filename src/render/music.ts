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

/** The sound itself: drone + pulse (faster during the countdown) + a soft noise swell under the build. */
export function musicExpression(t: { readFrom: number; readTo: number; stamp: number; total: number }): string {
  const { readFrom: r0, readTo: r1 } = t;
  const period = `if(lt(t,${r0}),0.8,if(lt(t,${r1}),0.5,0.8))`;
  const drone = `0.30*(sin(2*PI*55*t)+0.6*sin(2*PI*110.4*t)+0.3*sin(2*PI*164.8*t))*(0.85+0.15*sin(2*PI*0.25*t))`;
  const pulse = `0.55*(sin(2*PI*110*t)+0.5*sin(2*PI*220*t)+0.2*sin(2*PI*330*t))*exp(-mod(t,${period})*8)`;
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
}

/** Write music.wav into the render's public folder, leveled against the voice. */
export function makeMusic(timeline: Timeline, publicDir: string, belowVoiceDb = 20): MusicResult {
  const fps = timeline.fps;
  const get = (id: string) => timeline.beats.find((b) => b.id === id)!;
  const t = { readFrom: sec(get("read").from, fps), readTo: sec(get("read").to, fps), stamp: sec(get("stamp").from, fps), total: sec(timeline.total, fps) };
  const raw = join(publicDir, "music-raw.wav");
  const out = join(publicDir, "music.wav");
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  // Mono synthesis; the low end is trimmed so phone speakers aren't asked for what they can't play.
  ff(["-f", "lavfi", "-i", `aevalsrc='${musicExpression(t)}':s=44100:d=${t.total}`, "-af", "highpass=f=45,lowpass=f=1800", "-ac", "1", raw]);
  const voice = voiceLoudness(publicDir, timeline);
  // Level from the quiet bed under the opening lines (after the fade in, before the countdown).
  const bedBefore = loudness(raw, 0.5, Math.max(1, t.readFrom));
  const gainDb = voice - belowVoiceDb - bedBefore;
  ff(["-i", raw, "-af", `volume=${gainDb.toFixed(2)}dB`, "-ac", "2", out]);
  const bedAfter = loudness(out, 0.5, Math.max(1, t.readFrom));
  return { file: out, voiceLufs: +voice.toFixed(1), musicLufs: +bedAfter.toFixed(1), belowVoiceDb: +(voice - bedAfter).toFixed(1) };
}
