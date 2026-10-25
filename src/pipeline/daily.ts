import { join } from "node:path";
import type { Episode, Lead, Script, SkinId } from "../types.js";
import type { ShortProps } from "../../remotion/props.js";
import { config } from "../lib/config.js";
import { loadLedger, saveLedger, upsertEpisode } from "../lib/ledger.js";
import { log, pad3, path, slugify, today, writeJson } from "../lib/util.js";
import type { LLM } from "../llm/client.js";
import { scout, scoutFromFixtures, updateSourceHealth } from "../scout/index.js";
import { write } from "../writer/index.js";
import { check, mechanicalCheck, sanitizeMessage, spokenLines } from "../checker/index.js";
import { loadHooks, pickHook } from "../learn/hooks.js";
import { chooseCta, chooseSkin } from "./choose.js";
import { elevenlabsOn, synthesize, type VoiceResult } from "../voice/index.js";
import { prepareTimeline, renderShort, probe, assertShort } from "../render/index.js";
import { countdownRed, extractCover, loopSimilarity, readWindowChange } from "../render/cover.js";
import { saveSiteCover } from "../render/covers.js";
import { categoryFor } from "../publish/tags.js";
import { uploadRequest, publishShort, recheckLock, type Uploader } from "../publish/youtube.js";

export interface RunOptions {
  dryRun: boolean;
  llm: LLM;
  fixtureSources?: string[]; // dry-run: saved source captures instead of the live scout
  uploader?: Uploader; // live: YouTube client
  voice?: "elevenlabs" | "kokoro";
  workDir?: string;
  skin?: SkinId; // test renders only: force a phone skin
}

export interface RunReport {
  date: string;
  dryRun: boolean;
  status: "published" | "rendered" | "skipped" | "failed";
  episode?: number;
  videoFile?: string;
  youtubeId?: string;
  warnings: string[];
  errors: string[];
  steps: { step: string; ok: boolean; detail: string }[];
  /** One line per thing a person would check, posted as notes on the GitHub run. */
  summary: Record<string, string>;
}

const SOURCE_SHORT: Record<string, string> = { ftc: "FTC", bbb: "BBB", ag: "state attorney general", reddit: "community" };

/** Which captures are allowed to back a public video. Anything else is dry-run material only. */
export const PUBLISHABLE_CAPTURES = new Set(["page", "feed"]);

