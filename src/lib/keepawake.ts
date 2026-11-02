import { config } from "./config.js";

/** Calls public.keep_awake() through Supabase's public API (publishable key only). Never throws. */
export async function keepAwake(fetcher: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const { url, publishableKey } = config().supabase;
  if (!url || !publishableKey) return { ok: false, detail: "Supabase address or publishable key not set; skipped" };
  try {
    const res = await fetcher(`${url}/rest/v1/rpc/keep_awake`, {
      method: "POST",
      headers: { apikey: publishableKey, authorization: `Bearer ${publishableKey}`, "content-type": "application/json" },
      body: "{}",
    });
    const body = (await res.text()).slice(0, 200);
    return res.ok ? { ok: true, detail: `Supabase answered at ${body.replace(/"/g, "")}` } : { ok: false, detail: `Supabase answered ${res.status}: ${body}` };
  } catch (e) {
    return { ok: false, detail: `could not reach Supabase: ${String(e).slice(0, 160)}` };
  }
}
