import { path, readJson } from "./util.js";

export interface ChannelConfig {
  channel: { name: string; tagline: string; never: string; closer: string; contactEmail: string; policyDate: string };
  cadence: { shortsPerDay: number; timezone: string };
  models: { writer: string; checker: string };
  voice: {
    provider: "elevenlabs" | "kokoro";
    fallback: "kokoro" | "none";
    elevenlabsVoiceId: string;
    elevenlabsModel: string;
    kokoroLang: string;
    monthlyCreditBudget: number;
    kokoroVoice: string;
    speed: number;
  };
  ctaStates: ("none" | "soft" | "direct")[];
  skins: string[];
  site: { baseUrl: string; fireDrillBaseUrl: string };
  supabase: { url: string; publishableKey: string };
  affiliate: { enabled: boolean; label: string; name: string; url: string; blurb: string };
  familyPass: { enabled: boolean; priceUsd: number; maxMembers: number; refundDays: number; stripePaymentLink: string };
  youtube: {
    categoryId: string;
    defaultLanguage: string;
    privacyStatus: "public" | "unlisted" | "private";
    firstUploadPrivacy: "private";
    dailyQuotaBudget: number;
  };
  scout: { maxAgeDays: number; minScore: number; dedupeSimilarity: number };
}

let cached: ChannelConfig | undefined;

/**
 * The free GitHub Pages address for a repo (the fallback until Cloudflare Pages is set up). A repo named "<owner>.github.io" is served at the root
 * (https://scamornot.github.io); any other repo is served under its name as a path.
 */
export function pagesBaseUrl(repository: string): string {
  const [owner, name] = repository.split("/");
  if (name.toLowerCase() === `${owner.toLowerCase()}.github.io`) return `https://${name.toLowerCase()}`;
  return `https://${owner.toLowerCase()}.github.io/${name}`;
}

/** Public settings live in config/channel.json. Host env vars may override the ones that differ per deploy. */
export function config(): ChannelConfig {
  if (cached) return cached;
  const c = readJson<ChannelConfig>(path("config/channel.json"));
  const e = process.env;
  // The daily job sets SITE_BASE_URL from wherever the site is deployed (see src/site/target.ts).
  if (e.SITE_BASE_URL) c.site.baseUrl = e.SITE_BASE_URL.replace(/\/+$/, "");
  if (e.FIREDRILL_BASE_URL) c.site.fireDrillBaseUrl = e.FIREDRILL_BASE_URL;
  if (e.SUPABASE_URL) c.supabase.url = e.SUPABASE_URL;
  if (e.SUPABASE_PUBLISHABLE_KEY) c.supabase.publishableKey = e.SUPABASE_PUBLISHABLE_KEY;
  if (e.ELEVENLABS_VOICE_ID) c.voice.elevenlabsVoiceId = e.ELEVENLABS_VOICE_ID;
  if (e.STRIPE_PAYMENT_LINK) c.familyPass.stripePaymentLink = e.STRIPE_PAYMENT_LINK;
  cached = c;
  return c;
}

export function resetConfigCache() {
  cached = undefined;
}
