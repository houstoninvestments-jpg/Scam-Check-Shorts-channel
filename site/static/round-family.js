// Loaded on the round page only when Family Pass is on: saves the score for family streaks if signed in.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const sb = createClient(window.SON.supabaseUrl, window.SON.supabaseKey);
window.SON_onRoundDone = async (round, caught) => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await sb.from("round_results").insert({ round_date: round.date, caught, total: round.items.length });
};
