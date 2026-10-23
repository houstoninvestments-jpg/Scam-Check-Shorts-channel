import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShortProps } from "./props";
import type { Beat, BeatId } from "../src/render/timeline";
import { C, fontFamily } from "./theme";
import { SKINS } from "./skins/Skins";
import type { Marks, MarkState } from "./Marks";

const pad3 = (n: number) => String(n).padStart(3, "0");

function beatAt(beats: Beat[], frame: number): Beat | undefined {
  return beats.find((b) => frame >= b.from && frame < b.to);
}

const FLAGS: BeatId[] = ["flag1", "flag2", "flag3"];

function markState(beats: Beat[], frame: number, i: number): MarkState {
  const b = beats.find((x) => x.id === FLAGS[i])!;
  const closer = beats.find((x) => x.id === "tail")!;
  if (frame < b.from || frame >= closer.from) return "off"; // marks clear for the tail so the last frame matches the first
  return frame < b.to ? "active" : "done";
}

const Headline: React.FC<{ children: React.ReactNode; local: number; color?: string; size?: number }> = ({ children, local, color = C.ink, size = 76 }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 10 });
  return (
    <div style={{ fontSize: size, fontWeight: 900, lineHeight: 1.08, color, textAlign: "center", opacity: s, transform: `translateY(${(1 - s) * 24}px)`, letterSpacing: -1 }}>
      {children}
    </div>
  );
};

