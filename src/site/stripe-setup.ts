import { config } from "../lib/config.js";
import { log, requireEnv } from "../lib/util.js";

/**
 * One-time Family Pass setup in Stripe TEST mode: product, $19 one-time price, payment link,
 * and the webhook that delivers access. Refuses a live key, so it can never charge anyone.
 */
export async function stripeSetup(fetchImpl: typeof fetch = fetch) {
  const key = requireEnv("STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) throw new Error("Family Pass setup only runs with a Stripe TEST key (sk_test_...).");
  const cfg = config();
  const call = async (path: string, params: Record<string, string>) => {
    const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const j = (await res.json()) as any;
    if (!res.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? res.status}`);
    return j;
  };
  const product = await call("products", { name: "Scam or Not Family Pass", description: "Past rounds, a family group of up to 6 with streaks, big text, and Fire Drill." });
  const price = await call("prices", { product: product.id, unit_amount: String(cfg.familyPass.priceUsd * 100), currency: "usd" });
  const link = await call("payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]": `${cfg.site.baseUrl}/family/app/?welcome=1`,
  });
  const hook = await call("webhook_endpoints", {
    url: `${cfg.supabase.url}/functions/v1/stripe-webhook`,
    "enabled_events[0]": "checkout.session.completed",
  });
  log("Stripe TEST mode setup done. Family Pass stays off until familyPass.enabled is set to true.");
  console.log(`Payment link (public, goes in config/channel.json familyPass.stripePaymentLink): ${link.url}`);
  // The webhook signing secret is shown once, and only in a local terminal, never in CI logs.
  if (process.stdout.isTTY) console.log(`Webhook signing secret (store as STRIPE_WEBHOOK_SECRET in Supabase, then clear your screen): ${hook.secret}`);
  else console.log("Webhook created. Run this command in a local terminal to see its signing secret, or roll the secret in Stripe.");
  return { product: product.id, price: price.id, paymentLink: link.url, webhookId: hook.id, webhookSecret: hook.secret as string };
}
