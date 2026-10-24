import { readFileSync, statSync } from "node:fs";
import type { Episode, Ledger } from "../types.js";
import { config } from "../lib/config.js";
import { log, pad3, path, requireEnv } from "../lib/util.js";
import { writeAuditRequest } from "./audit.js";
import { backendTags, categoryFor, hashtagsFor, noHash, tagConfig } from "./tags.js";

export interface Uploader {
  token(): Promise<string>;
  fetch: typeof fetch;
}

/** OAuth refresh-token client. The one-time authorization produces YOUTUBE_REFRESH_TOKEN. */
export function oauthUploader(fetchImpl: typeof fetch = fetch): Uploader {
  let cached: { token: string; until: number } | undefined;
  return {
    fetch: fetchImpl,
    async token() {
      if (cached && Date.now() < cached.until) return cached.token;
      const res = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: requireEnv("YOUTUBE_REFRESH_TOKEN"),
          client_id: requireEnv("YOUTUBE_CLIENT_ID"),
          client_secret: requireEnv("YOUTUBE_CLIENT_SECRET"),
        }),
      });
      if (!res.ok) throw new Error(`YouTube sign-in failed (${res.status}); the one-time authorization needs redoing`);
      const j = (await res.json()) as { access_token: string; expires_in: number };
      cached = { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 };
      return j.access_token;
    },
  };
}

export function videoTitle(ep: Episode) {
  const t = `Scam #${pad3(ep.number)}: ${noHash(ep.script.title)}`;
  return t.length <= 100 ? t : t.slice(0, 99) + "…";
}

/** The episode's category: saved at write time, or worked out the same way for older episodes. */
export const episodeCategory = (ep: Episode) => categoryFor({ ...ep.script, category: ep.category ?? ep.script.category });

/** The four hashtags for this video, in YouTube display order. Same set the website uses. */
export const episodeHashtags = (ep: Episode) => hashtagsFor(episodeCategory(ep));

export function videoDescription(ep: Episode, voiceLabel: string) {
  const cfg = config();
  const page = `${cfg.site.baseUrl}/scam/${ep.slug}/`;
  return [
    noHash(ep.script.description),
    "",
    `Safe move: ${noHash(ep.script.safeMove.say)}`,
    "",
    `Full breakdown and sources: ${page}`,
    `Play today's 3-text round: ${cfg.site.baseUrl}/round/`,
    "",
    "Sources:",
    ...ep.sources.map((s) => `- ${s.name}: ${s.url}`),
    "",
    ep.script.message.provenance === "recreated" ? `The message on screen is ${ep.script.message.provenanceNote.charAt(0).toLowerCase()}${ep.script.message.provenanceNote.slice(1)}` : "The message on screen is a real scam text, with any links and numbers swapped out for safety.",
    `Disclosure: the narration is an ${voiceLabel}. The phone screen is a code-made recreation.`,
    cfg.channel.never,
    "",
    // Only hashtags in the description, last line, exactly four: #ScamOrNot #<Type>Scam #ScamAlert #Shorts
    episodeHashtags(ep).join(" "),
  ].join("\n");
}

/** The exact metadata we send to YouTube. Saved in every run so dry runs show what would be uploaded. */
export function uploadRequest(ep: Episode, voiceLabel: string, privacy?: "public" | "private" | "unlisted") {
  const cfg = config();
  return {
    snippet: {
      title: videoTitle(ep),
      description: videoDescription(ep, voiceLabel),
      tags: backendTags(ep.script, episodeCategory(ep), tagConfig()),
      categoryId: cfg.youtube.categoryId,
      defaultLanguage: cfg.youtube.defaultLanguage,
      defaultAudioLanguage: cfg.youtube.defaultLanguage,
    },
    status: {
      privacyStatus: privacy ?? cfg.youtube.privacyStatus,
      selfDeclaredMadeForKids: false,
      // YouTube's altered-or-synthetic content flag (Data API, added Oct 2024). Set on every upload for the AI voice.
      containsSyntheticMedia: true,
    },
  };
}

const API = "https://www.googleapis.com/youtube/v3";

