import { describe, expect, it } from "vitest";
import { computeStats } from "@/lib/stats";
import type { QuakeFeature } from "@/lib/types";

/** Minimal well-formed feature; only the fields under test vary. */
function quake(
  mag: number,
  depth: number,
  place = "Somewhere",
): QuakeFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { mag, depth, place, time: "2026-09-01T00:00:00.000Z" },
  };
}

describe("computeStats", () => {
  it("counts the features and finds the max magnitude with its place", () => {
    const stats = computeStats([
      quake(4.6, 74, "78 km ENE of Mutsu, Japan"),
      quake(7.1, 12, "105 km SSE of Sand Point, Alaska"),
      quake(5.2, 122, "118 km SSE of Isangel, Vanuatu"),
    ]);

    expect(stats.count).toBe(3);
    expect(stats.maxMag).toBe(7.1);
    expect(stats.maxMagPlace).toBe("105 km SSE of Sand Point, Alaska");
  });

  it("reports the depth range across the set", () => {
    const stats = computeStats([
      quake(4.9, 122.461),
      quake(5.4, 8.2),
      quake(6.0, 645),
      quake(4.5, 33),
    ]);

    expect(stats.minDepth).toBe(8.2);
    expect(stats.maxDepth).toBe(645);
  });

  it("keeps a zero depth rather than treating it as missing", () => {
    const stats = computeStats([quake(5.0, 0), quake(5.1, 40)]);

    expect(stats.minDepth).toBe(0);
    expect(stats.maxDepth).toBe(40);
  });

  it("handles a single feature, where the range collapses to one value", () => {
    const stats = computeStats([quake(6.3, 55, "Null Island")]);

    expect(stats).toEqual({
      count: 1,
      maxMag: 6.3,
      maxMagPlace: "Null Island",
      minDepth: 55,
      maxDepth: 55,
    });
  });

  it("keeps the first feature when two share the max magnitude", () => {
    const stats = computeStats([
      quake(5.0, 10, "First"),
      quake(6.8, 20, "Winner"),
      quake(6.8, 30, "Later tie"),
    ]);

    expect(stats.maxMag).toBe(6.8);
    expect(stats.maxMagPlace).toBe("Winner");
  });

  it("returns nulls for an empty set without throwing", () => {
    const stats = computeStats([]);

    expect(stats).toEqual({
      count: 0,
      maxMag: null,
      maxMagPlace: null,
      minDepth: null,
      maxDepth: null,
    });
  });

  it("ignores non-finite values instead of poisoning every aggregate", () => {
    const stats = computeStats([
      quake(Number.NaN, Number.NaN, "Broken"),
      quake(5.5, 60, "Good"),
    ]);

    // The broken row still counts as a feature — it was plotted — but it
    // must not become the maximum or blank the depth range.
    expect(stats.count).toBe(2);
    expect(stats.maxMag).toBe(5.5);
    expect(stats.maxMagPlace).toBe("Good");
    expect(stats.minDepth).toBe(60);
    expect(stats.maxDepth).toBe(60);
  });
});