export const ScamShort: React.FC<ShortProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { beats, captions } = p.timeline;
  const beat = beatAt(beats, frame);
  const get = (id: BeatId) => beats.find((b) => b.id === id)!;
  const local = beat ? frame - beat.from : 0;
  const progress = beat ? local / Math.max(1, beat.to - beat.from) : 0;

  const marks: Marks = { sender: "off", attachment: "off", link: "off", text: [] };
  p.script.flags.forEach((f, i) => {
    const st = markState(beats, frame, i);
    if (f.target.kind === "text") marks.text.push({ match: f.target.match, state: st, n: i + 1 });
    else if (f.target.kind === "sender") marks.sender = st === "off" ? marks.sender : st;
    else if (f.target.kind === "attachment") marks.attachment = st === "off" ? marks.attachment : st;
    else if (f.target.kind === "link") {
      const url = p.script.message.body.match(/\b[\w-]+(\.[\w-]+)+(\/\S*)?/)?.[0] ?? "";
      if (url) marks.text.push({ match: url, state: st, n: i + 1 });
    }
  });

  const Skin = SKINS[p.skin];
  const stamp = get("stamp");
  const tail = get("tail");
  const stampOn = frame >= stamp.from && frame < tail.from;
  const stampIn = spring({ frame: frame - stamp.from, fps, config: { damping: 11, stiffness: 180, mass: 0.6 } });
  // After the flags start, the stamp shrinks into the corner so it never hides the circles.
  const flag1 = get("flag1");
  const dock = interpolate(frame, [flag1.from, flag1.from + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });

  const countdown = get("countdown");
  const inCountdown = frame >= countdown.from && frame < countdown.to;
  const cdN = 3 - Math.floor((frame - countdown.from) / fps);
  const cdLocal = (frame - countdown.from) % fps;

  // Loop: fade every overlay out during the tail so the final frame equals frame 0.
  const overlay = interpolate(frame, [tail.from, tail.to - 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const caption = captions.find((c) => frame >= c.from && frame < c.to);
  const flagIdx = beat ? FLAGS.indexOf(beat.id) : -1;

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily, color: C.ink }}>
      {/* soft neutral light behind the phone */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 45% at 50% 52%, #1d222a 0%, rgba(10,12,15,0) 70%)" }} />

      {/* top bar */}
      <div style={{ position: "absolute", top: 92, left: 64, right: 64, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2 }}>SCAM #{pad3(p.number)}</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: C.dim, border: `2px solid ${C.faint}`, borderRadius: 40, padding: "6px 16px" }}>{p.voiceLabel}</div>
      </div>
      {p.script.message.provenance === "recreated" ? (
        <div style={{ position: "absolute", top: 156, left: 64, fontSize: 26, color: C.dim, fontWeight: 500 }}>Recreated from {p.sourceName} warnings</div>
      ) : null}
      {p.testLabel ? (
        <div style={{ position: "absolute", top: 156, right: 64, fontSize: 26, color: "#111", background: "#FFD60A", fontWeight: 800, borderRadius: 8, padding: "2px 12px" }}>{p.testLabel}</div>
      ) : null}

      {/* headline zone */}
      <div style={{ position: "absolute", top: 222, left: 60, right: 60, height: 200, display: "flex", alignItems: "center", justifyContent: "center", opacity: overlay }}>
        {beat?.id === "hook" ? <Headline local={local}>{p.script.hook}</Headline> : null}
        {beat?.id === "countdown" ? <Headline local={local} size={96}>Real or scam?</Headline> : null}
        {beat?.id === "stamp" ? <Headline local={local} color={C.red} size={96}>SCAM</Headline> : null}
        {flagIdx >= 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 4, color: C.red }}>RED FLAG {flagIdx + 1}</div>
            <Headline local={local} size={84}>{p.script.flags[flagIdx].label}</Headline>
          </div>
        ) : null}
        {beat?.id === "safe" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 4, color: C.dim }}>SAFE MOVE</div>
            <Headline local={local} size={80}>{p.script.safeMove.label}</Headline>
          </div>
        ) : null}
        {beat?.id === "closer" ? <Headline local={local} size={70}>{p.closer}</Headline> : null}
      </div>

      {/* phone */}
      <div style={{ position: "absolute", top: 430, left: 130, width: 820, height: 1060, borderRadius: 84, background: C.bezel, padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.55)" }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 64, overflow: "hidden", position: "relative" }}>
          <Skin sender={p.script.message.sender} subject={p.script.message.subject} body={p.script.message.body} hasQr={p.script.message.hasQr} marks={marks} progress={progress} time="9:41" />
          {/* dim the screen during the countdown */}
          {inCountdown ? <AbsoluteFill style={{ background: "rgba(0,0,0,0.55)" }} /> : null}
        </div>
      </div>

      {/* 3-2-1 */}
      {inCountdown && cdN >= 1 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: 0 }}>
          <div
            style={{
              fontSize: 360,
              fontWeight: 900,
              color: C.ink,
              transform: `scale(${interpolate(cdLocal, [0, 6, fps], [1.35, 1, 0.92], { extrapolateRight: "clamp" })})`,
              opacity: interpolate(cdLocal, [0, 2, fps - 4, fps], [0.3, 1, 1, 0.2], { extrapolateRight: "clamp" }),
              textShadow: "0 10px 40px rgba(0,0,0,0.6)",
            }}
          >
            {cdN}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* SCAM stamp: slams in over the phone, then docks small at the phone's top-right corner */}
      {stampOn ? (
        <div
          style={{
            position: "absolute",
            left: interpolate(dock, [0, 1], [540, 868]),
            top: interpolate(dock, [0, 1], [930, 468]),
            transform: `translate(-50%, -50%) rotate(-12deg) scale(${interpolate(stampIn, [0, 1], [2.4, 1]) * interpolate(dock, [0, 1], [1, 0.36])})`,
            opacity: Math.min(1, stampIn * 1.5) * overlay,
            border: `16px solid ${C.red}`,
            borderRadius: 30,
            color: C.red,
            fontSize: 230,
            fontWeight: 900,
            padding: "0 40px",
            letterSpacing: 10,
            background: "rgba(10,12,15,0.86)",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          SCAM
        </div>
      ) : null}

      {/* captions */}
      {caption ? (
        <div style={{ position: "absolute", top: 1518, left: 70, right: 70, textAlign: "center", opacity: overlay }}>
          <span style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.15, color: C.ink, background: "rgba(0,0,0,0.78)", borderRadius: 16, padding: "6px 18px", WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" }}>
            {caption.text}
          </span>
        </div>
      ) : null}

      {/* call to action, only in the closer, only when this video carries one */}
      {beat?.id === "closer" && p.cta !== "none" ? (
        <div style={{ position: "absolute", top: 1640, left: 80, right: 80, textAlign: "center", fontSize: p.cta === "direct" ? 42 : 34, fontWeight: 700, color: p.cta === "direct" ? C.ink : C.dim }}>
          {p.cta === "direct" ? "Can you catch all 3? Play today's round. Link on our channel." : "Daily 3-text round: link on our channel."}
        </div>
      ) : null}

      {/* audio */}
      {beats
        .filter((b) => b.audio)
        .map((b) => (
          <Sequence key={b.id} from={b.from} durationInFrames={b.to - b.from}>
            <Audio src={staticFile(b.audio!)} />
          </Sequence>
        ))}
      {[0, 1, 2].map((i) => (
        <Sequence key={`tick${i}`} from={countdown.from + i * fps} durationInFrames={10}>
          <Audio src={staticFile("tick.wav")} volume={0.6} />
        </Sequence>
      ))}
      <Sequence from={stamp.from} durationInFrames={20}>
        <Audio src={staticFile("stamp.wav")} volume={0.8} />
      </Sequence>
    </AbsoluteFill>
  );
};