export async function runDaily(opts: RunOptions): Promise<RunReport> {
  const cfg = config();
  const date = today(cfg.cadence.timezone);
  const report: RunReport = { date, dryRun: opts.dryRun, status: "failed", warnings: [], errors: [], steps: [], summary: {} };
  const step = (s: string, ok: boolean, detail: string) => {
    report.steps.push({ step: s, ok, detail });
    log(`${ok ? "ok  " : "FAIL"} ${s}: ${detail}`);
  };
  const work = opts.workDir ?? path("work", date);

  try {
    const ledger = loadLedger();
    if (!opts.dryRun && ledger.episodes.some((e) => e.date === date && e.status === "published")) {
      step("cadence", true, "already published today");
      report.status = "skipped";
      return report;
    }

    // 0. While Google keeps uploads locked to private, re-test once a day before spending anything.
    if (!opts.dryRun && ledger.firstUploadCheck?.locked && opts.uploader) {
      const lock = await recheckLock(opts.uploader, ledger);
      saveLedger(ledger);
      step("upload lock", !lock.locked, lock.locked ? `still locked private: ${lock.detail}` : `lock lifted: ${lock.detail}`);
      report.summary.upload = lock.locked ? "uploads still locked private by Google; waiting for the API audit" : "lock lifted; uploads go public again";
      if (lock.locked) {
        report.status = "skipped";
        report.warnings.push("uploads still locked private by Google (API audit pending); skipped before writing to save cost");
        return report;
      }
    }

    // 1. Scout
    const found = opts.fixtureSources ? scoutFromFixtures(opts.fixtureSources) : await scout();
    if (!opts.fixtureSources) updateSourceHealth(found.results);
    for (const r of found.results.filter((r) => !r.ok)) report.warnings.push(`source ${r.id} failed: ${r.error}`);
    step("scout", found.leads.length > 0, `${found.leads.length} leads, ${found.dropped.length} dropped as repeats`);
    if (!found.leads.length) throw new Error("no fresh scams found in any source");

    // 2-3. Write and check, lead by lead, until one passes. Unsure means skip, never escalate.
    const hooks = loadHooks();
    const recentHooks = ledger.episodes.slice(-3).map((e) => e.hookVariant).reverse();
    let chosen: { lead: Lead; script: Script; hookId: string } | undefined;
    for (const lead of found.leads.slice(0, 6)) {
      const hook = pickHook(hooks, recentHooks);
      const skin = chooseSkin(lead.channel, ledger.episodes);
      let script = sanitizeMessage(await write(opts.llm, lead, hook, skin));
      let mech = mechanicalCheck(script, lead);
      if (!mech.ok) {
        // one rewrite with the exact failures, then move on
        script = sanitizeMessage(await write(opts.llm, lead, hook, skin, mech.problems));
        mech = mechanicalCheck(script, lead);
      }
      let verdict = await check(opts.llm, script, lead);
      // Both reviews say it IS a scam but list fixable problems: up to two rewrites with those exact
      // problems, each followed by both reviews from scratch. Any doubt that it's a scam = skip.
      for (let round = 1; round <= 2; round++) {
        const fixable = !verdict.pass && verdict.a?.verdict === "scam" && verdict.b?.verdict === "scam";
        if (!fixable) break;
        step("check", false, `${lead.title.slice(0, 60)}: ${verdict.reason} (rewrite ${round} of 2)`);
        const problems = [...(verdict.a?.problems ?? []), ...(verdict.b?.problems ?? [])];
        if ((verdict.a?.confidence ?? 1) < 0.8 || (verdict.b?.confidence ?? 1) < 0.8) problems.push("A reviewer was not confident; make every line plainly backed by its quote.");
        script = sanitizeMessage(await write(opts.llm, lead, hook, skin, problems, script));
        verdict = await check(opts.llm, script, lead);
      }
      step("check", verdict.pass, `${lead.title.slice(0, 60)}: ${verdict.reason}`);
      if (verdict.pass) {
        report.summary.scam = `${script.scamName} | sources: ${lead.docs.map((d) => `${d.name} ${d.publishedAt?.slice(0, 10) ?? ""} (${d.capture})`).join("; ")} | checks: ${verdict.reason}`;
        chosen = { lead, script, hookId: hook.id };
        break;
      }
      ledger.skipped.push({ leadId: lead.id, date, reason: verdict.reason });
    }
    if (!chosen) {
      saveLedger(ledger);
      report.status = "skipped";
      report.warnings.push("no lead passed both checks today; skipped");
      return report;
    }

    const number = ledger.nextNumber;
    const { lead, script } = chosen;
    const ep: Episode = {
      number,
      leadId: lead.id,
      date,
      skin: opts.skin ?? chooseSkin(lead.channel, ledger.episodes),
      cta: chooseCta(ledger.episodes),
      hookVariant: chosen.hookId,
      script,
      sources: lead.docs.map((d) => ({ url: d.url, name: d.name, capture: d.capture })),
      slug: `${pad3(number)}-${slugify(script.scamName, 60)}`,
      status: "checked",
      category: categoryFor(script, lead.title).id,
    };

    // 4. Voice and render
    const lines = spokenLines(script).map((text, i) => ({ id: ["hook", "ask", "stamp", "flag1", "flag2", "flag3", "safe", "closer"][i], text }));
    const audioDir = join(work, "audio");
    const publicDir = join(work, "public");
    let voice: VoiceResult = await synthesize(lines, audioDir, { force: opts.voice });
    if (voice.provider === "kokoro" && !opts.voice && elevenlabsOn() && process.env.ELEVENLABS_API_KEY) report.warnings.push("ElevenLabs failed; used the free fallback voice");
    let timeline;
    try {
      timeline = prepareTimeline(voice, publicDir);
    } catch (e) {
      throw new Error(`timing: ${String(e)}`);
    }
    step("voice", true, `${voice.label}, ${(timeline.total / timeline.fps).toFixed(1)}s`);
    report.summary.voice = `${voice.label}${voice.provider === "elevenlabs" ? ` (voice ID from secret: ${config().voice.elevenlabsVoiceId ? "yes" : "no"})` : `, voice ${config().voice.kokoroVoice} at speed ${config().voice.speed}`}, ${(timeline.total / timeline.fps).toFixed(1)}s`;

    const props: ShortProps = {
      number,
      skin: ep.skin,
      cta: ep.cta,
      script,
      timeline,
      closer: cfg.channel.closer,
      voiceLabel: "AI voice",
      sourceName: SOURCE_SHORT[lead.docs[0].kind] ?? lead.docs[0].name,
      // Always set explicitly: an absent value would fall back to the template's sample settings.
      testLabel: opts.dryRun ? "TEST RENDER" : "",
    };
    writeJson(join(work, "props.json"), props);
    const videoFile = join(work, `scam-${pad3(number)}${opts.dryRun ? "-test" : ""}.mp4`);
    await renderShort(props, publicDir, videoFile);
    const p = probe(videoFile);
    assertShort(p);
    step("render", true, `${videoFile} (${p.width}x${p.height}, ${p.seconds}s)`);

    // The cover (frame 0) doubles as the thumbnail. The last frame must land back on it.
    ep.loopSimilarity = loopSimilarity(videoFile);
    if (ep.loopSimilarity < 0.97) report.warnings.push(`loop: last frame differs from the cover (similarity ${ep.loopSimilarity})`);
    const read = timeline.beats.find((b) => b.id === "read")!;
    const readChange = readWindowChange(videoFile, read);
    const red = countdownRed(videoFile, read, timeline.fps);
    if (readChange > 0.01) report.warnings.push(`countdown: ${(readChange * 100).toFixed(1)}% of the phone screen changed while viewers read`);
    if (red.some((n) => n < 2000)) report.warnings.push(`countdown: the red 3-2-1 is faint or missing (red pixels ${red.join(", ")})`);
    report.summary.countdown = `${((read.to - read.from) / timeline.fps).toFixed(1)}s, red 3-2-1 above the phone (${red.join("/")} red px), phone screen ${readChange > 0.01 ? "CHANGED" : "untouched"}`;
    const cover = extractCover(videoFile, videoFile.replace(/\.mp4$/, "-cover.jpg"));
    step("cover", true, `${cover.file} (${Math.round(cover.bytes / 1024)} KB), loop similarity ${ep.loopSimilarity}`);
    if (!opts.dryRun) saveSiteCover(cover.file, number); // the website's case-file card uses the real cover frame
    ep.status = "rendered";
    ep.voice = voice.label;
    report.videoFile = videoFile;
    report.episode = number;

    // 5. Publish
    const upload = uploadRequest(ep, voice.label);
    writeJson(join(work, "upload-request.json"), upload);
    report.summary.title = upload.snippet.title;
    report.summary.hashtags = upload.snippet.description.trim().split("\n").at(-1)!;
    report.summary.page = `${cfg.site.baseUrl}/scam/${ep.slug}/`;
    const unsafe = ep.sources.filter((s) => !PUBLISHABLE_CAPTURES.has(s.capture));
    if (opts.dryRun) {
      step("publish", true, "dry run: upload request saved, nothing sent to YouTube");
      report.status = "rendered";
    } else if (unsafe.length) {
      throw new Error(`refusing to publish: sources not fully captured (${unsafe.map((s) => s.capture.split(":")[0]).join(", ")})`);
    } else {
      const res = await publishShort(opts.uploader!, ep, videoFile, voice.label, ledger, cover.file);
      if (res.thumbnail) {
        ep.thumbnail = res.thumbnail;
        step("thumbnail", true, res.thumbnail.detail); // logged either way; never fails the upload
      }
      ep.youtubeId = res.videoId;
      ep.youtubePrivacy = res.privacy;
      ep.status = res.lockedPrivate ? "rendered" : "published";
      report.summary.upload = `${res.videoId}, ${res.privacy}${res.lockedPrivate ? ", LOCKED private by Google" : ", not locked"}`;
      report.summary.thumbnail = res.thumbnail ? `${res.thumbnail.ok ? "set" : "refused"}: ${res.thumbnail.detail}` : "not tried";
      report.youtubeId = res.videoId;
      report.status = res.lockedPrivate ? "rendered" : "published";
      if (res.lockedPrivate) report.errors.push("first upload is locked private; audit request prepared in docs/youtube-audit-request.md");
      step("publish", !res.lockedPrivate, res.detail);
    }

    upsertEpisode(ledger, ep);
    ledger.nextNumber = number + 1;
    saveLedger(ledger);
    return report;
  } catch (e) {
    report.errors.push(String((e as Error)?.stack ?? e).slice(0, 1200));
    report.status = "failed";
    return report;
  } finally {
    writeJson(join(work, "run-report.json"), report);
    writeJson(path(opts.dryRun ? "data/dry-run/last-run.json" : "data/last-run.json"), report);
  }
}
