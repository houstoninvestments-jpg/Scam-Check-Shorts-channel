// Owner invites a family member by email. Up to the member limit, only with an active pass.
import { admin, appUrl, cors, json, userFrom } from "../_shared/util.ts";

const MAX = Number(Deno.env.get("FAMILY_PASS_MAX_MEMBERS") ?? 6);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { name, email } = await req.json().catch(() => ({}));
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? "")) return json({ error: "Add a name and a valid email." }, 400);

  const db = admin();
  const { data: fam } = await db.from("families").select("id").eq("owner", user.id).maybeSingle();
  if (!fam) return json({ error: "Only the person who bought the pass can invite." }, 403);
  const { data: paid } = await db.from("purchases").select("id").eq("user_id", user.id).is("refunded_at", null).limit(1);
  if (!paid?.length) return json({ error: "No active Family Pass." }, 403);
  const { count } = await db.from("family_members").select("*", { count: "exact", head: true }).eq("family_id", fam.id);
  if ((count ?? 0) >= MAX) return json({ error: `A family group holds up to ${MAX} people.` }, 400);

  const addr = String(email).toLowerCase();
  const invite = await db.auth.admin.inviteUserByEmail(addr, { redirectTo: appUrl() });
  let memberId = invite.data.user?.id;
  if (!memberId) {
    // Already has an account: find it and send a sign-in link instead.
    const { data } = await db.auth.admin.generateLink({ type: "magiclink", email: addr, options: { redirectTo: appUrl() } });
    memberId = data.user?.id;
    if (!memberId) return json({ error: "We couldn't send that invite." }, 500);
    await db.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: appUrl(), shouldCreateUser: false } });
  }
  const { error } = await db.from("family_members").insert({ family_id: fam.id, user_id: memberId, display_name: String(name).slice(0, 40), invite_email: email });
  if (error) return json({ error: /duplicate|unique/i.test(error.message) ? "That person is already in a family group." : error.message }, 400);
  return json({ ok: true });
});
