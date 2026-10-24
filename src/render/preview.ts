import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { ShortProps } from "../../remotion/props.js";
import { path, readJson } from "../lib/util.js";
import { existsSync } from "node:fs";

/** QA helper: render one still per skin from a finished run's props, at the given beat. */
export async function previewSkins(workDir: string, beat = "flag3") {
  const base = readJson<ShortProps>(join(workDir, "props.json"));
  const publicDir = join(workDir, "public");
  const serveUrl = await bundle({ entryPoint: path("remotion/index.ts"), publicDir });
  const local = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
  const browserExecutable = process.env.REMOTION_BROWSER ?? (existsSync(local) ? local : undefined);
  // "cover" is frame 0 (the thumbnail); "last" is the final frame (must match the cover for a clean loop).
  const frameFor = (): number => {
    if (beat === "cover") return 0;
    if (beat === "last") return base.timeline.total - 1;
    return base.timeline.beats.find((x) => x.id === beat)!.to - 5;
  };
  const files: string[] = [];
  for (const skin of ["imessage", "android", "email", "voicemail", "marketplace", "dm"] as const) {
    const props = { ...base, skin, script: { ...base.script, message: { ...base.script.message, subject: base.script.message.subject || "Action required: unpaid violation" } } };
    const composition = await selectComposition({ serveUrl, id: "ScamShort", inputProps: props, browserExecutable });
    const output = join(workDir, "skins", `${beat}-${skin}.png`);
    await renderStill({ composition, serveUrl, output, inputProps: props, frame: frameFor(), browserExecutable, scale: 0.5 });
    files.push(output);
  }
  return files;
}
