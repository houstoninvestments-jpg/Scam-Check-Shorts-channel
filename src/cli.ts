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
      const r = buildSite({ dryRun: preview, dir: preview ? path("work/site-preview") : undefined, fireDrillDir: preview ? path("work/firedrill-preview") : undefined });
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
