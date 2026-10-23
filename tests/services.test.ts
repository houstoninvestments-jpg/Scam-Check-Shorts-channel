import { describe, expect, it, beforeEach } from "vitest";
import { join } from "node:path";
import { synthesize, creditsLeftThisMonth } from "../src/voice";
import { stripeSetup } from "../src/site/stripe-setup";
import { tmp } from "./helpers";
import { existsSync } from "node:fs";

describe("ElevenLabs voice", () => {
  beforeEach(() => {
    process.env.VOICE_USAGE_FILE = join(tmp(), "usage.json");
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_VOICE_ID = "voice1";
  });

  it("requests timed speech per line and keeps word timings", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      if (url.includes("subscription")) return new Response(JSON.stringify({ character_count: 1000, character_limit: 100000 }));
      return new Response(JSON.stringify({ audio_base64: Buffer.from("mp3").toString("base64"), alignment: { characters: [..."Hi"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.3] } }));
    }) as any;
    try {
      const { resetConfigCache } = await import("../src/lib/config");
      resetConfigCache();
      const r = await synthesize([{ id: "hook", text: "Hi" }], join(tmp(), "a"), { force: "elevenlabs" });
      expect(r.provider).toBe("elevenlabs");
      expect(r.segments[0].words).toEqual([{ word: "Hi", start: 0, end: 0.3 }]);
      expect(calls.some((c) => c.includes("/v1/text-to-speech/voice1/with-timestamps"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("tracks the monthly credit budget", () => {
    expect(creditsLeftThisMonth(new Date("2099-01-01"))).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.KOKORO_DIR || !existsSync(process.env.KOKORO_DIR ?? "/nope"))("falls back to the free voice when ElevenLabs fails", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as any;
    try {
      const r = await synthesize([{ id: "hook", text: "Real or scam?" }], join(tmp(), "b"), { force: "elevenlabs" });
      expect(r.provider).toBe("kokoro");
      expect(r.segments[0].duration).toBeGreaterThan(0.3);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Family Pass Stripe setup", () => {
  it("refuses a live key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    await expect(stripeSetup(async () => new Response("{}"))).rejects.toThrow(/TEST key/);
  });
  it("creates a $19 one-time price and a payment link in test mode", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    const bodies: Record<string, URLSearchParams> = {};
    const r = await stripeSetup((async (url: string, init: any) => {
      const what = url.split("/v1/")[1];
      bodies[what] = init.body;
      return new Response(JSON.stringify({ id: `${what}_1`, url: "https://buy.stripe.com/test_x", secret: "whsec_x" }));
    }) as any);
    expect(bodies.prices.get("unit_amount")).toBe("1900");
    expect(bodies.prices.get("recurring[interval]")).toBeNull();
    expect(bodies.webhook_endpoints.get("enabled_events[0]")).toBe("checkout.session.completed");
    expect(r.paymentLink).toMatch(/test_/);
  });
});
