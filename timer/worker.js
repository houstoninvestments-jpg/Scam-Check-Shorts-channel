// Cloudflare Worker that starts each channel's posting slots on time (GitHub's own schedule runs hours late).
// It only asks GitHub to start the daily job. It holds one GitHub key (GH_DISPATCH_TOKEN) that can do
// nothing but start Actions jobs in these two repos. 35 minutes after each Scam or Not slot it also starts
// the slot watch, which emails if that slot never started.

const SCAM = { repo: "houstoninvestments-jpg/Scam-Check-Shorts-channel", workflow: "daily.yml" };
const WATCH = { repo: SCAM.repo, workflow: "slot-watch.yml" };
const CONGRESS = { repo: "houstoninvestments-jpg/congress-receipts", workflow: "daily.yml" };

// Scam or Not: 7:20am, 12:20pm and 5:20pm Pacific, through daylight saving changes.
const SCAM_SLOTS = { "07:20": 1, "12:20": 2, "17:20": 3 };
// Congress Receipts: its schedule as written in its workflow, in UTC: 16:37, 21:37 and 02:37.
const CONGRESS_UTC_HOURS = [16, 21, 2];

const pacific = (d, opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", ...opts }).format(d);

/** Which jobs start at this scheduled minute. */
export function plan(at, env = {}) {
  const jobs = [];
  if (at.getUTCMinutes() === 20) {
    const clock = pacific(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const slot = SCAM_SLOTS[clock];
    if (slot) jobs.push({ ...SCAM, inputs: { slot: String(slot), slot_date: pacific(at) } });
  }
  if (at.getUTCMinutes() === 55) {
    // 35 minutes after each Scam or Not slot: the watch emails if the slot never started.
    const clock = pacific(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (SCAM_SLOTS[clock.replace(/:55$/, ":20")]) jobs.push({ ...WATCH, inputs: {} });
  }
  if (at.getUTCMinutes() === 37 && CONGRESS_UTC_HOURS.includes(at.getUTCHours()) && env.CONGRESS_ENABLED === "true") {
    jobs.push({ ...CONGRESS, inputs: {} });
  }
  return jobs;
}

async function dispatch(env, job) {
  const res = await fetch(`https://api.github.com/repos/${job.repo}/actions/workflows/${job.workflow}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "scam-or-not-timer",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: job.inputs }),
  });
  const detail = res.ok ? "started" : `refused ${res.status}: ${(await res.text()).slice(0, 200)}`;
  console.log(`${job.repo} ${JSON.stringify(job.inputs)}: ${detail}`);
  return res.ok;
}

export default {
  async scheduled(controller, env, ctx) {
    // scheduledTime is the planned minute, not the moment the Worker woke up.
    for (const job of plan(new Date(controller.scheduledTime), env)) ctx.waitUntil(dispatch(env, job));
  },
  async fetch(req, env) {
    // A read-only status page: what the timer would start in the next 24 hours. Starts nothing.
    const now = Date.now();
    const upcoming = [];
    for (let m = 0; m < 24 * 60; m++) {
      const at = new Date(Math.ceil(now / 60000) * 60000 + m * 60000);
      for (const j of plan(at, env)) upcoming.push(`${at.toISOString()}  ${j.repo}  ${JSON.stringify(j.inputs)}`);
    }
    return new Response(`Scam or Not timer\nCongress Receipts enabled: ${env.CONGRESS_ENABLED === "true"}\nNext 24 hours:\n${upcoming.join("\n")}\n`, { headers: { "content-type": "text/plain" } });
  },
};
