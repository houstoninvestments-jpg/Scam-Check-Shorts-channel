import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { Episode } from "../types.js";
import type { ShortProps } from "../../remotion/props.js";
import { config } from "../lib/config.js";
import { loadLedger } from "../lib/ledger.js";
import { log, pad3, path } from "../lib/util.js";
import { buildTimeline } from "./timeline.js";

/** Small copies of each video's cover frame for the website's case-file cards. Kept in the repo. */
export const coverFile = (n: number) => path("data/covers", `${pad3(n)}.jpg`);

/** Shrink a cover (frame 0 of the video) to a light 540x960 JPEG for the site. */
export function saveSiteCover(srcImage: string, n: number) {
  mkdirSync(path("data/covers"), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", srcImage, "-vf", "scale=540:-2", "-q:v", "5", coverFile(n)]);
  return coverFile(n);
}

export function sourceShort(name: string) {
  if (/ftc/i.test(name)) return "FTC";
  if (/bbb/i.test(name)) return "BBB";
  if (/attorney general/i.test(name)) return "state attorney general";
  return "community";
}

/**
 * For an episode saved before covers were kept, draw frame 0 again from the same video template.
 * Frame 0 is the cover state only (phone, scam text, stamp, number), so it needs no audio.
 */
export async function backfillCovers(episodes: Episode[] = loadLedger().episodes.filter((e) => e.youtubeId)) {
  const missing = episodes.filter((e) => !existsSync(coverFile(e.number)));
  if (!missing.length) return [];
  const publicDir = path("work/cover-backfill");
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"), join(publicDir, "inter.woff2"));
  const serveUrl = await bundle({ entryPoint: path("remotion/index.ts"), publicDir });
  const local = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  const browserExecutable = process.env.REMOTION_BROWSER ?? (existsSync(local) ? local : undefined);
  const segs = Object.fromEntries(["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"].map((id) => [id, { id, text: "", file: "", duration: 2 }]));
  const done: string[] = [];
  for (const e of missing) {
    const props: ShortProps = {
      number: e.number,
      skin: e.skin,
      cta: e.cta,
      script: e.script,
      timeline: buildTimeline(segs, (id) => `vo-${id}.wav`),
      closer: config().channel.closer,
      voiceLabel: "AI voice",
      sourceName: sourceShort(e.sources[0]?.name ?? ""),
      testLabel: "",
    };
    const composition = await selectComposition({ serveUrl, id: "ScamShort", inputProps: props, browserExecutable });
    const png = join(publicDir, `cover-${e.number}.png`);
    await renderStill({ composition, serveUrl, output: png, inputProps: props, frame: 0, browserExecutable });
    done.push(saveSiteCover(png, e.number));
    log(`cover backfilled for Scam No. ${pad3(e.number)}`);
  }
  rmSync(publicDir, { recursive: true, force: true });
  return done;
}
