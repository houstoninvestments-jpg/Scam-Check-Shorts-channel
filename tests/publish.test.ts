import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishShort, uploadRequest, type Uploader } from "../src/publish/youtube";
import { fixtureScript, tmp } from "./helpers";
import { path } from "../src/lib/util";

const ep = () => ({ number: 7, leadId: "x", date: "2026-10-23", skin: "imessage", cta: "soft", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], slug: "007-fake", status: "rendered" }) as any;

/** Fake YouTube. lockMode "locked" ignores privacy changes like an unaudited project would. */
function fakeYouTube(lockMode: "open" | "locked") {
  const log: string[] = [];
  let privacy = "private";
  const f = (async (url: string, init: any = {}) => {
    const m = init.method ?? "GET";
    log.push(`${m} ${url.split("?")[0]}`);
    const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });
    if (url.includes("uploadType=resumable")) {
      privacy = JSON.parse(init.body).status.privacyStatus;
      return ok({}, { location: "https://upload.example/session" });
    }
    if (url === "https://upload.example/session") return ok({ id: "vid123" });
    if (m === "PUT" && url.includes("/videos?part=status")) {
      if (lockMode === "open") privacy = JSON.parse(init.body).status.privacyStatus;
      return ok({});
    }
    if (url.includes("/videos?part=status&id=")) return ok({ items: [{ status: { privacyStatus: privacy, uploadStatus: "processed" } }] });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const u: Uploader = { fetch: f, token: async () => "t" };
  return { u, log, privacy: () => privacy };
}

function videoFile() {
  const f = join(tmp(), "v.mp4");
  writeFileSync(f, Buffer.alloc(1024));
  return f;
}

describe("upload metadata", () => {
  it("discloses the AI voice and flags synthetic media on every upload", () => {
    const r = uploadRequest(ep(), "AI voice (ElevenLabs)");
    expect(r.status.containsSyntheticMedia).toBe(true);
    expect(r.status.selfDeclaredMadeForKids).toBe(false);
    expect(r.snippet.description).toMatch(/narration is an AI voice \(ElevenLabs\)/);
    expect(r.snippet.description).toMatch(/never texts you, calls you, or asks for money/);
    expect(r.snippet.title).toBe("Scam #007: Traffic ticket text with a QR code: real or scam?");
    expect(r.snippet.title.length).toBeLessThanOrEqual(100);
  });
});

describe("first upload lock test", () => {
  it("uploads private, proves the lock is off via unlisted, then goes public", async () => {
    const yt = fakeYouTube("open");
    const ledger: any = { nextNumber: 1, episodes: [], skipped: [] };
    const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", ledger);
    expect(r.lockedPrivate).toBe(false);
    expect(ledger.firstUploadCheck.locked).toBe(false);
    expect(yt.privacy()).toBe("public");
  });

  it("detects a locked project, writes the audit answers, and stops uploading", async () => {
    const yt = fakeYouTube("locked");
    const ledger: any = { nextNumber: 1, episodes: [], skipped: [] };
    const audit = path("docs/youtube-audit-request.md");
    const before = existsSync(audit) ? readFileSync(audit, "utf8") : null;
    try {
      const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", ledger);
      expect(r.lockedPrivate).toBe(true);
      expect(yt.privacy()).toBe("private");
      expect(readFileSync(audit, "utf8")).toMatch(/yt_api_form/);
      await expect(publishShort(yt.u, ep(), videoFile(), "AI voice", ledger)).rejects.toThrow(/locked private/);
    } finally {
      if (before === null) (await import("node:fs")).rmSync(audit, { force: true });
      else writeFileSync(audit, before);
    }
  });

  it("uploads straight to public after the check has passed", async () => {
    const yt = fakeYouTube("open");
    const ledger: any = { nextNumber: 2, episodes: [], skipped: [], firstUploadCheck: { videoId: "v0", checkedAt: "", locked: false, detail: "" } };
    await publishShort(yt.u, ep(), videoFile(), "AI voice", ledger);
    expect(yt.privacy()).toBe("public");
    expect(yt.log.filter((l) => l.startsWith("PUT https://www.googleapis.com/youtube/v3/videos")).length).toBe(0);
  });
});
