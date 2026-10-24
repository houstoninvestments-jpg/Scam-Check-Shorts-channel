import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Episode } from "../types.js";
import { path } from "../lib/util.js";

/** Share preview cards (Open Graph). Built from code at site build time with free, offline tools. */

export const CARD_W = 1200;
export const CARD_H = 630;

const C = { bg: "#0A0C0F", ink: "#FFFFFF", dim: "#A9B0BA", bubble: "#ECEDF0", bubbleInk: "#0D0F12", red: "#FF3B30" };

let fonts: { name: string; data: Buffer; weight: 400 | 600 | 800 | 900; style: "normal" }[] | undefined;
function loadFonts() {
  fonts ??= ([400, 600, 800, 900] as const).map((weight) => ({
    name: "Inter",
    data: readFileSync(path(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`)),
    weight,
    style: "normal" as const,
  }));
  return fonts;
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: { style: { display: "flex", boxSizing: "border-box", ...style }, children: children.length === 1 ? children[0] : children },
});

/** Keep only characters the bundled Latin font can draw; drop emoji and other scripts rather than show boxes. */
export function cardText(s: string) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ–—…\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Cut long messages at a word boundary so the card text stays big enough to read in a chat preview. */
export function excerpt(body: string, max = 120) {
  const flat = cardText(body).replace(/\s*\n\s*/g, " · ");
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s·,.;:-]+$/, "") + "…";
}

/** Bigger type for shorter messages: a chat preview shows the card about 300 pixels wide. */
export function excerptSize(text: string) {
  if (text.length <= 70) return 54;
  if (text.length <= 100) return 48;
  return 44;
}

const stamp = (size: number) =>
  h(
    "div",
    {
      flexDirection: "column",
      marginRight: 18,
      alignItems: "center",
      border: `10px solid ${C.red}`,
      borderRadius: 26,
      color: C.red,
      background: C.bg,
      padding: "14px 28px 10px",
      transform: "rotate(-7deg)",
      fontSize: size,
      fontWeight: 900,
      lineHeight: 0.98,
      letterSpacing: 1,
    },
    h("div", {}, "REAL OR"),
    h("div", {}, "SCAM?"),
  );

const brand = () =>
  h(
    "div",
    { alignItems: "center", gap: 14 },
    h("div", { width: 18, height: 18, borderRadius: 9, background: C.ink }),
    h("div", { fontSize: 34, fontWeight: 800, color: C.ink }, "Scam or Not"),
  );

const frame = (...children: unknown[]) =>
  h(
    "div",
    { width: CARD_W, height: CARD_H, background: C.bg, padding: "44px 60px 42px", fontFamily: "Inter", color: C.ink, flexDirection: "column", justifyContent: "space-between" },
    ...children,
  );

/** The model behind a scam card: the question only. No verdict, no flags, no safe move. */
export function scamCardModel(ep: Pick<Episode, "number" | "script">) {
  return { number: ep.number, sender: cardText(ep.script.message.sender), text: excerpt(ep.script.message.body) };
}

function scamCardTree(m: ReturnType<typeof scamCardModel>): Node {
  return frame(
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", width: 1080 },
      h(
        "div",
        { flexDirection: "column", gap: 12 },
        h("div", { fontSize: 50, fontWeight: 900, letterSpacing: 3 }, `SCAM #${String(m.number).padStart(3, "0")}`),
        h("div", { fontSize: 28, color: C.dim, fontWeight: 600 }, `From: ${m.sender}`),
      ),
      stamp(60),
    ),
    h(
      "div",
      { width: 1080, background: C.bubble, color: C.bubbleInk, borderRadius: "34px 34px 34px 8px", padding: "22px 30px", fontSize: excerptSize(m.text), fontWeight: 600, lineHeight: 1.22 },
      m.text,
    ),
    h("div", { justifyContent: "space-between", alignItems: "center", width: 1080 }, brand(), h("div", { fontSize: 30, fontWeight: 700, color: C.dim }, "Would you tap it?")),
  );
}

function defaultCardTree(): Node {
  return frame(
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", width: 1080 },
      h("div", { fontSize: 100, fontWeight: 900, lineHeight: 1.0, letterSpacing: -1 }, "Scam or Not"),
      stamp(64),
    ),
    h("div", { fontSize: 46, fontWeight: 600, color: C.dim, lineHeight: 1.22, width: 1000 }, "One real scam text a day. Can you spot it in 3 seconds?"),
    h(
      "div",
      { background: C.bubble, color: C.bubbleInk, borderRadius: "30px 30px 30px 8px", padding: "20px 28px", fontSize: 42, fontWeight: 700 },
      "Today's round: 3 texts. Real or scam?",
    ),
  );
}

async function toPng(tree: Node): Promise<Buffer> {
  const svg = await satori(tree as any, { width: CARD_W, height: CARD_H, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: CARD_W } }).render().asPng());
}

function save(file: string, png: Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  return file;
}

export async function renderScamCard(ep: Pick<Episode, "number" | "script">, file: string) {
  return save(file, await toPng(scamCardTree(scamCardModel(ep))));
}

export async function renderDefaultCard(file: string) {
  return save(file, await toPng(defaultCardTree()));
}
