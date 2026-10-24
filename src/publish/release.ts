import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Episode, Ledger } from "../types.js";
import { log } from "../lib/util.js";
import { setPrivacy, uploadRequest, videoStatus, type Uploader } from "./youtube.js";

/**
 * Release a video that was uploaded but kept hidden (the first upload, held private by the lock test).
 * It goes public only when the copy on YouTube matches today's format and no frame carries a test label.
 * Metadata is fixed in place; a labeled video is never replaced, only held.
 */

const API = "https://www.googleapis.com/youtube/v3";

async function get(u: Uploader, url: string) {
  const res = await u.fetch(url, { headers: { authorization: `Bearer ${await u.token()}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube GET ${url.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function put(u: Uploader, url: string, body: unknown) {
  const res = await u.fetch(url, { method: "PUT", headers: { authorization: `Bearer ${await u.token()}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube PUT ${url.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
}

interface LiveVideo {
  snippet: { title: string; description: string; tags?: string[]; categoryId: string; thumbnails?: Record<string, { url: string; width: number; height: number }> };
  status: { privacyStatus: string; uploadStatus: string; containsSyntheticMedia?: boolean; selfDeclaredMadeForKids?: boolean };
}

export async function readVideo(u: Uploader, id: string): Promise<LiveVideo> {
  const j = await get(u, `${API}/videos?part=snippet,status&id=${encodeURIComponent(id)}`);
  if (!j.items?.[0]) throw new Error(`video ${id} not found on our channel`);
  return j.items[0];
}

/** What differs between the copy on YouTube and what today's code would send. Empty means it matches. */
export function metadataProblems(live: LiveVideo, want: ReturnType<typeof uploadRequest>): string[] {
  const out: string[] = [];
  const s = live.snippet;
  if (s.title !== want.snippet.title) out.push(`title is "${s.title}", should be "${want.snippet.title}"`);
  if (s.description !== want.snippet.description) {
    const a = s.description.split("\n");
    const b = want.snippet.description.split("\n");
    const i = a.findIndex((l, n) => l !== b[n]);
    out.push(`description differs from line ${(i < 0 ? a.length : i) + 1}: "${(a[i] ?? "").slice(0, 80)}" should be "${(b[i] ?? "").slice(0, 80)}"`);
  }
  const lastLine = s.description.trim().split("\n").pop() ?? "";
  const tags = lastLine.split(/\s+/).filter((w) => w.startsWith("#"));
  if (tags.length !== 4 || lastLine !== want.snippet.description.split("\n").pop()) out.push(`hashtag line is "${lastLine}"`);
  if (/TEST RENDER|\btest\b/i.test(s.title) || /TEST RENDER/i.test(s.description)) out.push("title or description mentions a test");
  if ((s.tags ?? []).join("|") !== want.snippet.tags.join("|")) out.push("search tags differ");
  if (s.categoryId !== want.snippet.categoryId) out.push(`category is ${s.categoryId}, should be ${want.snippet.categoryId}`);
  if (live.status.containsSyntheticMedia !== true) out.push(`altered-or-synthetic flag is ${live.status.containsSyntheticMedia ?? "not returned"}`);
  if (live.status.uploadStatus !== "processed") out.push(`upload status is ${live.status.uploadStatus}`);
  return out;
}

// The dry-run label is a yellow box (#FFD60A) in the top row of every frame (remotion/ScamShort.tsx).
const isLabelYellow = (r: number, g: number, b: number) => r >= 225 && g >= 190 && g <= 235 && b <= 70;

/** Count label-yellow pixels in an image or one video frame, decoded by ffmpeg. Region is in fractions of the frame. */
export function yellowPixels(input: string, at?: number, region = { top: 0, bottom: 1 }): number {
  const args = ["-v", "error", ...(at !== undefined ? ["-ss", String(at)] : []), "-i", input, "-frames:v", "1", "-vf", "scale=540:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"];
  const r = spawnSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error(`could not read ${input}${at !== undefined ? ` at ${at}s` : ""}: ${r.stderr?.toString().slice(0, 200)}`);
  const px = r.stdout as Buffer;
  const width = 540;
  const height = px.length / 3 / width;
  let n = 0;
  for (let y = Math.floor(region.top * height); y < Math.floor(region.bottom * height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (isLabelYellow(px[i], px[i + 1], px[i + 2])) n++;
    }
  }
  return n;
}

function duration(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(r.stdout.toString().trim());
}

// Measured on renders of 001 and 002: a labeled frame has about 1,090 yellow pixels at 540 wide, a clean one 0.
// YouTube-sized thumbnails (letterboxed) show 60-120 with the label and 0-10 without.
export const LABEL_MIN_PIXELS = 300;
export const THUMB_LABEL_MIN_PIXELS = 30;

export interface FrameCheck {
  source: string;
  yellow: number[];
  label: boolean;
}

/** Five frames across the video file, top 12% only (where the label sits). */
export function checkVideoFrames(file: string, source: string): FrameCheck {
  const d = duration(file);
  const yellow = [0, 0.25, 0.5, 0.75, 0.97].map((f) => yellowPixels(file, +(d * f).toFixed(2), { top: 0, bottom: 0.12 }));
  return { source, yellow, label: yellow.some((n) => n >= LABEL_MIN_PIXELS) };
}

/** YouTube's own thumbnails are frames picked from the uploaded copy. Whole image, since they can be letterboxed. */
export async function checkYouTubeThumbnails(u: Uploader, live: LiveVideo, dir: string): Promise<FrameCheck | null> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const yellow: number[] = [];
  for (const [name, t] of Object.entries(live.snippet.thumbnails ?? {})) {
    const res = await u.fetch(t.url);
    if (!res.ok) continue;
    const file = `${dir}/${name}.jpg`;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    yellow.push(yellowPixels(file));
  }
  if (!yellow.length) return null;
  return { source: "YouTube's thumbnails of the uploaded copy", yellow, label: yellow.some((n) => n >= THUMB_LABEL_MIN_PIXELS) };
}

export interface ReleaseResult {
  number: number;
  videoId: string;
  metadataBefore: string[];
  metadataFixed: boolean;
  metadataAfter: string[];
  frames: FrameCheck[];
  control?: FrameCheck;
  decision: "public" | "held";
  reason: string;
  privacyAfter: string;
}

export async function releaseHidden(u: Uploader, ledger: Ledger, number: number, opts: { video?: string; control?: string; thumbDir: string; publish: boolean }): Promise<ReleaseResult> {
  const ep = ledger.episodes.find((e) => e.number === number);
  if (!ep?.youtubeId) throw new Error(`episode ${number} has no YouTube upload`);
  if (ledger.firstUploadCheck?.locked) throw new Error("uploads are still locked private; nothing can go public");
  const id = ep.youtubeId;

  let live = await readVideo(u, id);
  const privacy = live.status.privacyStatus as "public" | "private" | "unlisted";
  const want = uploadRequest(ep, ep.voice ?? "AI voice (ElevenLabs)", privacy);
  const before = metadataProblems(live, want);
  let after = before;
  if (before.length) {
    log(`fixing ${number} metadata in place: ${before.join("; ")}`);
    await put(u, `${API}/videos?part=snippet`, { id, snippet: want.snippet });
    await setPrivacy(u, id, privacy); // same privacy; re-sends the altered-or-synthetic flag
    live = await readVideo(u, id);
    after = metadataProblems(live, want);
  }

  const frames: FrameCheck[] = [];
  if (opts.video && existsSync(opts.video)) frames.push(checkVideoFrames(opts.video, "the exact file that was uploaded"));
  const thumbs = await checkYouTubeThumbnails(u, live, opts.thumbDir);
  if (thumbs) frames.push(thumbs);
  const control = opts.control && existsSync(opts.control) ? checkVideoFrames(opts.control, "a clean live video, for comparison") : undefined;

  let reason = "";
  if (!opts.video || !existsSync(opts.video)) reason = "could not read the exact file that was uploaded, so its frames are unchecked";
  else if (frames.some((f) => f.label)) reason = `the video frames carry the yellow "TEST RENDER" label (${frames.filter((f) => f.label).map((f) => f.source).join(", ")})`;
  else if (after.length) reason = `metadata still differs after the fix: ${after.join("; ")}`;
  else if (!opts.publish) reason = "clean, but this was a check-only run";

  let decision: ReleaseResult["decision"] = "held";
  if (!reason) {
    await setPrivacy(u, id, "public");
    const st = await videoStatus(u, id);
    if (st?.privacyStatus === "public") {
      decision = "public";
      reason = "clean: metadata matches and no frame carries a test label";
      ep.youtubePrivacy = "public";
      ep.status = "published";
      delete ep.youtubeHold;
    } else reason = `asked for public, YouTube shows ${st?.privacyStatus ?? "unknown"}`;
  }
  if (decision === "held") ep.youtubeHold = reason;
  const finalStatus = (await videoStatus(u, id))?.privacyStatus ?? "unknown";
  ep.youtubePrivacy = finalStatus as Episode["youtubePrivacy"];
  return { number, videoId: id, metadataBefore: before, metadataFixed: before.length > 0 && after.length === 0, metadataAfter: after, frames, control, decision, reason, privacyAfter: finalStatus };
}

/** Our channel's uploads, newest first, with each one's privacy. Also YouTube's Shorts-only list when it answers. */
export async function uploadsOrder(u: Uploader) {
  const ch = await get(u, `${API}/channels?part=contentDetails&mine=true`);
  const uploads: string = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("no uploads playlist found");
  const list = async (playlistId: string) => {
    const j = await get(u, `${API}/playlistItems?part=snippet,status&maxResults=50&playlistId=${encodeURIComponent(playlistId)}`);
    return (j.items ?? []).map((it: any, i: number) => ({ position: i + 1, videoId: it.snippet?.resourceId?.videoId, title: it.snippet?.title, privacy: it.status?.privacyStatus }));
  };
  const all = await list(uploads);
  // "UUSH" + channel id is the Shorts-only uploads list. Not a documented API feature, so it is best effort.
  let shorts: Awaited<ReturnType<typeof list>> | string;
  try {
    shorts = await list(uploads.replace(/^UU/, "UUSH"));
  } catch (e) {
    shorts = `not available: ${String(e).slice(0, 120)}`;
  }
  return { uploadsPlaylist: uploads, all, shorts };
}