async function api(u: Uploader, method: string, url: string, body?: unknown) {
  const res = await u.fetch(url, {
    method,
    headers: { authorization: `Bearer ${await u.token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube ${method} ${url.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Resumable upload: one call to open the session, one PUT with the bytes. */
export async function uploadVideo(u: Uploader, file: string, meta: ReturnType<typeof uploadRequest>): Promise<string> {
  const size = statSync(file).size;
  const init = await u.fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await u.token()}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`upload start failed ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const session = init.headers.get("location");
  if (!session) throw new Error("upload start returned no session URL");
  const put = await u.fetch(session, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: readFileSync(file) });
  const text = await put.text();
  if (!put.ok) throw new Error(`upload failed ${put.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { id: string }).id;
}

export async function videoStatus(u: Uploader, id: string) {
  const j = await api(u, "GET", `${API}/videos?part=status&id=${id}`);
  return j.items?.[0]?.status as { privacyStatus: string; uploadStatus: string; rejectionReason?: string } | undefined;
}

export async function setPrivacy(u: Uploader, id: string, privacyStatus: string) {
  return api(u, "PUT", `${API}/videos?part=status`, {
    id,
    status: { privacyStatus, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  });
}

/**
 * Is this API project locked to private uploads? Google's docs disagree on whether
 * unaudited projects are restricted, so we test it: try to move the private test video to
 * unlisted (never public, so nothing leaks if it works), then read the status back.
 */
export async function lockTest(u: Uploader, id: string): Promise<{ locked: boolean; detail: string }> {
  try {
    await setPrivacy(u, id, "unlisted");
  } catch (e) {
    return { locked: true, detail: `changing privacy was refused: ${String(e).slice(0, 200)}` };
  }
  const st = await videoStatus(u, id);
  if (st?.privacyStatus === "unlisted") return { locked: false, detail: "private test video could be made unlisted; uploads are not locked" };
  return { locked: true, detail: `status stayed ${st?.privacyStatus ?? "unknown"} after asking for unlisted` };
}

export interface ThumbnailResult {
  ok: boolean;
  detail: string;
}

/**
 * Try to set the cover frame as the video's thumbnail. YouTube may refuse custom thumbnails
 * on Shorts or on some channels. That is never a reason to fail the day: log it and move on.
 */
export async function setThumbnail(u: Uploader, videoId: string, jpeg: string): Promise<ThumbnailResult> {
  try {
    const body = readFileSync(jpeg);
    const res = await u.fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${await u.token()}`, "content-type": "image/jpeg", "content-length": String(body.length) },
      body,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `thumbnail not set (${res.status}): ${text.replace(/\s+/g, " ").slice(0, 200)}` };
    return { ok: true, detail: "thumbnail set from the cover frame" };
  } catch (e) {
    return { ok: false, detail: `thumbnail not set: ${String(e).slice(0, 200)}` };
  }
}

export interface PublishResult {
  videoId: string;
  lockedPrivate: boolean;
  detail: string;
  thumbnail?: ThumbnailResult;
}

export async function publishShort(u: Uploader, ep: Episode, file: string, voiceLabel: string, ledger: Ledger, coverJpg?: string): Promise<PublishResult> {
  const r = await publishVideo(u, ep, file, voiceLabel, ledger);
  if (coverJpg) {
    r.thumbnail = await setThumbnail(u, r.videoId, coverJpg);
    log(r.thumbnail.detail);
  }
  return r;
}

async function publishVideo(u: Uploader, ep: Episode, file: string, voiceLabel: string, ledger: Ledger): Promise<PublishResult> {
  if (ledger.firstUploadCheck?.locked) throw new Error("uploads are locked private until the YouTube API audit passes; see docs/youtube-audit-request.md");

  if (!ledger.firstUploadCheck) {
    // First ever upload goes up private, then we check the lock before anything is public.
    const id = await uploadVideo(u, file, uploadRequest(ep, voiceLabel, "private"));
    const res = await lockTest(u, id);
    ledger.firstUploadCheck = { videoId: id, checkedAt: new Date().toISOString(), ...res };
    log(`first upload lock test: ${res.detail}`);
    if (res.locked) {
      writeAuditRequest(path("docs/youtube-audit-request.md"), res.detail);
      return { videoId: id, lockedPrivate: true, detail: res.detail };
    }
    await setPrivacy(u, id, config().youtube.privacyStatus);
    return { videoId: id, lockedPrivate: false, detail: `${res.detail}; now ${config().youtube.privacyStatus}` };
  }

  const id = await uploadVideo(u, file, uploadRequest(ep, voiceLabel));
  return { videoId: id, lockedPrivate: false, detail: `uploaded ${id}` };
}
