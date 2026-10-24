# One-time setup (AARON)

Four steps. After step 4, the next morning's run goes live on its own.
Until then it runs in dry-run mode every day and uploads nothing.

Where a step says "Verified" or "Source", the click path comes from the linked official
page as read on 2026-10-23. Screens can change; the page is the source of truth.

## 1. Put the website on Cloudflare Pages (free, about 5 minutes)

The site will live at `https://scamornot.pages.dev`. If that name is taken,
the job uses `scamornotdaily.pages.dev`, then `scamornotshorts.pages.dev`, on
its own. Free plan only; no card needed for anything here. Until both keys
below are saved, the job keeps publishing to GitHub Pages; it switches by
itself on the next run after they are saved.

**a. Create a free Cloudflare account**
Source: [Cloudflare, create an account](https://developers.cloudflare.com/fundamentals/account/create-account/)
and [verify your email](https://developers.cloudflare.com/fundamentals/account/verify-email-address/)
1. Open `https://dash.cloudflare.com/sign-up`.
2. Enter an email and a password, then submit.
3. Open the verification email from Cloudflare (check spam) and click the link.

**b. Create the API token (only the Pages permission)**
Source: [Cloudflare Pages, direct upload with CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
and [Cloudflare, create an API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
1. In the Cloudflare dashboard, go to **Manage Account**, then **Account API Tokens**.
2. Click **Create Token**.
3. Next to **Create Custom Token**, click **Get started**.
4. Name it `scam-or-not-pages`.
5. Under **Permissions**, choose **Account**, then **Cloudflare Pages**, then **Edit**.
   Add nothing else.
6. Click **Continue to summary**, then **Create Token**.
7. Copy the token now. Cloudflare shows it only once.

**c. Copy the Account ID**
Source: [Cloudflare, find account and zone IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
1. Go to the **Account home** page.
2. Open the menu at the end of the account row and choose **Copy account ID**.
   (It is also shown under **Account details** on the **Workers & Pages** page.)

**d. Save both in GitHub**
Source: [GitHub Docs, using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
1. In the repo, click **Settings**.
2. In the sidebar, under "Security", click **Secrets and variables**, then **Actions**.
3. Click **New repository secret**. Name `CLOUDFLARE_API_TOKEN`, paste the token, click **Add secret**.
4. Click **New repository secret** again. Name `CLOUDFLARE_ACCOUNT_ID`, paste the ID, click **Add secret**.

The YouTube bio link is then `https://scamornot.pages.dev` (the run report and
`data/site-target.json` show the exact address if a fallback name was used).

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
