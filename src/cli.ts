import { mkdirSync } from "node:fs";
import { AnthropicLLM, FixtureLLM, RecordingLLM } from "./llm/client.js";
import { runDaily } from "./pipeline/daily.js";
import { oauthUploader } from "./publish/youtube.js";
import { env, log, path } from "./lib/util.js";
import { config } from "./lib/config.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (f: string) => rest.includes(f);
const arg = (f: string) => {
  const i = rest.indexOf(f);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  switch (cmd) {
    case "daily": {
      const dryRun = flag("--dry-run");
      const skin = arg("--skin") as import("./types.js").SkinId | undefined;
      if (dryRun && skin) {
        // Skin test renders: own folder and a fresh ledger so each starts clean.
        process.env.LEDGER_FILE ??= path("work", `skin-${skin}`, "ledger.json");
        if (arg("--number")) {
          const { writeJson } = await import("./lib/util.js");
          writeJson(process.env.LEDGER_FILE, { nextNumber: Number(arg("--number")), episodes: [], skipped: [] });
        }
      }
      if (dryRun && flag("--live-scout") && !process.env.LEDGER_FILE) {
        // Live-source test runs start each day from a copy of the real ledger, so repeats are judged
        // against what the channel really posted and numbering continues from it. Never written back.
        const { existsSync, copyFileSync, readFileSync } = await import("node:fs");
        const { today } = await import("./lib/util.js");
        const copy = path("data/dry-run/live-ledger.json");
        const day = (await import("./lib/config.js")).config().cadence.timezone;
        const stamp = path("data/dry-run/live-ledger.day");
        mkdirSync(path("data/dry-run"), { recursive: true });
        if (!existsSync(copy) || !existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== today(day)) {
          copyFileSync(path("data/ledger.json"), copy);
          (await import("node:fs")).writeFileSync(stamp, today(day));
        }
        process.env.LEDGER_FILE = copy;
      }
      if (dryRun) {
        // Dry runs keep their own ledger so test numbering never touches the real channel.
        process.env.LEDGER_FILE ??= path("data/dry-run/ledger.json");
        mkdirSync(path("data/dry-run"), { recursive: true });
      }
      const slot = arg("--slot") ? Number(arg("--slot")) : undefined;
      const scenario = arg("--scenario") ?? "traffic-qr";
      const live = !dryRun || flag("--live-llm");
      const llm = live ? (env("RECORD_FIXTURES") ? new RecordingLLM(new AnthropicLLM(), scenario) : new AnthropicLLM()) : new FixtureLLM(scenario);
      const report = await runDaily({
        dryRun,
        llm,
        fixtureSources: dryRun && !flag("--live-scout") ? (arg("--sources") ?? "ftc-traffic-qr.json").split(",") : undefined,
        uploader: dryRun ? undefined : oauthUploader(),
        voice: (arg("--voice") as "elevenlabs" | "kokoro" | undefined) ?? undefined,
        skin: dryRun ? skin : undefined,
        slot,
        slotDate: arg("--slot-date"),
        workDir: dryRun && skin ? path("work", `skin-${skin}`) : slot ? path("work", `${(await import("./lib/util.js")).today(config().cadence.timezone)}-slot${slot}`) : undefined,
      });
      log(`result: ${report.status}${report.videoFile ? ` ${report.videoFile}` : ""}`);
      if (process.env.GITHUB_ACTIONS) {
        // Run notes readable through the Actions API (raw logs are not always reachable).
        const clean = (v: string) => v.replace(/[\r\n]+/g, " ").slice(0, 900);
        console.log(`::notice title=Run result::${report.status}${report.errors[0] ? ` | ${clean(report.errors[0])}` : ""}${report.warnings.length ? ` | warnings: ${clean(report.warnings.join("; "))}` : ""}`);
        for (const [k, v] of Object.entries(report.summary)) console.log(`::notice title=${k}::${clean(v)}`);
      }
      if (report.status === "failed") {
        console.error(report.errors.join("\n"));
        process.exitCode = 1;
      }
      break;
    }
    case "scout": {
      const { scout } = await import("./scout/index.js");
      const { updateSourceHealth } = await import("./scout/index.js");
      const out = await scout();
      updateSourceHealth(out.results);
      for (const l of out.leads.slice(0, 10)) console.log(l.score.toFixed(3), l.channel, l.title, l.docs[0].url);
      break;
    }
    case "site": {
      // --test-preview builds from the dry-run ledger, for local checks only. Never deploy that output.
      const preview = flag("--test-preview");
      if (preview) process.env.LEDGER_FILE ??= path("data/dry-run/ledger.json");
      const { buildSite } = await import("./site/build.js");
      const r = await buildSite({ dryRun: preview, dir: preview ? path("work/site-preview") : undefined, fireDrillDir: preview ? path("work/firedrill-preview") : undefined });
      log(`site: ${r.pages.length} pages in ${r.dir}`);
      break;
    }
    case "learn": {
      // Once a day, whichever slot gets here first: retention data only changes daily.
      const { readJson } = await import("./lib/util.js");
      const last = readJson<{ updatedAt?: string }>(process.env.LEARN_REPORT_FILE || path("data/learn-report.json"), {}).updatedAt;
      if (last && last.slice(0, 10) === new Date().toISOString().slice(0, 10) && !flag("--force")) {
        log("learn: already ran today");
        break;
      }
      const { learn } = await import("./learn/index.js");
      await learn(oauthUploader());
      break;
    }
    case "health": {
      const { health } = await import("./health/index.js");
      process.exitCode = await health();
      break;
    }
    case "preview-skins": {
      const { previewSkins } = await import("./render/preview.js");
      console.log(await previewSkins(arg("--work") ?? path("work", (await import("./lib/util.js")).today()), arg("--beat") ?? "flag3"));
      break;
    }
    case "cards-preview": {
      // QA helper: share cards for the dry-run scam plus the site-wide default.
      const { renderScamCard, renderDefaultCard } = await import("./site/cards.js");
      const { readJson } = await import("./lib/util.js");
      const out = arg("--out") ?? path("work/cards");
      const s = readJson<any>(path("fixtures/llm/traffic-qr/writer.json")).output;
      console.log(await renderScamCard({ number: 1, script: s }, `${out}/card-scam-001.png`));
      console.log(await renderDefaultCard(`${out}/card-default.png`));
      break;
    }
    case "metadata-preview": {
      // Prints exactly what would be sent to YouTube for three sample scams of different types.
      const { readJson } = await import("./lib/util.js");
      const { uploadRequest, episodeCategory } = await import("./publish/youtube.js");
      const { tagCharCount } = await import("./publish/tags.js");
      const base = readJson<any>(path("fixtures/llm/traffic-qr/writer.json")).output;
      const { samples } = readJson<any>(path("fixtures/samples/metadata-samples.json"));
      for (const x of samples) {
        const script = x.fromFixture
          ? base
          : { ...base, scamName: x.scamName, title: x.title, description: x.description, safeMove: { ...base.safeMove, say: x.safeMove }, message: { ...base.message, body: x.body, provenanceNote: x.provenanceNote } };
        const ep: any = { number: x.number, slug: `${String(x.number).padStart(3, "0")}-sample`, script, sources: [{ name: "FTC Consumer Alerts", url: "https://consumer.ftc.gov/consumer-alerts" }] };
        const r = uploadRequest(ep, "AI voice (ElevenLabs)");
        console.log(`\n==================== SAMPLE ${x.number} (category: ${episodeCategory(ep).id}) ====================`);
        console.log(`TITLE: ${r.snippet.title}\n`);
        console.log(`DESCRIPTION:\n${r.snippet.description}\n`);
        console.log(`TAGS (${tagCharCount(r.snippet.tags)} of 500 characters): ${r.snippet.tags.join(", ")}`);
      }
      break;
    }
    case "site-target": {
      // Run by the daily job before anything else: decides Cloudflare vs GitHub Pages and the site address.
      const { pickSiteTarget, deployCommand } = await import("./site/target.js");
      const { appendFileSync } = await import("node:fs");
      const t = await pickSiteTarget();
      const project = t.kind === "cloudflare" ? t.project : "";
      log(`site target: ${t.kind} at ${t.baseUrl}${project ? ` (project ${project})` : ""}. Deploy: ${deployCommand(t)}`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${t.kind}\nbase_url=${t.baseUrl}\nproject=${project}\n`);
      if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SITE_BASE_URL=${t.baseUrl}\n`);
      // A run note readable from the Actions API, so the address can be confirmed without downloading logs.
      if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Website address::${t.kind} ${t.baseUrl}${project ? ` (Cloudflare project ${project})` : ""}`);
      break;
    }
    case "site-redirect": {
      const { buildRedirectSite } = await import("./site/target.js");
      console.log(buildRedirectSite(arg("--out") ?? path("site/redirect-dist"), arg("--to")!, arg("--prefix") ?? ""));
      break;
    }
    case "deploy-dry-run": {
      const { deployDryRun } = await import("./site/deploy-dry-run.js");
      await deployDryRun();
      break;
    }
    case "covers-backfill": {
      const { backfillCovers } = await import("./render/covers.js");
      console.log(await backfillCovers());
      break;
    }
    case "channel-info": {
      const { channelInfo, oauthUploader } = await import("./publish/youtube.js");
      const { writeJson } = await import("./lib/util.js");
      const c = await channelInfo(oauthUploader());
      writeJson(path("data/youtube-channel.json"), c);
      if (process.env.GITHUB_ACTIONS) console.log(`::notice title=YouTube channel::${c.title} ${c.handle || c.id}`);
      break;
    }
    case "rerender": {
      // Preview of a saved episode in today's template: --number 2 [--voice kokoro] [--work dir]
      const { rerender } = await import("./render/rerender.js");
      const r = await rerender(Number(arg("--number")), arg("--work") ?? path("work/rerender"), arg("--voice") as "kokoro" | undefined, flag("--music") || undefined);
      const msg = `${r.voice}, ${(r.timeline.total / r.timeline.fps).toFixed(1)}s;${r.music ? ` music on (${r.music.params.key} with a ${r.music.params.thirdName}, ${r.music.params.bpm} BPM, pulse decay ${r.music.params.decay}): voice ${r.music.voiceLufs} LUFS, bed ${r.music.musicLufs} LUFS (${r.music.belowVoiceDb} dB under the voice);` : " no music;"} countdown red px ${r.countdownRed.join("/")}; phone screen changed ${(r.screenChange * 100).toFixed(2)}% during the countdown`;
      console.log(process.env.GITHUB_ACTIONS ? `::notice title=Preview::${msg}` : `${r.file} ${msg}`);
      break;
    }
    case "slot-gate": {
      // Which posting slot a scheduled firing is. Writes go/slot for the workflow; manual runs pass --slot.
      // The Cloudflare timer starts slots on time with --slot and --slot-date; GitHub's own schedule is the backup.
      const { pacificDate, slotFor } = await import("./pipeline/slots.js");
      const { appendFileSync } = await import("node:fs");
      const sched = arg("--schedule") ?? "";
      const bySlot = arg("--slot") ? Number(arg("--slot")) : undefined;
      const r = sched
        ? slotFor(sched)
        : { go: true, slot: bySlot, slotDate: bySlot ? (arg("--slot-date") ?? pacificDate(new Date())) : undefined, why: bySlot ? `slot ${bySlot} started by the timer or by hand` : "started by hand" };
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `go=${r.go}\nslot=${r.slot ?? ""}\nslot_date=${r.slotDate ?? ""}\n`);
      console.log(process.env.GITHUB_ACTIONS ? `::notice title=Slot::${r.why}` : JSON.stringify(r));
      break;
    }
    case "release": {
      // Make a hidden upload public if the copy on YouTube is clean. --number 1 --video <uploaded mp4> [--control <mp4>] [--check-only]
      const { releaseHidden, uploadsOrder } = await import("./publish/release.js");
      const { loadLedger, saveLedger } = await import("./lib/ledger.js");
      const { pad3, writeJson } = await import("./lib/util.js");
      const u = oauthUploader();
      const ledger = loadLedger();
      const n = Number(arg("--number"));
      const r = await releaseHidden(u, ledger, n, { video: arg("--video"), control: arg("--control"), thumbDir: path("work/release-thumbs"), publish: !flag("--check-only") });
      saveLedger(ledger);
      const order = await uploadsOrder(u);
      writeJson(path(`data/releases/${pad3(n)}.json`), { checkedAt: new Date().toISOString(), ...r, uploads: order });
      const say = (title: string, msg: string) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${msg}` : `${title}: ${msg}`);
      say("Metadata before", r.metadataBefore.join("; ") || "matches today's format");
      if (r.metadataBefore.length) say("Metadata after fix", r.metadataAfter.join("; ") || "matches today's format");
      for (const f of [...r.frames, ...(r.control ? [r.control] : [])]) say("Frames", `${f.source}: yellow label pixels ${f.yellow.join(", ")} -> ${f.label ? "TEST LABEL FOUND" : "no label"}`);
      say("Decision", `Scam No. ${pad3(n)} ${r.decision} (YouTube now shows ${r.privacyAfter}): ${r.reason}`);
      say("Uploads list", order.all.map((v: any) => `${v.position}. ${v.title} [${v.privacy}]`).join(" | "));
      say("Shorts list", typeof order.shorts === "string" ? order.shorts : order.shorts.map((v: any) => `${v.position}. ${v.title} [${v.privacy}]`).join(" | ") || "empty");
      break;
    }
    case "evidence": {
      const { captureEvidence } = await import("./site/evidence.js");
      console.log(await captureEvidence(arg("--base")!, arg("--out") ?? path("docs/evidence")));
      break;
    }
    case "stripe-setup": {
      const { stripeSetup } = await import("./site/stripe-setup.js");
      await stripeSetup();
      break;
    }
    default:
      console.log("commands: daily [--dry-run] | scout | site | learn | health | stripe-setup");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
