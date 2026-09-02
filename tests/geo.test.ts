import { describe, expect, it } from "vitest";
import type { Feature, Polygon, Position } from "geojson";
import { countPointsInPolygon } from "@/lib/geo";
import type { QuakeFeature } from "@/lib/types";

/** Minimal well-formed feature; only the position under test varies. */
function quake(lng: number, lat: number, place = "Somewhere"): QuakeFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { mag: 5, depth: 10, place, time: "2026-09-01T00:00:00.000Z" },
  };
}

/** An axis-aligned box, closed the way GeoJSON wants it. */
function box(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  };
}

/** The square the "clearly inside / clearly outside" cases are read against. */
const SQUARE = box(0, 0, 10, 10);

describe("countPointsInPolygon", () => {
  it("counts points clearly inside the square", () => {
    const result = countPointsInPolygon(
      [quake(5, 5), quake(1, 9), quake(9.9, 0.1)],
      SQUARE,
    );

    expect(result.inside).toBe(3);
    expect(result.insideFeatures).toHaveLength(3);
  });

  it("excludes points clearly outside the square", () => {
    const result = countPointsInPolygon(
      [quake(-5, 5), quake(20, 20), quake(5, -0.5), quake(10.5, 5)],
      SQUARE,
    );

    expect(result.inside).toBe(0);
    expect(result.insideFeatures).toEqual([]);
  });

  it("counts only the inside half of a mixed set, keeping input order", () => {
    const inside = quake(2, 2, "in");
    const outside = quake(40, 40, "out");
    const alsoInside = quake(8, 8, "also in");

    const result = countPointsInPolygon([inside, outside, alsoInside], SQUARE);

    expect(result.inside).toBe(2);
    // The very same objects, in the order they were given — the layer that
    // draws the selection needs the features, not copies of them.
    expect(result.insideFeatures).toEqual([inside, alsoInside]);
    expect(result.insideFeatures[0]).toBe(inside);
  });

  // Some rule has to be picked and stated, because coordinates land on an
  // edge often enough to matter. Turf's default is that the line is inside,
  // which is the friendlier answer for a shape a user just drew around the
  // points they wanted.
  describe("a point on the boundary", () => {
    it("counts a point on an edge as inside", () => {
      expect(countPointsInPolygon([quake(10, 5)], SQUARE).inside).toBe(1);
      expect(countPointsInPolygon([quake(0, 5)], SQUARE).inside).toBe(1);
      expect(countPointsInPolygon([quake(5, 0)], SQUARE).inside).toBe(1);
    });

    it("counts a point on a vertex as inside", () => {
      expect(countPointsInPolygon([quake(0, 0)], SQUARE).inside).toBe(1);
      expect(countPointsInPolygon([quake(10, 10)], SQUARE).inside).toBe(1);
    });

    it("splits a hair either side of an edge", () => {
      expect(countPointsInPolygon([quake(9.999999, 5)], SQUARE).inside).toBe(1);
      expect(countPointsInPolygon([quake(10.000001, 5)], SQUARE).inside).toBe(0);
    });
  });

  describe("nothing to count", () => {
    it("returns 0 for an empty feature set", () => {
      const result = countPointsInPolygon([], SQUARE);
      expect(result.inside).toBe(0);
      expect(result.insideFeatures).toEqual([]);
    });

    it("returns 0 for a null or undefined polygon without throwing", () => {
      expect(countPointsInPolygon([quake(5, 5)], null).inside).toBe(0);
      expect(countPointsInPolygon([quake(5, 5)], undefined).inside).toBe(0);
    });

    it("returns 0 for null or undefined features", () => {
      expect(countPointsInPolygon(null, SQUARE).inside).toBe(0);
      expect(countPointsInPolygon(undefined, SQUARE).inside).toBe(0);
    });

    // Every one of these makes turf throw if handed to it raw. A shape that
    // is still half-drawn is the ordinary state of a drawing tool.
    it("returns 0 for a polygon with no rings", () => {
      const empty: Polygon = { type: "Polygon", coordinates: [] };
      expect(countPointsInPolygon([quake(5, 5)], empty).inside).toBe(0);
    });

    it("returns 0 for an empty ring", () => {
      const empty: Polygon = { type: "Polygon", coordinates: [[]] };
      expect(countPointsInPolygon([quake(5, 5)], empty).inside).toBe(0);
    });

    it("returns 0 for a ring with too few corners to enclose anything", () => {
      const line: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 10],
          ],
        ],
      };
      expect(countPointsInPolygon([quake(5, 5)], line).inside).toBe(0);
    });

    it("returns 0 for a ring holding a non-numeric coordinate", () => {
      const broken = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, Number.NaN],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      } as Polygon;
      expect(countPointsInPolygon([quake(5, 5)], broken).inside).toBe(0);
    });

    it("skips a feature with a non-numeric coordinate rather than throwing", () => {
      const broken = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number.NaN, 5] },
        properties: { mag: 5, depth: 10, place: "?", time: "" },
      } as QuakeFeature;

      expect(countPointsInPolygon([broken, quake(5, 5)], SQUARE).inside).toBe(1);
    });
  });

  describe("shapes the caller might hand over", () => {
    it("accepts a Feature wrapper as well as a bare geometry", () => {
      const wrapped: Feature<Polygon> = {
        type: "Feature",
        properties: {},
        geometry: SQUARE,
      };
      expect(countPointsInPolygon([quake(5, 5)], wrapped).inside).toBe(1);
    });

    it("closes a ring whose last position does not repeat its first", () => {
      const unclosed: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };
      expect(
        countPointsInPolygon([quake(5, 5), quake(20, 20)], unclosed).inside,
      ).toBe(1);
    });

    it("counts across both parts of a MultiPolygon", () => {
      const multi = {
        type: "MultiPolygon" as const,
        coordinates: [SQUARE.coordinates, box(40, 40, 50, 50).coordinates],
      };
      const result = countPointsInPolygon(
        [quake(5, 5), quake(45, 45), quake(25, 25)],
        multi,
      );
      expect(result.inside).toBe(2);
    });

    it("does not count a point inside a hole", () => {
      const holed: Polygon = {
        type: "Polygon",
        coordinates: [
          SQUARE.coordinates[0],
          [
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
            [4, 4],
          ],
        ],
      };
      expect(
        countPointsInPolygon([quake(5, 5), quake(1, 1)], holed).inside,
      ).toBe(1);
    });

    // A self-touching outline is what a hurried drag produces, and turf
    // answers it by the even-odd rule rather than complaining. This one is a
    // bow tie: the two diagonals cross at (5, 5), leaving a lobe either side
    // of the crossing and nothing enclosed above or below it.
    it("handles a concave, self-touching outline without throwing", () => {
      const bowtie: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10],
            [0, 0],
          ],
        ],
      };
      const result = countPointsInPolygon(
        [
          quake(5, 2, "below the crossing"),
          quake(2, 5, "left lobe"),
          quake(8, 5, "right lobe"),
          quake(5, 8, "above the crossing"),
        ],
        bowtie,
      );
      expect(result.inside).toBe(2);
      expect(
        result.insideFeatures.map((feature) => feature.properties.place),
      ).toEqual(["left lobe", "right lobe"]);
    });
  });

  // A web map repeats the world sideways and Draw records what was clicked,
  // so a box across the date line arrives as 170…190 while the quakes it
  // visibly encloses are stored at -175. Same place, different number.
  describe("across the antimeridian", () => {
    const acrossTheLine = box(170, -10, 190, 10);

    it("counts a point stored west of the date line", () => {
      expect(countPointsInPolygon([quake(-175, 0)], acrossTheLine).inside).toBe(
        1,
      );
    });

    it("still counts a point stored east of it", () => {
      expect(countPointsInPolygon([quake(175, 0)], acrossTheLine).inside).toBe(
        1,
      );
    });

    it("counts nothing that is genuinely elsewhere", () => {
      const result = countPointsInPolygon(
        [quake(0, 0), quake(-100, 0), quake(140, 0)],
        acrossTheLine,
      );
      expect(result.inside).toBe(0);
    });

    it("works the other way round, on the western copy of the world", () => {
      const westernCopy = box(-190, -10, -170, 10);
      expect(countPointsInPolygon([quake(175, 0)], westernCopy).inside).toBe(1);
      expect(countPointsInPolygon([quake(-175, 0)], westernCopy).inside).toBe(1);
    });

    it("counts a wrapped point exactly once", () => {
      // A box wide enough to hold both a point's real longitude and its
      // shifted one would double-count it if the loop did not stop at the
      // first hit.
      const wide = box(-200, -10, 200, 10);
      const result = countPointsInPolygon([quake(0, 0)], wide);
      expect(result.inside).toBe(1);
      expect(result.insideFeatures).toHaveLength(1);
    });
  });

  it("counts a regional selection out of a global set", () => {
    const features: QuakeFeature[] = [];
    // A grid over Japan, plus a scattering of decoys elsewhere.
    for (let lng = 130; lng <= 142; lng += 3) {
      for (let lat = 30; lat <= 42; lat += 3) features.push(quake(lng, lat));
    }
    const decoys: Position[] = [
      [-70, -30],
      [0, 0],
      [-150, 60],
      [160, -20],
    ];
    for (const [lng, lat] of decoys) features.push(quake(lng, lat));

    const result = countPointsInPolygon(features, box(129, 29, 143, 43));

    expect(features).toHaveLength(29);
    expect(result.inside).toBe(25);
  });
});
