import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Inter (SIL Open Font License), served from the render's own folder so no network is needed.
export const fontFamily = "Inter";
loadFont({ family: fontFamily, url: staticFile("inter.woff2"), weight: "100 900" });

/** Red is reserved for the verdict and the red flags. Everything else stays neutral and high contrast. */
export const C = {
  bg: "#0A0C0F",
  ink: "#FFFFFF",
  dim: "#A9B0BA",
  faint: "#6B7380",
  red: "#FF3B30",
  redTint: "rgba(255, 59, 48, 0.14)",
  safe: "#FFFFFF",
  bezel: "#1B1E23",
};

export const W = 1080;
export const H = 1920;
