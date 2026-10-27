import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SourceDoc } from "../src/types";
import { path, readJson, sha } from "../src/lib/util";
import { skipReason } from "../src/scout/rank";
import { libraryLeads, loadLibraryIndex, refreshLibrary } from "../src/scout/library";
import { sourceShort } from "../src/render/covers";
import { fixtureScript } from "./helpers";

const doc = (title: string, text: string, url = `https://example.gov/${encodeURIComponent(title)}`): SourceDoc => ({ kind: "ftc", name: "FTC Consumer Advice", url, title, publishedAt: null, fetchedAt: "2026-10-27T00:00:00Z", text, capture: "page" });

// Writes a library into a temp folder: index plus one file per page.
function seedLibrary(docs: SourceDoc[]) {
  const dir = mkdtempSync(join(tmpdir(), "lib-"));
  process.env.LIBRARY_DIR = dir;
  for (const d of docs) writeFileSync(join(dir, `${sha(d.url)}.json`), JSON.stringify(d));
  writeFileSync(join(dir, "index.json"), JSON.stringify({ refreshedAt: "2026-10-27T00:00:00Z", entries: docs.map((d) => ({ id: sha(d.url), url: d.url, title: d.title, kind: d.kind, name: d.name, fetchedAt: d.fetchedAt, chars: d.text.length })) }));
  return dir;
}

beforeEach(() => {
  process.env.LIBRARY_DIR = mkdtempSync(join(tmpdir(), "lib-empty-"));
});

describe("the scout skips pages that can't make a video", () => {
  it("case roundups and general safety guides are dropped, real scams are kept", () => {
    expect(skipReason(doc("Attorney General Secures $2 Million Settlement With Fake Charity", "A scam charity settled."))).toBe("case or enforcement news");
    expect(skipReason(doc("Office Files 12 Criminal Cases in Elder Fraud Sweep", "fraud cases"))).toBe("case or enforcement news");
    expect(skipReason(doc("Man Sentenced for Grandparent Scam", "a scam call"))).toBe("case or enforcement news");
    expect(skipReason(doc("Back-to-School Safety Tips for Parents", "scams and phishing emails"))).toBe("general safety guide");
    expect(skipReason(doc("Scammers send fake toll texts", "The text message says you owe an unpaid toll and links to a fake site."))).toBeUndefined();
    expect(skipReason(doc("Investment fraud is on the rise", "Fraudsters promise big returns and guaranteed profits."))).toBe("no message to show");
  });

  it("names the new official sources on screen", () => {
    expect(sourceShort("FBI Internet Crime Complaint Center (IC3)")).toMatch(/FBI/);
    expect(sourceShort("U.S. Postal Inspection Service")).toMatch(/Postal Inspection/);
    expect(sourceShort("Social Security Administration")).toMatch(/Social Security/);
  });
});

