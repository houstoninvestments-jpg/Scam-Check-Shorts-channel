import { describe, expect, it } from "vitest";
import { check, mechanicalCheck, sanitizeMessage } from "../src/checker";
import { fakeLLM, fixtureLead, fixtureScript } from "./helpers";

const ok = { verdict: "scam", confidence: 0.9, problems: [] };

describe("mechanical gate", () => {
  it("passes the fixture script", () => {
    expect(mechanicalCheck(fixtureScript(), fixtureLead())).toEqual({ ok: true, problems: [] });
  });

  it("rejects a quote that is not word for word in the source", () => {
    const s = fixtureScript();
    s.flags[0].evidence.quote = "The message says you must scan it right away to pay.";
    expect(mechanicalCheck(s, fixtureLead()).problems.join()).toMatch(/quote not found/);
  });

  it("rejects a link that is not one of the sources", () => {
    const s = fixtureScript();
    s.safeMove.evidence.url = "https://example.org/other";
    expect(mechanicalCheck(s, fixtureLead()).problems.join()).toMatch(/not one of the sources/);
  });

  it("rejects reading the scam message aloud", () => {
    const s = fixtureScript();
    s.flags[1].say = "It says unpaid cases face default judgment, fines, and enforcement action.";
    expect(mechanicalCheck(s, fixtureLead()).problems.join()).toMatch(/repeats \d+ words of the scam message/);
  });

  it("rejects a circle that does not land on the message", () => {
    const s = fixtureScript();
    s.flags[2].target.match = "not in the text";
    expect(mechanicalCheck(s, fixtureLead()).problems.join()).toMatch(/circle text/);
  });

  it("rejects long or hard sentences", () => {
    const s = fixtureScript();
    s.flags[0].say = "This particular communication demonstrates unmistakable characteristics associated with sophisticated fraudulent impersonation operations targeting unsuspecting individuals everywhere today.";
    expect(mechanicalCheck(s, fixtureLead()).problems.join()).toMatch(/readability/);
  });

  it("swaps real links and phone numbers out of verbatim messages", () => {
    const s = fixtureScript();
    s.message.provenance = "verbatim";
    s.message.body = "Pay now at https://real-toll-pay.com/x or call 202-456-1111.";
    const out = sanitizeMessage(s);
    expect(out.message.body).toBe("Pay now at scam-link.example or call (202) 555-0199.");
    expect(out.message.provenanceNote).toMatch(/swapped for safety/);
    expect(mechanicalCheck(out, fixtureLead()).problems.join()).not.toMatch(/real-looking/);
  });
});

describe("two independent reviews", () => {
  it("passes only when both agree it is a scam", async () => {
    const r = await check(fakeLLM({ "checker-a": ok, "checker-b": ok }) as any, fixtureScript(), fixtureLead());
    expect(r.pass).toBe(true);
  });

  it("skips when the second review is unsure", async () => {
    const r = await check(fakeLLM({ "checker-a": ok, "checker-b": { verdict: "unsure", confidence: 0.5, problems: [] } }) as any, fixtureScript(), fixtureLead());
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/disagree or unsure/);
  });

  it("skips when either review lists a problem", async () => {
    const r = await check(fakeLLM({ "checker-a": ok, "checker-b": { ...ok, problems: ["flag 2 overstates the source"] } }) as any, fixtureScript(), fixtureLead());
    expect(r.pass).toBe(false);
  });

  it("skips low confidence", async () => {
    const r = await check(fakeLLM({ "checker-a": { ...ok, confidence: 0.6 }, "checker-b": ok }) as any, fixtureScript(), fixtureLead());
    expect(r.pass).toBe(false);
  });

  it("never calls the models when the mechanical gate fails", async () => {
    const s = fixtureScript();
    s.flags[0].evidence.quote = "made up words that are not there";
    const llm = fakeLLM({});
    const r = await check(llm as any, s, fixtureLead());
    expect(r.pass).toBe(false);
    expect(llm.calls).toEqual([]);
  });
});
