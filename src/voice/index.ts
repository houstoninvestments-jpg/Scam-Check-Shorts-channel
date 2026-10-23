import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config.js";
import { env, log, path, readJson, writeJson } from "../lib/util.js";

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface VoiceSegment {
  id: string;
  text: string;
  file: string; // absolute path
  duration: number; // seconds
  words?: Word[]; // exact timings when the provider returns them
}

export interface VoiceResult {
  provider: "elevenlabs" | "kokoro";
  label: string; // shown in the upload disclosure
  segments: VoiceSegment[];
}

export interface Line {
  id: string;
  text: string;
}

/** Turn ElevenLabs character alignment into word timings for captions. */
export function wordsFromAlignment(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): Word[] {
  const out: Word[] = [];
  let cur: Word | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { word: "", start: a.character_start_times_seconds[i], end: a.character_end_times_seconds[i] };
    cur.word += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) out.push(cur);
  return out;
}

// ---------- ElevenLabs (primary; existing Creator plan) ----------

const USAGE_FILE = () => process.env.VOICE_USAGE_FILE || path("data/voice-usage.json");

interface Usage {
  [month: string]: number; // characters sent this month
}

export function creditsLeftThisMonth(now = new Date()): number {
  const month = now.toISOString().slice(0, 7);
  const used = readJson<Usage>(USAGE_FILE(), {})[month] ?? 0;
  return config().voice.monthlyCreditBudget - used;
}

function recordUsage(chars: number, now = new Date()) {
  const u = readJson<Usage>(USAGE_FILE(), {});
  const month = now.toISOString().slice(0, 7);
  u[month] = (u[month] ?? 0) + chars;
  writeJson(USAGE_FILE(), u);
}

async function elevenlabs(lines: Line[], outDir: string, fetchImpl: typeof fetch = fetch): Promise<VoiceResult> {
  const key = env("ELEVENLABS_API_KEY")!;
  const voiceId = config().voice.elevenlabsVoiceId;
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is not set");
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  if (chars > creditsLeftThisMonth()) throw new Error(`voice budget: ${chars} characters needed, ${creditsLeftThisMonth()} left this month`);

  // The account's own meter wins over our local count if it says we are closer to the limit.
  const sub = await fetchImpl("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
  if (sub.ok) {
    const s = (await sub.json()) as { character_count?: number; character_limit?: number };
    if (s.character_limit && s.character_count !== undefined && s.character_limit - s.character_count < chars + 2000)
      throw new Error(`ElevenLabs credits low: ${s.character_limit - s.character_count} left`);
  }

  mkdirSync(outDir, { recursive: true });
  const segments: VoiceSegment[] = [];
  for (const line of lines) {
    const res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: config().voice.elevenlabsModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: config().voice.speed },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { audio_base64: string; alignment: Parameters<typeof wordsFromAlignment>[0] };
    const file = join(outDir, `${line.id}.mp3`);
    writeFileSync(file, Buffer.from(body.audio_base64, "base64"));
    const words = wordsFromAlignment(body.alignment);
    const duration = body.alignment.character_end_times_seconds.at(-1) ?? 0;
    segments.push({ id: line.id, text: line.text, file, duration, words });
  }
  recordUsage(chars);
  return { provider: "elevenlabs", label: "AI voice (ElevenLabs)", segments };
}

// ---------- Kokoro (free fallback, runs offline) ----------

function kokoro(lines: Line[], outDir: string): VoiceResult {
  const models = env("KOKORO_DIR") ?? path("models/kokoro");
  const python = env("KOKORO_PYTHON") ?? "python3";
  const job = join(outDir, "kokoro-job.json");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    job,
    JSON.stringify({
      model: join(models, "kokoro-v1.0.int8.onnx"),
      voices: join(models, "voices-v1.0.bin"),
      voice: config().voice.kokoroVoice,
      speed: config().voice.speed,
      out_dir: outDir,
      lines,
    }),
  );
  const out = execFileSync(python, ["-I", path("src/voice/kokoro_tts.py"), job], { encoding: "utf8", maxBuffer: 1 << 24 });
  const parsed = JSON.parse(out.trim().split("\n").at(-1)!) as { segments: { id: string; file: string; duration: number }[] };
  return {
    provider: "kokoro",
    label: "AI voice (Kokoro open model)",
    segments: parsed.segments.map((s) => ({ ...s, text: lines.find((l) => l.id === s.id)!.text })),
  };
}

/** ElevenLabs when configured; otherwise, or if it fails, the free Kokoro voice so the day still ships. */
export async function synthesize(lines: Line[], outDir: string, opts: { force?: "elevenlabs" | "kokoro" } = {}): Promise<VoiceResult> {
  const want = opts.force ?? (env("ELEVENLABS_API_KEY") ? config().voice.provider : "kokoro");
  if (want === "elevenlabs") {
    try {
      return await elevenlabs(lines, outDir);
    } catch (e) {
      if (config().voice.fallback !== "kokoro") throw e;
      log(`voice: ElevenLabs failed (${String(e).slice(0, 160)}); using Kokoro`);
    }
  }
  return kokoro(lines, outDir);
}
