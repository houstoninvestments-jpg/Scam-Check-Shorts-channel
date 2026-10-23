// Shared helpers for the Family Pass edge functions (Deno).
import { createClient } from "jsr:@supabase/supabase-js@2";

export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const cors = {
  "access-control-allow-origin": Deno.env.get("SITE_ORIGIN") ?? "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

/** The signed-in user behind a browser request, or null. */
export async function userFrom(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const { data } = await admin().auth.getUser(token);
  return data.user ?? null;
}

export const appUrl = () => `${Deno.env.get("SITE_BASE_URL")}/family/app/`;
