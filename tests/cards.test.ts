import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardText, excerpt, renderDefaultCard, renderScamCard, scamCardModel } from "../src/site/cards";
import { fixtureScript, tmp } from "./helpers";

const pngSize = (f: string) => {
  const b = readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe("share cards", () => {
  it("renders a 1200x630 scam card small enough for WhatsApp previews", async () => {
    const f = await renderScamCard({ number: 12, script: fixtureScript() }, join(tmp(), "c.png"));
    expect(pngSize(f)).toEqual({ w: 1200, h: 630 });
    expect(statSync(f).size).toBeLessThan(300 * 1024);
  });

  it("renders the site-wide default card", async () => {
    const f = await renderDefaultCard(join(tmp(), "d.png"));
    expect(pngSize(f)).toEqual({ w: 1200, h: 630 });
  });

  it("carries the question only: no verdict, flags or safe move", () => {
    const m = scamCardModel({ number: 3, script: fixtureScript() });
    expect(Object.keys(m).sort()).toEqual(["number", "sender", "text"]);
    const s = fixtureScript();
    for (const f of s.flags) expect(m.text).not.toContain(f.say);
    expect(m.text).not.toContain(s.safeMove.say);
  });

  it("trims long messages at a word and drops characters the font can't draw", () => {
    const e = excerpt("word ".repeat(80));
    expect(e.length).toBeLessThanOrEqual(121);
    expect(e.endsWith("…")).toBe(true);
    expect(e).not.toMatch(/wor…$/);
    expect(cardText("Pay now 🚗 → today")).toBe("Pay now today");
  });
});
