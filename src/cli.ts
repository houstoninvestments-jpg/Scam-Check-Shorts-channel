import { mkdirSync } from "node:fs";
import { AnthropicLLM, FixtureLLM, RecordingLLM } from "./llm/client.js";
import { runDaily } from "./pipeline/daily.js";
import { oauthUploader } from "./publish/youtube.js";
import { env, log, path } from "./lib/util.js";

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
      if (dryRun) {
        // Dry runs keep their own ledger so test numbering never touches the real channel.
        process.env.LEDGER_FILE ??= path("data/dry-run/ledger.json");
        mkdirSync(path("data/dry-run"), { recursive: true });
      }
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
        workDir: dryRun && skin ? path("work", `skin-${skin}`) : undefined,
      });
      log(`result: ${report.status}${report.videoFile ? ` ${report.videoFile}` : ""}`);
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
