import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ShortProps } from "../../remotion/props.js";
import { env, log, path } from "../lib/util.js";
import type { VoiceResult } from "../voice/index.js";
import { buildTimeline, type Timeline } from "./timeline.js";

/** Short synthetic sound effects, made with ffmpeg so no audio files need licensing. */
export function makeSfx(dir: string) {
  mkdirSync(dir, { recursive: true });
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  ff(["-f", "lavfi", "-i", "sine=frequency=1100:duration=0.07", "-af", "afade=t=out:st=0.03:d=0.04", join(dir, "tick.wav")]);
  ff(["-f", "lavfi", "-i", "anoisesrc=d=0.35:c=brown:a=0.9", "-af", "lowpass=f=220,afade=t=out:st=0.05:d=0.3,volume=3", join(dir, "stamp.wav")]);
}

export function prepareTimeline(voice: VoiceResult, publicDir: string): Timeline {
  mkdirSync(publicDir, { recursive: true });
  const segs = Object.fromEntries(voice.segments.map((s) => [s.id, s]));
  const names: Record<string, string> = {};
  for (const s of voice.segments) {
    const name = `vo-${s.id}${extname(s.file)}`;
    copyFileSync(s.file, join(publicDir, name));
    names[s.id] = name;
  }
  makeSfx(publicDir);
  copyFileSync(path("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"), join(publicDir, "inter.woff2"));
  return buildTimeline(segs, (id) => names[id]);
}

function browserExecutable(): string | undefined {
  const fromEnv = env("REMOTION_BROWSER");
  if (fromEnv) return fromEnv;
  const local = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  return existsSync(local) ? local : undefined; // otherwise Remotion fetches its own headless shell
}

// The bundle snapshots its public folder (the day's audio), so keep one bundle per folder.
const bundles = new Map<string, string>();

export async function renderShort(props: ShortProps, publicDir: string, outFile: string): Promise<string> {
  if (!bundles.has(publicDir)) bundles.set(publicDir, await bundle({ entryPoint: path("remotion/index.ts"), publicDir }));
  const bundled = bundles.get(publicDir)!;
  const browser = browserExecutable();
  const composition = await selectComposition({ serveUrl: bundled, id: "ScamShort", inputProps: props, browserExecutable: browser });
  mkdirSync(join(outFile, ".."), { recursive: true });
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outFile,
    inputProps: props,
    browserExecutable: browser,
    crf: 18,
    audioCodec: "aac",
    onProgress: (() => {
      let last = -1;
      return ({ progress }: { progress: number }) => {
        const q = Math.floor(progress * 4);
        if (q !== last) log(`render ${q * 25}%`);
        last = q;
      };
    })(),
  });
  return outFile;
}

export interface VideoProbe {
  width: number;
  height: number;
  seconds: number;
  hasAudio: boolean;
}

export function probe(file: string): VideoProbe {
  const out = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" }),
  );
  const v = out.streams.find((s: any) => s.codec_type === "video");
  return { width: v.width, height: v.height, seconds: +(+out.format.duration).toFixed(2), hasAudio: out.streams.some((s: any) => s.codec_type === "audio") };
}

/** A Short must be vertical, at most 30 seconds here, and carry the voice track. */
export function assertShort(p: VideoProbe) {
  const problems: string[] = [];
  if (p.width !== 1080 || p.height !== 1920) problems.push(`size ${p.width}x${p.height}`);
  if (p.seconds > 30.5) problems.push(`length ${p.seconds}s`);
  if (!p.hasAudio) problems.push("no audio");
  if (problems.length) throw new Error(`render check failed: ${problems.join(", ")}`);
}
