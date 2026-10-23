// Self-serve refund within the refund window. Ends access for the whole family right away.
import { admin, cors, json, userFrom } from "../_shared/util.ts";

const REFUND_DAYS = Number(Deno.env.get("FAMILY_PASS_REFUND_DAYS") ?? 30);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const db = admin();
  const { data: p } = await db.from("purchases").select("*").eq("user_id", user.id).is("refunded_at", null).order("created_at").limit(1).maybeSingle();
  if (!p) return json({ error: "We couldn't find a Family Pass to refund on this account." }, 404);
  const ageDays = (Date.now() - Date.parse(p.created_at)) / 86_400_000;
  if (ageDays > REFUND_DAYS) return json({ error: `Refunds are open for ${REFUND_DAYS} days after purchase.` }, 400);

  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `refund-${p.id}` },
    body: new URLSearchParams({ payment_intent: p.stripe_payment_intent, reason: "requested_by_customer" }),
  });
  if (!res.ok) return json({ error: "The refund didn't go through. Please try again in a few minutes." }, 502);
  await db.from("purchases").update({ refunded_at: new Date().toISOString() }).eq("id", p.id);
  return json({ ok: true });
});
