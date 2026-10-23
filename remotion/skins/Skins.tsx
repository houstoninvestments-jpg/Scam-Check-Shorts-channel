import React from "react";
import { Circle, FakeQr, MarkedBody, type Marks } from "../Marks";
import type { SkinId } from "../../src/types";

export interface SkinProps {
  sender: string;
  subject: string;
  body: string;
  hasQr: boolean;
  marks: Marks;
  progress: number;
  time: string;
}

/**
 * Pick a body font size that fits the message in the space a skin has.
 * area: usable text area in px^2; each character takes about 0.68 * size^2 with line height.
 */
export function fitFont(body: string, area: number, hasQr: boolean, max = 44, min = 28): number {
  const usable = hasQr ? area - 200 * 640 : area;
  const size = Math.sqrt(usable / (Math.max(body.length, 40) * 0.56 * 1.25));
  return Math.round(Math.max(min, Math.min(max, size)));
}

/** Generic, logo-free app chrome. Each skin hints at a kind of app without copying any brand. */

const Status: React.FC<{ dark?: boolean; time: string }> = ({ dark, time }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "26px 44px 10px", fontSize: 28, fontWeight: 600, color: dark ? "#fff" : "#111" }}>
    <span>{time}</span>
    <span style={{ letterSpacing: 4 }}>▮▮▮ ◔</span>
  </div>
);

const Avatar: React.FC<{ label: string; bg: string; size?: number; color?: string }> = ({ label, bg, size = 96, color = "#fff" }) => (
  <div style={{ width: size, height: size, borderRadius: size, background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700 }}>{label}</div>
);

const Qr: React.FC<SkinProps> = ({ hasQr, marks, progress }) =>
  hasQr ? (
    <div style={{ marginTop: 22, display: "flex" }}>
      <Circle state={marks.attachment} progress={progress} radius={28}>
        <span style={{ display: "inline-block", padding: 10 }}>
          <FakeQr size={160} />
        </span>
      </Circle>
    </div>
  ) : null;

const Sender: React.FC<{ p: SkinProps; style?: React.CSSProperties }> = ({ p, style }) => (
  <span style={style}>
    <Circle state={p.marks.sender} progress={p.progress}>
      {p.sender}
    </Circle>
  </span>
);

// 1. Blue-bubble style texting app
const IMessage: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#fff", height: "100%", color: "#111" }}>
    <Status time={p.time} />
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0 24px", borderBottom: "1px solid #e5e5ea", background: "#f7f7f8" }}>
      <Avatar label="?" bg="#9aa0a8" size={78} />
      <Sender p={p} style={{ fontSize: 30, fontWeight: 600 }} />
    </div>
    <div style={{ textAlign: "center", color: "#8e8e93", fontSize: 24, margin: "18px 0 14px" }}>Text Message · Today {p.time}</div>
    <div style={{ padding: "0 36px" }}>
      <div style={{ background: "#e9e9eb", borderRadius: 38, padding: "26px 30px", maxWidth: "94%", fontSize: fitFont(p.body, 640 * 600, p.hasQr), lineHeight: 1.3 }}>
        <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
        <Qr {...p} />
      </div>
    </div>
  </div>
);

// 2. Generic Android-style messages app
const Android: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#fbfcff", height: "100%", color: "#1a1c1e" }}>
    <Status time={p.time} />
    <div style={{ display: "flex", alignItems: "center", gap: 22, padding: "14px 32px 22px", borderBottom: "1px solid #e1e3e8" }}>
      <span style={{ fontSize: 40 }}>←</span>
      <Avatar label="#" bg="#5b6b8c" size={76} />
      <Sender p={p} style={{ fontSize: 32, fontWeight: 600 }} />
    </div>
    <div style={{ textAlign: "center", color: "#74777f", fontSize: 24, margin: "26px 0 18px" }}>SMS · {p.time}</div>
    <div style={{ padding: "0 32px" }}>
      <div style={{ background: "#e8ebf2", borderRadius: "34px 34px 34px 10px", padding: "26px 30px", maxWidth: "94%", fontSize: fitFont(p.body, 640 * 600, p.hasQr), lineHeight: 1.3 }}>
        <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
        <Qr {...p} />
      </div>
    </div>
  </div>
);

