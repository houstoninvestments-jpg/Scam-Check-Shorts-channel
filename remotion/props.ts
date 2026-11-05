import type { Script, SkinId, CtaState } from "../src/types.js";
import type { Timeline } from "../src/render/timeline.js";

export interface ShortProps {
  number: number;
  skin: SkinId;
  cta: CtaState;
  script: Script;
  timeline: Timeline;
  closer: string;
  voiceLabel: string; // on-screen AI voice disclosure
  sourceName: string; // "FTC" etc. for the recreated-from note
  testLabel: string; // "TEST RENDER" on dry runs, "" on real renders (always set: absent falls back to sample props)
  music: boolean; // play music.wav (the code-made tension bed) under the voice; always set
  opener?: "punch" | "classic"; // punch: giant words, hit, zoom from frame one. classic: the old calm opening (control slot)
  verdict?: "scam" | "real"; // real: the twist video, green REAL stamp and safe signs
  [key: string]: unknown;
}
