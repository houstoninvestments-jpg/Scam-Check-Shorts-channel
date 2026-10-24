import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { path } from "../lib/util.js";

/** The approved favicon design (red stamp with a question mark on near-black). */
export const FAVICON_SOURCE = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#0A0C0F'/><g transform='rotate(-10 32 32)'><rect x='10' y='10' width='44' height='44' rx='8' fill='none' stroke='#FF3B30' stroke-width='5'/><text x='32' y='46' text-anchor='middle' font-family='Inter' font-weight='800' font-size='40' fill='#FF3B30'>?</text></g></svg>`;

/**
 * The "?" from Inter ExtraBold (800) at 40px as a vector path, placed where the source SVG puts it:
 * centred on x=32, sitting on the baseline at y=46. No font needed to show the final icon.
 */
async function questionMarkPath(): Promise<string> {
  const font = readFileSync(path("node_modules/@fontsource/inter/files/inter-latin-800-normal.woff"));
  const svg = await satori({ type: "div", props: { style: { display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 40, color: "#FF3B30", lineHeight: 1 }, children: "?" } } as any, {
    width: 64,
    height: 64,
    fonts: [{ name: "Inter", data: font, weight: 800, style: "normal" }],
  });
  const d = svg.match(/<path[^>]*d="([^"]+)"/)?.[1];
  if (!d) throw new Error("could not turn the question mark into a path");
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), maxX = Math.max(...xs), maxY = Math.max(...ys);
  // The dot of "?" sits on the baseline, so its lowest point is the baseline.
  const dx = +(32 - (minX + maxX) / 2).toFixed(3);
  const dy = +(46 - maxY).toFixed(3);
  return `<path transform='translate(${dx} ${dy})' d='${d}' fill='#FF3B30'/>`;
}

export async function faviconSvg(): Promise<string> {
  const glyph = await questionMarkPath();
  return FAVICON_SOURCE.replace(/<text[^>]*>\?<\/text>/, glyph);
}

export function pngAt(svg: string, size: number): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
}

/** A .ico holding PNG images (supported by every current browser). */
export function icoFrom(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/** Writes favicon.svg, favicon.ico (16, 32, 48) and apple-touch-icon.png (180) into the site folder. */
export async function writeFavicons(dir: string) {
  mkdirSync(dir, { recursive: true });
  const svg = await faviconSvg();
  writeFileSync(join(dir, "favicon.svg"), svg);
  writeFileSync(join(dir, "favicon.ico"), icoFrom([16, 32, 48].map((size) => ({ size, data: pngAt(svg, size) }))));
  writeFileSync(join(dir, "apple-touch-icon.png"), pngAt(svg, 180));
  return svg;
}