// 3. Email inbox
const Email: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#fff", height: "100%", color: "#111" }}>
    <Status time={p.time} />
    <div style={{ padding: "10px 40px 0", fontSize: 30, color: "#6b7280" }}>‹ Inbox</div>
    <div style={{ padding: "22px 40px 18px", fontSize: 42, fontWeight: 800, lineHeight: 1.2 }}>{p.subject || "(no subject)"}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "0 40px 22px", borderBottom: "1px solid #eee" }}>
      <Avatar label="!" bg="#8b93a1" size={72} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Sender p={p} style={{ fontSize: 28, fontWeight: 700 }} />
        <span style={{ fontSize: 24, color: "#6b7280" }}>to me · {p.time}</span>
      </div>
    </div>
    <div style={{ padding: "28px 40px", fontSize: fitFont(p.body, 700 * 560, p.hasQr), lineHeight: 1.34 }}>
      <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
      <Qr {...p} />
    </div>
  </div>
);

// 4. Voicemail with transcript
const Voicemail: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#111316", height: "100%", color: "#fff" }}>
    <Status dark time={p.time} />
    <div style={{ padding: "16px 40px 0", fontSize: 44, fontWeight: 800 }}>Voicemail</div>
    <div style={{ margin: "26px 32px 0", background: "#1d2026", borderRadius: 30, padding: "28px 30px" }}>
      <Sender p={p} style={{ fontSize: 32, fontWeight: 700 }} />
      <div style={{ fontSize: 24, color: "#9aa0a8", marginTop: 6 }}>Today {p.time} · 0:38</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 24, height: 60 }}>
        <span style={{ fontSize: 40, marginRight: 14 }}>▶</span>
        {Array.from({ length: 34 }, (_, i) => (
          <span key={i} style={{ width: 8, borderRadius: 4, background: "#5d6470", height: 12 + ((i * 37) % 44) }} />
        ))}
      </div>
      <div style={{ fontSize: 24, color: "#9aa0a8", margin: "26px 0 10px", letterSpacing: 2, fontWeight: 700 }}>TRANSCRIPT</div>
      <div style={{ fontSize: fitFont(p.body, 650 * 520, false), lineHeight: 1.34 }}>
        <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
      </div>
    </div>
  </div>
);

// 5. Buy-and-sell marketplace chat
const Marketplace: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#fff", height: "100%", color: "#111" }}>
    <Status time={p.time} />
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 32px 18px", borderBottom: "1px solid #e4e6eb" }}>
      <span style={{ fontSize: 40 }}>←</span>
      <Avatar label="B" bg="#7a8699" size={72} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Sender p={p} style={{ fontSize: 30, fontWeight: 700 }} />
        <span style={{ fontSize: 22, color: "#65676b" }}>Marketplace · about your listing</span>
      </div>
    </div>
    <div style={{ display: "flex", gap: 18, alignItems: "center", margin: "20px 32px", padding: 16, border: "1px solid #e4e6eb", borderRadius: 18 }}>
      <div style={{ width: 90, height: 90, background: "#d8dbe0", borderRadius: 12 }} />
      <div style={{ fontSize: 26 }}>
        <div style={{ fontWeight: 700 }}>Your listing</div>
        <div style={{ color: "#65676b" }}>Available</div>
      </div>
    </div>
    <div style={{ padding: "0 32px" }}>
      <div style={{ background: "#f0f2f5", borderRadius: 34, padding: "26px 30px", maxWidth: "94%", fontSize: fitFont(p.body, 640 * 560, p.hasQr), lineHeight: 1.3 }}>
        <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
        <Qr {...p} />
      </div>
    </div>
  </div>
);

// 6. Social app direct message (message request)
const Dm: React.FC<SkinProps> = (p) => (
  <div style={{ background: "#000", height: "100%", color: "#fff" }}>
    <Status dark time={p.time} />
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 32px 20px", borderBottom: "1px solid #262626" }}>
      <span style={{ fontSize: 40 }}>‹</span>
      <Avatar label="@" bg="#3a3f47" size={72} />
      <Sender p={p} style={{ fontSize: 30, fontWeight: 700 }} />
    </div>
    <div style={{ textAlign: "center", color: "#a8a8a8", fontSize: 24, margin: "22px 0" }}>Message request · They don't follow you</div>
    <div style={{ padding: "0 32px" }}>
      <div style={{ background: "#262626", borderRadius: 34, padding: "26px 30px", maxWidth: "94%", fontSize: fitFont(p.body, 640 * 560, p.hasQr), lineHeight: 1.3 }}>
        <MarkedBody body={p.body} marks={p.marks} progress={p.progress} />
        <Qr {...p} />
      </div>
    </div>
  </div>
);

export const SKINS: Record<SkinId, React.FC<SkinProps>> = {
  imessage: IMessage,
  android: Android,
  email: Email,
  voicemail: Voicemail,
  marketplace: Marketplace,
  dm: Dm,
};
