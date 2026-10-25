import { join } from "node:path";
import type { Episode, Lead, Script, SkinId } from "../types.js";
import type { ShortProps } from "../../remotion/props.js";
import { config } from "../lib/config.js";
import { loadLedger, saveLedger, upsertEpisode } from "../lib/ledger.js";
import { log, pad3, path, readJson, slugify, today, writeJson } from "../lib/util.js";
import type { LLM } from "../llm/client.js";
import { scout, scoutFromFixtures, updateSourceHealth } from "../scout/index.js";
import { write } from "../writer/index.js";
import { check, mechanicalCheck, sanitizeMessage, spokenLines } from "../checker/index.js";
import { loadHooks, pickHook } from "../learn/hooks.js";
import { chooseCta, chooseSkin, episodeMark, leadMark, sameDayClash, type DayMark } from "./choose.js";
import { costSummary } from "../llm/client.js";
import { elevenlabsOn, synthesize, type VoiceResult } from "../voice/index.js";
import { prepareTimeline, renderShort, probe, assertShort } from "../render/index.js";
import { countdownRed, extractCover, loopSimilarity, readWindowChange } from "../render/cover.js";
import { saveSiteCover, sourceShort } from "../render/covers.js";
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
  slot?: number; // which of the day's posting slots this run is (1-3); manual runs leave it empty
}

export interface RunReport {
  date: string;
  slot?: number;
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
  /** Model cost of this run at list prices, whether or not it posted. */
  cost?: ReturnType<typeof costSummary>;
}

/** Which captures are allowed to back a public video. Anything else is dry-run material only. */
export const PUBLISHABLE_CAPTURES = new Set(["page", "feed"]);

