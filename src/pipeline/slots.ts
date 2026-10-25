import { config } from "../lib/config.js";

/**
 * GitHub's schedule runs in UTC and has no daylight saving. Each Pacific slot is scheduled twice
 * (the PDT and the PST hour); only the firing whose time is the slot's Pacific time goes ahead.
 * The time used is the scheduled one, not the start time, so a late start never shifts a slot.
 */

const pacificClock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** The most recent instant at or before `now` that matches a daily "M H * * *" cron (UTC). */
export function scheduledInstant(cron: string, now: Date): Date {
  const [m, h] = cron.trim().split(/\s+/).map(Number);
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  if (at.getTime() > now.getTime()) at.setUTCDate(at.getUTCDate() - 1);
  return at;
}

export function slotFor(cron: string, now = new Date(), slots = config().cadence.slots): { go: boolean; slot?: number; why: string } {
  const at = scheduledInstant(cron, now);
  const clock = pacificClock(at);
  const hit = slots.find((s) => s.pacific === clock);
  return hit
    ? { go: true, slot: hit.slot, why: `cron ${cron} = ${clock} Pacific: slot ${hit.slot}` }
    : { go: false, why: `cron ${cron} = ${clock} Pacific today: not a slot (this is the other side of daylight saving)` };
}

/** Every UTC cron line needed so each Pacific slot fires in both summer and winter time. */
export function cronLines(slots = config().cadence.slots): string[] {
  const out: string[] = [];
  for (const s of slots) {
    const [h, m] = s.pacific.split(":").map(Number);
    for (const offset of [7, 8]) out.push(`${m} ${(h + offset) % 24} * * *`);
  }
  return out;
}