describe("evergreen library", () => {
  const text = (s: string) => `${s} The scam text message says to click a link right away. `.repeat(12);

  it("offers only scams not already on the channel and not failed in the last 30 days", () => {
    const toll = doc("Unpaid toll text scam", text("Scammers send texts about an unpaid toll."));
    const gift = doc("Gift card payment scam", text("A caller demands payment with gift cards."));
    const job = doc("Fake job offer text scam", text("A text offers a remote job paying big for little work."));
    const tech = doc("Tech support pop-up scam", text("A pop-up warns your computer is infected and lists a number to call."));
    seedLibrary([toll, gift, job, tech]);
    const onChannel = { number: 1, leadId: "x", date: "2026-10-01", skin: "imessage", cta: "none", hookVariant: "a", script: { ...fixtureScript(), scamName: "Unpaid toll text scam" }, sources: [toll], slug: "1", status: "published" };
    const ledger: any = {
      nextNumber: 2,
      episodes: [onChannel],
      skipped: [
        { leadId: sha(gift.url), date: "2026-10-20", reason: "unsure" }, // 7 days ago: still resting
        { leadId: sha(job.url), date: "2026-09-01", reason: "unsure" }, // 56 days ago: fair game again
      ],
    };
    const ids = libraryLeads(ledger, "2026-10-27", 0.6).map((l) => l.id);
    expect(ids).not.toContain(sha(toll.url));
    expect(ids).not.toContain(sha(gift.url));
    expect(ids.sort()).toEqual([sha(job.url), sha(tech.url)].sort());
    // Same day, same order; leads carry the whole page for the word-for-word quote check.
    expect(libraryLeads(ledger, "2026-10-27", 0.6).map((l) => l.id)).toEqual(libraryLeads(ledger, "2026-10-27", 0.6).map((l) => l.id));
    expect(libraryLeads(ledger, "2026-10-27", 0.6)[0].docs[0].text.length).toBeGreaterThan(500);
  });

  it("refresh keeps scam pages, skips blocked and non-scam pages, and stores each page whole", async () => {
    const cfg = readJson<any>(path("config/library.json"));
    const scamUrl = cfg.pages[0].url;
    const blockedUrl = cfg.pages[1].url;
    const guideUrl = cfg.pages[2].url;
    const get = async (url: string) => {
      if (url === scamUrl) return `<html><body><h1>Toll text scam</h1><article><p>${text("Scammers send texts about an unpaid toll.")}</p></article></body></html>`;
      if (url === guideUrl) return `<html><body><h1>Back-to-school safety tips</h1><article><p>${text("Stay safe.")}</p></article></body></html>`;
      if (url === blockedUrl) throw new Error("HTTP 403 for " + url);
      throw new Error("HTTP 404 for " + url);
    };
    const out = await refreshLibrary(get, { now: new Date("2026-10-27T12:00:00Z") });
    expect(out.refreshed).toBe(true);
    const idx = loadLibraryIndex();
    expect(idx.entries.map((e) => e.url)).toEqual([scamUrl]);
    expect(readJson<SourceDoc>(join(process.env.LIBRARY_DIR!, `${sha(scamUrl)}.json`)).text).toMatch(/unpaid toll/);
    expect(out.notes.join(" ")).toMatch(/blocked \(403\), skipped/);
    expect(out.notes.join(" ")).toMatch(/general safety guide/);
    // Under 60 pages: the next run tries again instead of calling it fresh.
    expect((await refreshLibrary(get, { now: new Date("2026-10-28T12:00:00Z") })).refreshed).toBe(true);
  });

  it("falls back to the library when fresh leads fail, and the library lead still needs both reviews", async () => {
    const { runDaily } = await import("../src/pipeline/daily");
    const t = mkdtempSync(join(tmpdir(), "fb-"));
    process.env.LEDGER_FILE = join(t, "ledger.json");
    process.env.LAST_RUN_FILE = join(t, "last-run.json");
    writeFileSync(process.env.LEDGER_FILE, JSON.stringify({ nextNumber: 5, episodes: [], skipped: [] }));
    // The library holds the same FTC page under another address, so the canned script's quotes match it.
    const ftc = readJson<SourceDoc>(path("fixtures/sources/ftc-traffic-qr.json"));
    const copy = "https://consumer.ftc.gov/library-copy";
    seedLibrary([{ ...ftc, url: copy }]);
    let writes = 0;
    let reviews = 0;
    const llm: any = {
      mode: "fixture",
      roles: [] as string[],
      async json(call: any) {
        this.roles.push(call.role);
        // Second script is written from the library page, so its quotes point at that page.
        if (call.role.startsWith("writer")) return call.schema.parse(JSON.parse(JSON.stringify(fixtureScript()).split(ftc.url).join(writes++ ? copy : ftc.url)));
        reviews++;
        // The fresh lead's reviewers are unsure; the library lead's reviewers agree.
        return call.schema.parse(reviews <= 2 ? { verdict: "unsure", confidence: 0.5, problems: [] } : { verdict: "scam", confidence: 0.9, problems: [] });
      },
    };
    process.env.KOKORO_DIR = "/nonexistent"; // stop before voice: no voice engine in tests
    const r = await runDaily({ dryRun: true, llm, fixtureSources: ["ftc-traffic-qr.json"], library: true, voice: "kokoro", workDir: join(t, "work") });
    expect(llm.roles).toEqual(["writer", "checker-a", "checker-b", "writer", "checker-a", "checker-b"]);
    expect(r.steps.find((s) => s.step === "library")?.ok).toBe(true);
    expect(r.steps.filter((s) => s.step === "check").map((s) => s.ok)).toEqual([false, true]);
    expect(r.summary.scam).toMatch(/checks:/);
    const ledger = readJson<any>(process.env.LEDGER_FILE);
    expect(ledger.skipped.map((s: any) => s.leadId)).toHaveLength(1);
  });
});
