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
  testLabel?: string; // shown on dry-run renders so a test file can never pass as real
  [key: string]: unknown;
}
