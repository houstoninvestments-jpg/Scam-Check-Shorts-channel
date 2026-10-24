# Scam or Not

An automated, faceless YouTube Shorts channel. Each day one real scam text
lands on a phone screen. Real or scam? Three seconds. Then a red SCAM stamp,
three red flags circled and named, one safe move, and "Send this to the one
who'd tap it." About 30 seconds, numbered (Scam #001), loops cleanly.

Nobody reviews videos. If the checks are unsure, the day is skipped.

## How a day runs

One GitHub Actions job (`.github/workflows/daily.yml`) runs every morning:

1. **Scout** (`src/scout`) pulls fresh scam alerts from the FTC, BBB, three
   state attorneys general and r/Scams. It groups pages about the same scam,
   ranks by freshness, and drops anything already covered.
   Sources live in `config/sources.json`.
2. **Writer** (`src/writer`, Claude Fable 5.1) fills the beats in the
   channel's own words. Every red flag and the safe move must quote its source.
3. **Checker** (`src/checker`). First a code check that needs no model: every
   quote must appear word for word in its source, circles must land on the
   message, nothing may read the scam aloud, real links and numbers are
   swapped out, and every line must pass a grade 8 reading gate. Then two
   independent Claude Opus 5.5 reviews. Both must say "scam" with no problems,
   or the scam is skipped.
4. **Voice** (`src/voice`). ElevenLabs on the existing Creator plan, with a
   monthly credit budget in `config/channel.json`. If ElevenLabs fails, the free
   open Kokoro voice keeps the day on track, and the health check says so.
5. **Render** (`remotion/`). Six logo-free phone skins: text (two styles),
   email, voicemail transcript, marketplace chat, social DM. Burned-in
   captions. Red only for the verdict and the flags. Frame 0 is the cover:
   the phone with the scam text, a big "REAL OR SCAM?" stamp and the Scam
   number, never the answer. The video fades back to it at the end, and each
   render is checked that its last frame matches its first.
6. **Publish** (`src/publish`). Resumable upload through the YouTube Data API,
   one a day. Every upload sets YouTube's altered-or-synthetic flag and says
   the narration is an AI voice. The very first upload goes up private and is
   tested for the "locked private" restriction before anything goes public.
   If locked, the audit answers are written to `docs/youtube-audit-request.md`.
   The cover frame is saved as a JPEG and sent as the video's thumbnail. If
   YouTube refuses a custom thumbnail, that is logged and the upload stands.
   Each description ends with exactly four hashtags: `#ScamOrNot`, the scam
   type, `#ScamAlert`, `#Shorts`. The scam type comes from the approved list in
   `config/hashtags.json` (fallback `#TextScam`); the writer only picks a
   category id. Search tags are phrases from the same file, brand-free and
   under YouTube's 500-character limit. Preview: `npx tsx src/cli.ts metadata-preview`.
7. **Website** (`src/site`) at `https://scamornot.pages.dev` on Cloudflare Pages
   (free plan). The daily job deploys with Wrangler once `CLOUDFLARE_API_TOKEN`
   and `CLOUDFLARE_ACCOUNT_ID` are set, picking `scamornot`, then
   `scamornotdaily`, then `scamornotshorts`, whichever is free. Until then it
   deploys to GitHub Pages; after the switch the old address forwards to the
   new one. `npx tsx src/cli.ts deploy-dry-run` shows both paths. The site has a link page, the daily 3-message
   round with a share line ("Scam #047 · I caught 2 of 3"), one page per scam
   titled with the exact scam text, email signup, and a labeled paid-link slot.
   Every scam page gets a 1200x630 share card (the question, never the answer),
   and the other pages share a default card, so links preview in texts,
   WhatsApp, Facebook and iMessage. Cards are drawn from code at build time
   (`src/site/cards.ts`, Satori + resvg, no browser, no accounts).
8. **Learn** (`src/learn`) reads YouTube retention once a video has a few days
   of data and shifts future hooks toward the ones that hold viewers. The three
   call-to-action states (none, soft, direct) rotate evenly and are measured.
9. **Health** (`src/health`) opens a GitHub issue only when something breaks,
   and closes it when the next check passes.

Until the YouTube keys are in place, the daily job runs everything in dry-run
mode and uploads nothing.

## Family Pass (built, switched off)

$19 one time, Stripe TEST mode only. Past-rounds library, a family group of up
to 6 with streaks, big text, and Fire Drill (a harmless practice scam whose
link lands on a kind "gotcha" page on its own address). Instant access by
email link and a self-serve 30-day refund. Code: `site/static/family.js`,
`supabase/migrations`, `supabase/functions`, `src/site/stripe-setup.ts`.
Switch: `familyPass.enabled` in `config/channel.json`.

## Commands

```
npm run dry-run          # whole pipeline from saved inputs, renders a test Short, uploads nothing
npm test                 # 50+ checks, including the database rules on an in-memory Postgres
npm run studio           # preview the video template
npx tsx src/cli.ts preview-skins   # one still per phone skin from the last run
npx tsx src/cli.ts site --test-preview   # local site preview from the dry-run ledger
```

## Secrets

This repo is public. Keys live only in GitHub Actions secrets. `.env.example`
lists the names. `scripts/secret-scan.sh` runs before every automated commit
and in CI.

Setup steps for the founder: `docs/SETUP.md`.