export async function runDaily(opts: RunOptions): Promise<RunReport> {
  const cfg = config();
  const date = today(cfg.cadence.timezone);
  const report: RunReport = { date, slot: opts.slot, dryRun: opts.dryRun, status: "failed", warnings: [], errors: [], steps: [], summary: {} };
  const step = (s: string, ok: boolean, detail: string) => {
    report.steps.push({ step: s, ok, detail });
    log(`${ok ? "ok  " : "FAIL"} ${s}: ${detail}`);
  };
  const work = opts.workDir ?? path("work", date);

  try {
    const ledger = loadLedger();
    // Up to shortsPerDay a day. A ceiling, not a quota: each slot posts only if a new scam passes both checks.
    const todays = ledger.episodes.filter((e) => e.date === date && (e.status === "published" || (opts.dryRun && e.status === "rendered")));
    if (todays.length >= cfg.cadence.shortsPerDay) {
      step("cadence", true, `already ${todays.length} today (most is ${cfg.cadence.shortsPerDay})`);
      report.status = "skipped";
      return report;
    }
    const usedSkins = new Set(todays.map((e) => e.skin));
    const todayMarks = todays.map(episodeMark);

    // 0. While Google keeps uploads locked to private, re-test once a day before spending anything.
    if (!opts.dryRun && ledger.firstUploadCheck?.locked && ledger.firstUploadCheck.checkedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)) {
      step("upload lock", false, "still locked private (already re-tested today)");
      report.status = "skipped";
      report.warnings.push("uploads still locked private by Google (API audit pending); skipped before writing to save cost");
      return report;
    }
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

    // A script that passed both checks earlier today but never made it out (say, a render failure)
    // goes first. Two failed tries and it is dropped, and its number is given back.
    let ep: Episode | undefined;
    const pending = ledger.episodes.find((e) => e.date === date && e.status === "checked");
    if (pending && (pending.renderAttempts ?? 0) >= 2) {
      ledger.episodes = ledger.episodes.filter((e) => e !== pending);
      if (ledger.nextNumber === pending.number + 1) ledger.nextNumber = pending.number;
      ledger.skipped.push({ leadId: pending.leadId, date, reason: "passed the checks but failed to render twice" });
      saveLedger(ledger);
      report.warnings.push(`Scam No. ${pad3(pending.number)} passed the checks but failed to render twice; dropped`);
    } else if (pending) {
      ep = pending;
      step("resume", true, `Scam No. ${pad3(ep.number)} passed both checks earlier today but was not posted; making it now`);
      report.summary.scam = `${ep.script.scamName} | sources: ${ep.sources.map((d) => d.name).join("; ")} | checks: both reviews passed earlier today (resumed)`;
    }
    if (!ep) {
      // 1. Scout
      const found = opts.fixtureSources ? scoutFromFixtures(opts.fixtureSources) : await scout();
      if (!opts.fixtureSources && !opts.dryRun) updateSourceHealth(found.results); // test runs never touch source health
      for (const r of found.results.filter((r) => !r.ok)) report.warnings.push(`source ${r.id} failed: ${r.error}`);
      step("scout", found.leads.length > 0, `${found.leads.length} leads, ${found.dropped.length} dropped as repeats`);
      if (!found.leads.length) {
        // Normal on a thin day: the ceiling is not a quota. Health still flags a long dry spell.
        report.status = "skipped";
        report.warnings.push("no new scam in any source for this slot; skipped");
        return report;
      }

      // 2-3. Write and check, lead by lead, until one passes. Unsure means skip, never escalate.
      const hooks = loadHooks();
      const recentHooks = ledger.episodes.slice(-3).map((e) => e.hookVariant).reverse();
      let chosen: { lead: Lead; script: Script; hookId: string; skin: SkinId; mark: DayMark } | undefined;
      // A lead that failed the checks (or clashed with an earlier video) today is not tried again today.
      const failedToday = new Set(ledger.skipped.filter((s) => s.date === date).map((s) => s.leadId));
      const fresh = found.leads.filter((l) => !failedToday.has(l.id));
      if (fresh.length < found.leads.length) step("same day", true, `${found.leads.length - fresh.length} leads already failed the checks today; not retried`);
      let tried = 0;
      for (const lead of fresh) {
        if (tried >= 6) break;
        // Same-day variety, decided before any model call: a free skin, and a different scam type or brand.
        const skin = opts.skin ?? chooseSkin(lead.channel, ledger.episodes, usedSkins);
        if (!skin) {
          step("same day", true, `${lead.title.slice(0, 60)}: its screen style already ran today; waits for another day`);
          continue;
        }
        const guess = leadMark(lead);
        if (sameDayClash(guess, todayMarks)) {
          step("same day", true, `${lead.title.slice(0, 60)}: same type (${guess.category}${guess.brands.length ? `, ${guess.brands.join("/")}` : ""}) as an earlier video today; waits for another day`);
          continue;
        }
        tried++;
        const hook = pickHook(hooks, recentHooks);
        let script = sanitizeMessage(await write(opts.llm, lead, hook, skin));
        const mark: DayMark = { category: categoryFor(script, lead.title).id, brands: guess.brands };
        if (sameDayClash(mark, todayMarks)) {
          step("same day", true, `${lead.title.slice(0, 60)}: written as ${mark.category}, same as an earlier video today; not checked, waits for another day`);
          // Remembered for today only, so the next slot doesn't pay to write it again. Tomorrow it is fair game.
          ledger.skipped.push({ leadId: lead.id, date, reason: `same type as an earlier video today (${mark.category})` });
          continue;
        }
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
          chosen = { lead, script, hookId: hook.id, skin, mark };
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
      ep = {
        number,
        leadId: lead.id,
        date,
        skin: chosen.skin,
        slot: opts.slot,
        brands: chosen.mark.brands,
        cta: chooseCta(ledger.episodes),
        hookVariant: chosen.hookId,
        script,
        sources: lead.docs.map((d) => ({ url: d.url, name: d.name, capture: d.capture })),
        slug: `${pad3(number)}-${slugify(script.scamName, 60)}`,
        status: "checked",
        category: categoryFor(script, lead.title).id,
      };
      // Saved before voice and render: if those fail, the next slot posts this checked script
      // instead of paying to write and check a new one.
      ep.costUsd = costSummary(opts.llm.calls ?? []).usd; // writing and checking: all the model cost there is
      upsertEpisode(ledger, ep);
      ledger.nextNumber = number + 1;
      saveLedger(ledger);
    }
    ep.renderAttempts = (ep.renderAttempts ?? 0) + 1;
    ep.slot = opts.slot ?? ep.slot;
    upsertEpisode(ledger, ep);
    saveLedger(ledger);
    const number = ep.number;
    const script = ep.script;

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
      sourceName: sourceShort(ep.sources[0]?.name ?? ""),
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

    if (pending === ep) ep.costUsd = +((ep.costUsd ?? 0) + costSummary(opts.llm.calls ?? []).usd).toFixed(4);
    upsertEpisode(ledger, ep);
    ledger.nextNumber = number + 1;
    saveLedger(ledger);
    return report;
  } catch (e) {
    report.errors.push(String((e as Error)?.stack ?? e).slice(0, 1200));
    report.status = "failed";
    return report;
  } finally {
    // Model cost of this run at list prices, posted or not. The history file makes cost per video visible over time.
    report.cost = costSummary(opts.llm.calls ?? []);
    if (opts.llm.mode === "live") {
      report.summary.cost = `$${report.cost.usd.toFixed(2)} for ${report.cost.calls} model calls (${Object.entries(report.cost.byRole).map(([r, v]) => `${r} ${v.calls}x $${v.usd.toFixed(2)}`).join(", ")})`;
      const histFile = path(opts.dryRun ? "data/dry-run/run-costs.json" : "data/run-costs.json");
      const hist = readJson<unknown[]>(histFile, []);
      hist.push({ at: new Date().toISOString(), date, slot: opts.slot ?? null, status: report.status, episode: report.episode ?? null, usd: report.cost.usd, calls: report.cost.calls, inputTokens: report.cost.inputTokens, outputTokens: report.cost.outputTokens, byRole: report.cost.byRole, models: report.cost.models });
      writeJson(histFile, hist);
    }
    writeJson(join(work, "run-report.json"), report);
    writeJson(process.env.LAST_RUN_FILE || path(opts.dryRun ? "data/dry-run/last-run.json" : "data/last-run.json"), report);
  }
}
