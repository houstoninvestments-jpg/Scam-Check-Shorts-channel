import { join } from "node:path";
import type { ShortProps } from "../../remotion/props.js";
import { spokenLines } from "../checker/index.js";
import { config } from "../lib/config.js";
import { loadLedger } from "../lib/ledger.js";
import { writeJson } from "../lib/util.js";
import { synthesize } from "../voice/index.js";
import { prepareTimeline, renderShort } from "./index.js";
import { sourceShort } from "./covers.js";
import { countdownRed, readWindowChange } from "./cover.js";
import { makeMusic } from "./music.js";

/**
 * Preview: render a saved episode's script again with today's video template.
 * Local file only. Never uploaded, and labeled PREVIEW so it can't pass for the real one.
 */
export async function rerender(number: number, workDir: string, voice?: "elevenlabs" | "kokoro", withMusic = config().music.enabled) {
  const ep = loadLedger().episodes.find((e) => e.number === number);
  if (!ep) throw new Error(`no episode ${number} in the ledger`);
  const ids = ["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"];
  const lines = spokenLines(ep.script).map((text, i) => ({ id: ids[i], text }));
  const v = await synthesize(lines, join(workDir, "audio"), { force: voice });
  const publicDir = join(workDir, "public");
  const timeline = prepareTimeline(v, publicDir);
  const props: ShortProps = {
    number,
    skin: ep.skin,
    cta: ep.cta,
    script: ep.script,
    timeline,
    closer: config().channel.closer,
    voiceLabel: "AI voice",
    sourceName: sourceShort(ep.sources[0]?.name ?? ""),
    testLabel: "PREVIEW",
    music: false,
  };
  const music = withMusic ? makeMusic(timeline, publicDir, config().music.belowVoiceDb, number) : null;
  props.music = !!music;
  const out = join(workDir, `scam-${String(number).padStart(3, "0")}-preview.mp4`);
  writeJson(join(workDir, "props.json"), props);
  await renderShort(props, publicDir, out);
  const read = timeline.beats.find((b) => b.id === "read")!;
  return { file: out, voice: v.label, timeline, music, screenChange: readWindowChange(out, read), countdownRed: countdownRed(out, read, timeline.fps) };
}
