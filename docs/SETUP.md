# One-time setup (AARON)

Four steps. After step 4, the next morning's run goes live on its own.
Until then it runs in dry-run mode every day and uploads nothing.

Where a step says "verified", the click path comes from the linked official
page as read on 2026-10-23. Screens can change; the page is the source of truth.

## 1. Turn on the website (1 minute)

Verified: [GitHub Docs, publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

1. Open the repo on GitHub: `houstoninvestments-jpg/Scam-Check-Shorts-channel`.
2. Click **Settings**.
3. In the sidebar, under "Code and automation", click **Pages**.
4. Under "Build and deployment", under "Source", select **GitHub Actions**.

The site will live at:
`https://houstoninvestments-jpg.github.io/Scam-Check-Shorts-channel/`

## 2. Create the YouTube channel

Verified: [YouTube Help, create a channel](https://support.google.com/youtube/answer/1646861)

1. Sign in to YouTube on a computer.
2. Click your profile picture, then **Settings**.
3. Under "Account", click **Add or manage channel(s)**.
4. Click **Create a channel**.
5. Choose a picture, enter the name **Scam or Not**, and pick a handle.
6. Click **Create channel**.

## 3. Let the job upload to that channel (one authorization)

This makes three values: a client ID, a client secret, and a refresh token.

Partly verified. The redirect address and the Playground steps come from
[Google's OAuth Playground page](https://developers.google.com/oauthplayground)
and recent guides. The Google Cloud menu names change often, so follow the
labels on screen.

**a. Google Cloud project**
1. Go to `https://console.cloud.google.com` with the same Google account that owns the channel.
2. Create a new project named `scam-or-not`.
3. Enable two APIs for it: **YouTube Data API v3** and **YouTube Analytics API**.

**b. Sign-in settings (Google Auth Platform / OAuth consent screen)**
1. Audience: **External**.
2. App name: `Scam or Not`. Support and contact email: yours.
3. Set the publishing status to **In production**. In "Testing", Google expires
   the refresh token after 7 days and the daily upload would stop.

**c. OAuth client**
1. Create a client of type **Web application**.
2. Under "Authorized redirect URIs", add exactly:
   `https://developers.google.com/oauthplayground`
3. Save. Copy the **Client ID** and **Client secret**.

**d. Get the refresh token**
1. Open `https://developers.google.com/oauthplayground`.
2. Click the gear icon (top right). Tick **Use your own OAuth credentials**.
   Paste the Client ID and Client secret. Access type: **Offline**.
3. In "Step 1", paste these three scopes into the box, separated by spaces:
   `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly`
4. Click **Authorize APIs**. Pick the account and the **Scam or Not** channel.
   Google will warn the app is unverified; continue for your own account.
5. In "Step 2", click **Exchange authorization code for tokens**.
6. Copy the **Refresh token**.
7. Back in Google Cloud, remove the Playground redirect URI from the client.

## 4. Add the keys to GitHub

Verified: [GitHub Docs, using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

1. In the repo, click **Settings**.
2. In the sidebar, under "Security", click **Secrets and variables**, then **Actions**.
3. On the "Secrets" tab, click **New repository secret** once for each name below.
   Paste the value, click **Add secret**.

```
ANTHROPIC_API_KEY
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
```

Not verified from here: the exact screens where the Anthropic key, the
ElevenLabs key, and the ElevenLabs voice ID are shown. Anthropic keys come
from `https://console.anthropic.com`. The ElevenLabs key and voice ID come from
the ElevenLabs account on the Creator plan.

## Later, only when wanted

- **Email signups.** The signup box stays hidden until a free Supabase project
  exists. It should be its own new organization, not an existing one. Then
  apply `supabase/migrations/` and set two repo **variables** (not secrets):
  `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- **Affiliate slot.** Apply to an identity-protection affiliate program. When
  approved, fill `affiliate` in `config/channel.json` and set `enabled: true`.
- **Family Pass.** Off. Turning it on needs the Supabase project above, a
  Stripe test key, `npx tsx src/cli.ts stripe-setup`, the edge functions in
  `supabase/functions/`, and a second free address for Fire Drill.
