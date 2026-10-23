import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lead, Script } from "../src/types";
import { path, readJson } from "../src/lib/util";
import { buildLeads } from "../src/scout/rank";

export const tmp = () => mkdtempSync(join(tmpdir(), "son-"));

export function fixtureLead(): Lead {
  const doc = readJson<any>(path("fixtures/sources/ftc-traffic-qr.json"));
  return buildLeads([doc], {}, { maxAgeDays: 3650 })[0];
}

export function fixtureScript(): Script {
  return structuredClone(readJson<any>(path("fixtures/llm/traffic-qr/writer.json")).output);
}

/** A fake model: returns canned outputs per role. */
export function fakeLLM(outputs: Record<string, unknown>) {
  return {
    mode: "fixture" as const,
    calls: [] as string[],
    async json(call: any) {
      this.calls.push(call.role);
      if (!(call.role in outputs)) throw new Error(`no fake output for ${call.role}`);
      return call.schema.parse(outputs[call.role]);
    },
  };
}
