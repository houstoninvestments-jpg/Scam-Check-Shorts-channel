import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishShort, uploadRequest, type Uploader } from "../src/publish/youtube";
import { fixtureScript, tmp } from "./helpers";
import { path } from "../src/lib/util";

const ep = () => ({ number: 7, leadId: "x", date: "2026-10-23", skin: "imessage", cta: "soft", hookVariant: "a", script: fixtureScript(), sources: [{ url: "https://consumer.ftc.gov/x", name: "FTC Consumer Alerts", capture: "page" }], slug: "007-fake", status: "rendered" }) as any;

/** Fake YouTube. lockMode "locked" ignores privacy changes like an unaudited project would. */
function fakeYouTube(lockMode: "open" | "locked", thumbMode: "ok" | "refused" = "ok") {
  const log: string[] = [];
  const thumbs: { url: string; type: string }[] = [];
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
    if (url.includes("/thumbnails/set")) {
      thumbs.push({ url, type: init.headers["content-type"] });
      return thumbMode === "ok" ? ok({ items: [{}] }) : new Response(JSON.stringify({ error: { message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails." } }), { status: 403 });
    }
    if (m === "PUT" && url.includes("/videos?part=status")) {
      if (lockMode === "open") privacy = JSON.parse(init.body).status.privacyStatus;
      return ok({});
    }
    if (url.includes("/videos?part=status&id=")) return ok({ items: [{ status: { privacyStatus: privacy, uploadStatus: "processed" } }] });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const u: Uploader = { fetch: f, token: async () => "t" };
  return { u, log, thumbs, privacy: () => privacy };
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
    expect(r.snippet.title).toBe("Scam No. 007: Traffic ticket text with a QR code: real or scam?");
    expect(r.snippet.title).not.toContain("#"); // keeps YouTube from reading the number as a hashtag
    expect(r.snippet.title.length).toBeLessThanOrEqual(100);
  });
});

describe("first upload lock test", () => {
  it("uploads private, proves the lock is off via unlisted, then keeps the test video private", async () => {
    const yt = fakeYouTube("open");
    const ledger: any = { nextNumber: 1, episodes: [], skipped: [] };
    const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", ledger);
    expect(r.lockedPrivate).toBe(false);
    expect(r.privacy).toBe("private");
    expect(ledger.firstUploadCheck.locked).toBe(false);
    expect(yt.privacy()).toBe("private");
    expect(yt.log.filter((l) => l.startsWith("PUT https://www.googleapis.com/youtube/v3/videos")).length).toBe(2); // unlisted, then back to private
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

describe("thumbnail from the cover frame", () => {
  const jpeg = () => {
    const f = join(tmp(), "cover.jpg");
    writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]));
    return f;
  };
  const passed = () => ({ nextNumber: 2, episodes: [], skipped: [], firstUploadCheck: { videoId: "v0", checkedAt: "", locked: false, detail: "" } }) as any;

  it("sets the cover as the thumbnail after the upload", async () => {
    const yt = fakeYouTube("open");
    const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", passed(), jpeg());
    expect(r.thumbnail).toEqual({ ok: true, detail: "thumbnail set from the cover frame" });
    expect(yt.thumbs[0].url).toMatch(/thumbnails\/set\?videoId=vid123/);
    expect(yt.thumbs[0].type).toBe("image/jpeg");
  });

  it("logs and moves on when YouTube refuses the thumbnail; the upload still counts", async () => {
    const yt = fakeYouTube("open", "refused");
    const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", passed(), jpeg());
    expect(r.videoId).toBe("vid123");
    expect(r.thumbnail?.ok).toBe(false);
    expect(r.thumbnail?.detail).toMatch(/403/);
    expect(yt.privacy()).toBe("public");
  });

  it("still tries the thumbnail on the first, private test upload", async () => {
    const yt = fakeYouTube("open");
    const ledger: any = { nextNumber: 1, episodes: [], skipped: [] };
    const r = await publishShort(yt.u, ep(), videoFile(), "AI voice", ledger, jpeg());
    expect(r.thumbnail?.ok).toBe(true);
    expect(ledger.firstUploadCheck.locked).toBe(false);
  });
});
