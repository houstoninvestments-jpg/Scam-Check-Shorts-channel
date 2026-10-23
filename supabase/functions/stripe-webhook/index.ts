// Family Pass delivery: Stripe calls this after checkout. We record the purchase and email a sign-in link.
// Test mode only until FAMILY_PASS_LIVE=1 is set on purpose.
import { admin, appUrl, json } from "../_shared/util.ts";

async function verify(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return given.some((g) => g.length === hex.length && [...g].every((c, i) => c === hex[i]));
}

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verify(body, req.headers.get("stripe-signature"), Deno.env.get("STRIPE_WEBHOOK_SECRET")!))) return json({ error: "bad signature" }, 400);
  const event = JSON.parse(body);
  if (event.livemode && Deno.env.get("FAMILY_PASS_LIVE") !== "1") return json({ ignored: "live mode is off" });
  if (event.type !== "checkout.session.completed") return json({ ignored: event.type });

  const s = event.data.object;
  if (s.payment_status !== "paid") return json({ ignored: "not paid" });
  const email = (s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();
  if (!email) return json({ error: "no email on session" }, 400);

  const db = admin();
  const { error: dup } = await db.from("purchases").insert({
    email,
    stripe_session_id: s.id,
    stripe_payment_intent: s.payment_intent,
    amount_cents: s.amount_total,
    livemode: !!event.livemode,
  });
  if (dup && !String(dup.message).includes("duplicate")) return json({ error: dup.message }, 500);

  // New buyer: invite email. Returning user: a magic sign-in link. Either way, access is instant.
  let userId: string | undefined;
  const invite = await db.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl() });
  if (invite.data.user) userId = invite.data.user.id;
  else {
    const { data } = await db.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: appUrl() } });
    userId = data.user?.id;
    await db.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl(), shouldCreateUser: false } });
  }
  if (userId) await db.from("purchases").update({ user_id: userId }).eq("stripe_session_id", s.id);
  return json({ ok: true });
});
