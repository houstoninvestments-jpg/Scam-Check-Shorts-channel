import React from "react";
import { C } from "./theme";

export type MarkState = "off" | "active" | "done";

export interface Marks {
  sender: MarkState;
  attachment: MarkState;
  link: MarkState;
  text: { match: string; state: MarkState; n: number }[];
}

/** The red circle drawn around a red flag. It hugs each line of wrapped text. */
export const Circle: React.FC<{ state: MarkState; progress: number; children: React.ReactNode; radius?: number }> = ({ state, progress, children, radius = 22 }) => {
  if (state === "off") return <>{children}</>;
  const a = state === "active" ? Math.min(1, progress * 3) : 0.85;
  return (
    <span
      style={{
        border: `6px solid rgba(255, 59, 48, ${a})`,
        borderRadius: radius,
        padding: "0 8px",
        margin: "0 -8px",
        background: state === "active" ? C.redTint : "transparent",
        WebkitBoxDecorationBreak: "clone",
        boxDecorationBreak: "clone",
      }}
    >
      {children}
    </span>
  );
};

/** Render the message body with any circled phrases. */
export const MarkedBody: React.FC<{ body: string; marks: Marks; progress: number; style?: React.CSSProperties }> = ({ body, marks, progress, style }) => {
  const ranges = marks.text
    .map((m) => ({ ...m, at: m.match ? body.indexOf(m.match) : -1 }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const parts: React.ReactNode[] = [];
  let i = 0;
  ranges.forEach((r, k) => {
    if (r.at < i) return; // overlapping circles: keep the first
    if (r.at > i) parts.push(body.slice(i, r.at));
    parts.push(
      <Circle key={k} state={r.state} progress={progress}>
        {r.match}
      </Circle>,
    );
    i = r.at + r.match.length;
  });
  parts.push(body.slice(i));
  return <div style={{ whiteSpace: "pre-wrap", ...style }}>{parts}</div>;
};

/** A fake QR pattern. It has no data in it and cannot be scanned. */
export const FakeQr: React.FC<{ size: number; seed?: number }> = ({ size, seed = 7 }) => {
  const n = 25;
  const cell = size / n;
  let s = seed;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const finderOn = (x: number, y: number) => {
    const fx = x >= n - 7 ? x - (n - 7) : x;
    const fy = y >= n - 7 ? y - (n - 7) : y;
    return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
  };
  const rects: React.ReactNode[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const on = finder(x, y) ? finderOn(x, y) : rand() > 0.52;
      if (on) rects.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.5} height={cell + 0.5} fill="#111" />);
    }
  return (
    <svg width={size} height={size} style={{ background: "#fff", padding: cell, boxSizing: "content-box", borderRadius: 12 }}>
      {rects}
    </svg>
  );
};
