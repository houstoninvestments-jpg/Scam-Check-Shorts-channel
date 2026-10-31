import { describe, expect, it } from "vitest";
import { speakable, numberWords, yearWords } from "../src/voice/speak";
import { captionChunks } from "../src/render/timeline";

describe("the voice reads numbers as words", () => {
  it("money", () => {
    expect(speakable("$1,000,000")).toBe("one million dollars");
    expect(speakable("$299")).toBe("two hundred ninety-nine dollars");
    expect(speakable("$4.99")).toBe("four dollars and ninety-nine cents");
    expect(speakable("$1")).toBe("one dollar");
    expect(speakable("$0.50")).toBe("fifty cents");
    expect(speakable("$1.01")).toBe("one dollar and one cent");
    expect(speakable("$12.50 fee")).toBe("twelve dollars and fifty cents fee");
    expect(speakable("$2.5 million")).toBe("two point five million dollars");
    expect(speakable("$5K")).toBe("five thousand dollars");
    expect(speakable("Pay $1,500 now.")).toBe("Pay one thousand five hundred dollars now.");
    expect(speakable("They want $2,350.75 in gift cards")).toBe("They want two thousand three hundred fifty dollars and seventy-five cents in gift cards");
  });

  it("percents, years, phone numbers, codes and plain numbers", () => {
    expect(speakable("Get 15% back")).toBe("Get fifteen percent back");
    expect(speakable("a 2.5% fee")).toBe("a two point five percent fee");
    expect(speakable("since 2026")).toBe("since twenty twenty-six");
    expect(yearWords(2005)).toBe("two thousand five");
    expect(yearWords(1999)).toBe("nineteen ninety-nine");
    expect(yearWords(1905)).toBe("nineteen oh five");
    expect(speakable("Call (202) 555-0199 today")).toBe("Call two zero two, five five five, zero one nine nine today");
    expect(speakable("Call 1-800-555-0199")).toBe("Call one, eight zero zero, five five five, zero one nine nine");
    expect(speakable("Your code is 482913.")).toBe("Your code is four eight two nine one three.");
    expect(speakable("3 signs it's a scam")).toBe("three signs it's a scam");
    expect(speakable("the 1st of 2 notices")).toBe("the first of two notices");
    expect(speakable("in 24 hours")).toBe("in twenty-four hours");
    expect(numberWords(1234567)).toBe("one million two hundred thirty-four thousand five hundred sixty-seven");
    expect(speakable("No numbers here.")).toBe("No numbers here.");
  });

  it("captions keep the written words, timed by how long each takes to say", () => {
    const c = captionChunks({ id: "flag1", text: "They want $4.99 now", file: "x", duration: 2 }, 0, 4);
    expect(c.map((x: any) => x.text).join(" ")).toBe("They want $4.99 now");
  });
});

describe("the video bundler", () => {
  it("resolves our .js imports to .ts files (the captions import the spoken-words code)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolveTsFromJs } = await import("../src/render/bundler");
    expect((resolveTsFromJs({ resolve: {} }) as any).resolve.extensionAlias[".js"]).toContain(".ts");
    for (const f of ["src/render/index.ts", "src/render/covers.ts"]) expect(readFileSync(f, "utf8")).toMatch(/bundle\(\{[^}]*webpackOverride: resolveTsFromJs/);
  });
});
