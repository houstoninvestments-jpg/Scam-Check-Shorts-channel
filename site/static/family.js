// Family Pass member area. Only shipped when the pass is switched on.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const S = window.SON;
const sb = createClient(S.supabaseUrl, S.supabaseKey);
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id)?.classList.toggle("hidden", !on);
const say = (id, t) => ($(id).textContent = t);

async function fn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${S.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token}`, apikey: S.supabaseKey },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("signin-msg", "Sending...");
  const { error } = await sb.auth.signInWithOtp({ email: e.target.email.value.trim(), options: { emailRedirectTo: location.href, shouldCreateUser: false } });
  say("signin-msg", error ? "We couldn't find a Family Pass for that email." : "Check your email for a sign-in link.");
});

$("big").addEventListener("change", (e) => {
  document.body.classList.toggle("big", e.target.checked);
  try { localStorage.setItem("bigText", e.target.checked ? "1" : "0"); } catch {}
});
try { $("big").checked = localStorage.getItem("bigText") === "1"; } catch {}

async function load() {
  const { data: { session } } = await sb.auth.getSession();
  show("signin", !session);
  show("member", !!session);
  if (!session) return;
  const { data: pass } = await sb.rpc("has_pass");
  if (!pass) { say("member-msg", "This account has no active Family Pass."); return; }

  // Past rounds library
  const idx = await fetch("../../rounds/index.json").then((r) => r.json()).catch(() => []);
  $("library").innerHTML = idx.slice().reverse().map((d) => `<a href="../../round/?d=${d.date}">Round for Scam #${String(d.number).padStart(3, "0")}<small>${d.date}</small></a>`).join("") || "<p>No past rounds yet.</p>";

  // Family group and streaks
  const { data: fam } = await sb.rpc("my_family");
  show("make-family-form", !fam);
  show("family", !!fam);
  if (fam) {
    say("family-name", fam.name);
    $("members").innerHTML = fam.members.map((m) => `<li><b>${m.display_name}</b> ${m.streak ? `· ${m.streak}-day streak` : ""}</li>`).join("");
    show("add-member-form", fam.is_owner && fam.members.length < S.maxMembers);
  }

  // Fire drills (only when the Fire Drill page has its own address)
  if (!$("drills")) return;
  const { data: drills } = await sb.from("fire_drill_summary").select("*").order("created_at", { ascending: false });
  $("drills").innerHTML = (drills || []).map((d) => `<li>${d.label}: ${d.taps ? `<b>tapped ${d.taps} time${d.taps > 1 ? "s" : ""}</b>` : "not tapped yet"}</li>`).join("");
}

$("make-family-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.rpc("create_family", { family_name: e.target.name.value.trim() });
  if (error) say("member-msg", error.message); else load();
});

$("add-member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await fn("family-invite", { name: e.target.name.value.trim(), email: e.target.email.value.trim() });
    say("member-msg", "Invite sent. They'll get a sign-in link by email.");
    e.target.reset();
    load();
  } catch (err) { say("member-msg", err.message); }
});

$("drill-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data, error } = await sb.rpc("create_drill", { drill_label: e.target.label.value.trim() || "Practice text" });
  if (error) return say("member-msg", error.message);
  const text = `Hi! We couldn't deliver your package. Pick a new time here: ${S.fireDrillBase}/?k=${data}`;
  $("drill-text").textContent = text;
  show("drill-out", true);
  load();
});

$("copy-drill")?.addEventListener("click", () => navigator.clipboard?.writeText($("drill-text").textContent).then(() => say("copy-drill", "Copied")));

$("refund").addEventListener("click", async () => {
  if (!confirm("Refund your Family Pass? Access ends right away for your whole family.")) return;
  try { await fn("family-refund"); say("member-msg", "Refunded. It can take 5 to 10 days to show on your card."); load(); }
  catch (err) { say("member-msg", err.message); }
});

$("signout").addEventListener("click", async () => { await sb.auth.signOut(); load(); });

// Streaks: the round page reports results here when a member is signed in.
window.SON_onRoundDone = async (round, caught) => {
  await sb.from("round_results").insert({ round_date: round.date, caught, total: round.items.length });
};

sb.auth.onAuthStateChange(() => load());
load();
