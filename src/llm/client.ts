import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { path, readJson, sha, writeJson } from "../lib/util.js";

export interface JsonCall<T extends z.ZodType> {
  role: string; // "writer" | "checker-a" | "checker-b" (names the fixture in dry-run)
  model: string;
  system: string;
  user: string;
  schema: T;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface LLM {
  json<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>>;
  readonly mode: "live" | "fixture";
  /** Every model call so far with its tokens and dollar cost (empty for fixture runs). */
  readonly calls?: CallCost[];
}

export interface CallCost {
  role: string;
  model: string; // the model that actually served it (a fallback can differ from the one asked for)
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  usd: number;
}

type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };
let prices: Record<string, Price> | undefined;
const priceFor = (model: string): Price | undefined => {
  prices ??= readJson<{ models: Record<string, Price> }>(path("config/pricing.json")).models;
  return prices[model] ?? prices[Object.keys(prices).find((k) => model.startsWith(k)) ?? ""];
};

/** Dollar cost of one usage block at list prices. Unknown models cost NaN so they show up instead of hiding as $0. */
export function usageCost(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const p = priceFor(model);
  if (!p) return NaN;
  const m = 1_000_000;
  return ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead) / m;
}

/** Sum of a run's calls: total dollars plus a short per-role line for the run notes. */
export function costSummary(calls: CallCost[]) {
  const usd = calls.reduce((a, c) => a + c.usd, 0);
  const byRole: Record<string, { calls: number; usd: number }> = {};
  for (const c of calls) {
    const r = (byRole[c.role.replace(/-retry$/, "")] ??= { calls: 0, usd: 0 });
    r.calls++;
    r.usd += c.usd;
  }
  return {
    usd: +usd.toFixed(4),
    calls: calls.length,
    inputTokens: calls.reduce((a, c) => a + c.inputTokens + c.cacheWriteTokens + c.cacheReadTokens, 0),
    outputTokens: calls.reduce((a, c) => a + c.outputTokens, 0),
    byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, { calls: v.calls, usd: +v.usd.toFixed(4) }])),
    models: [...new Set(calls.map((c) => c.model))],
  };
}

/**
 * Live client. Uses structured output so every answer is schema-valid JSON,
 * and server-side fallbacks so a safety-classifier decline reroutes instead of failing the day.
 */
export class AnthropicLLM implements LLM {
  readonly mode = "live" as const;
  readonly calls: CallCost[] = [];
  private client = new Anthropic();

  async json<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
    const res = await this.client.beta.messages.parse({
      model: call.model,
      max_tokens: 16000,
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      output_config: { format: betaZodOutputFormat(call.schema), effort: call.effort ?? "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    this.record(call.role, res.model ?? call.model, res.usage as any);
    if (res.stop_reason === "refusal") throw new Error(`${call.role}: model declined (${res.stop_details?.category ?? "no category"})`);
    if (res.stop_reason === "max_tokens") throw new Error(`${call.role}: output cut off at max_tokens`);
    if (!res.parsed_output) throw new Error(`${call.role}: no parseable output`);
    return call.schema.parse(res.parsed_output);
  }

  /**
   * Log tokens and cost. When a fallback model finished the turn, usage.iterations lists each model's
   * share; price each one at its own rate. Otherwise price the whole call at the served model's rate.
   */
  private record(role: string, model: string, usage: any) {
    const parts: { model: string; u: any }[] = Array.isArray(usage?.iterations) && usage.iterations.every((it: any) => it?.model && typeof it.output_tokens === "number")
      ? usage.iterations.map((it: any) => ({ model: it.model, u: it }))
      : [{ model, u: usage ?? {} }];
    for (const { model: m, u } of parts) {
      this.calls.push({
        role,
        model: m,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        usd: usageCost(m, u),
      });
    }
  }
}

/**
 * Dry-run client. Replays a saved answer per role from fixtures/llm/<scenario>/<role>.json.
 * It never pretends to be live: the pipeline labels every dry-run artifact as fixture-driven.
 * Set RECORD_FIXTURES=1 with a live key to capture new fixtures.
 */
export class FixtureLLM implements LLM {
  readonly mode = "fixture" as const;
  constructor(private scenario: string) {}

  async json<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
    const file = path("fixtures/llm", this.scenario, `${call.role}.json`);
    const saved = readJson<{ output: unknown }>(file);
    return call.schema.parse(saved.output);
  }
}

export class RecordingLLM implements LLM {
  readonly mode = "live" as const;
  constructor(private inner: LLM, private scenario: string) {}
  get calls() {
    return this.inner.calls;
  }
  async json<T extends z.ZodType>(call: JsonCall<T>): Promise<z.infer<T>> {
    const output = await this.inner.json(call);
    writeJson(path("fixtures/llm", this.scenario, `${call.role}.json`), {
      recordedAt: new Date().toISOString(),
      model: call.model,
      promptHash: sha(call.system + call.user),
      output,
    });
    return output;
  }
}
