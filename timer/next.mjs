// Prints what the timer will start in the next 24 hours, using the Worker's own plan(). Starts nothing.
import { readFileSync } from "node:fs";
import { plan } from "./worker.js";

const congress = /CONGRESS_ENABLED = "true"/.test(readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8")) ? "true" : "false";
const pacific = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
const out = [];
const t0 = Math.ceil(Date.now() / 60000) * 60000;
for (let m = 0; m < 24 * 60; m++) {
  const at = new Date(t0 + m * 60000);
  for (const j of plan(at, { CONGRESS_ENABLED: congress })) out.push(`${pacific(at)} Pacific: ${j.repo.split("/")[1]}${j.inputs.slot ? ` slot ${j.inputs.slot}` : ""}`);
}
console.log(process.env.GITHUB_ACTIONS ? `::notice title=Next starts::${out.join(" | ")}` : out.join("\n"));
