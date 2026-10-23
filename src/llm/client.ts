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
}

/**
 * Live client. Uses structured output so every answer is schema-valid JSON,
 * and server-side fallbacks so a safety-classifier decline reroutes instead of failing the day.
 */
export class AnthropicLLM implements LLM {
  readonly mode = "live" as const;
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
    if (res.stop_reason === "refusal") throw new Error(`${call.role}: model declined (${res.stop_details?.category ?? "no category"})`);
    if (res.stop_reason === "max_tokens") throw new Error(`${call.role}: output cut off at max_tokens`);
    if (!res.parsed_output) throw new Error(`${call.role}: no parseable output`);
    return call.schema.parse(res.parsed_output);
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
