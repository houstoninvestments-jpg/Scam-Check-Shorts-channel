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
  const b = base.timeline.beats.find((x) => x.id === beat)!;
  const files: string[] = [];
  for (const skin of ["imessage", "android", "email", "voicemail", "marketplace", "dm"] as const) {
    const props = { ...base, skin, script: { ...base.script, message: { ...base.script.message, subject: base.script.message.subject || "Action required: unpaid violation" } } };
    const composition = await selectComposition({ serveUrl, id: "ScamShort", inputProps: props, browserExecutable });
    const output = join(workDir, "skins", `${skin}.png`);
    await renderStill({ composition, serveUrl, output, inputProps: props, frame: b.to - 5, browserExecutable, scale: 0.5 });
    files.push(output);
  }
  return files;
}
