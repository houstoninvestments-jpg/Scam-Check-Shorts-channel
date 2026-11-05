import { describe, expect, it } from "vitest";
import { totalsFor } from "../src/learn/index";

const uploader = (handler: (metrics: string) => Response) =>
  ({ token: async () => "t", fetch: async (url: string) => handler(new URL(url).searchParams.get("metrics")!) }) as any;
const ok = (headers: string[], row: (string | number)[]) => new Response(JSON.stringify({ columnHeaders: headers.map((name) => ({ name })), rows: [row] }), { status: 200 });

describe("swiped away, from views vs engaged views", () => {
  it("views counts every start; engaged views the ones that stayed", async () => {
    const t = await totalsFor(uploader(() => ok(["video", "views", "engagedViews", "averageViewPercentage", "averageViewDuration"], ["abc", 40, 10, 61.234, 18])), "abc", "2026-11-01", "2026-11-05");
    expect(t).toEqual({ views: 40, engagedViews: 10, viewedPct: 25, averageViewPercentage: 61.2, averageViewDuration: 18 });
  });

  it("if the API refuses engaged views, the rest still comes back", async () => {
    const t = await totalsFor(
      uploader((m) => (m.includes("engagedViews") ? new Response("Unknown identifier (engagedViews)", { status: 400 }) : ok(["video", "views", "averageViewPercentage", "averageViewDuration"], ["abc", 20, 70, 21]))),
      "abc",
      "2026-11-01",
      "2026-11-05",
    );
    expect(t).toMatchObject({ views: 20, engagedViews: null, viewedPct: null, averageViewPercentage: 70 });
  });
});
