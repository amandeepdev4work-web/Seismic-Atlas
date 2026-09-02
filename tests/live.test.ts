import { describe, expect, it } from "vitest";
import {
  findNewQuakes,
  parseQuakeGeojson,
  quakeKey,
  quakeKeys,
} from "@/lib/live";
import { parseQuakeCsv } from "@/lib/csv";
import type { QuakeFeature } from "@/lib/types";

/** One feed feature, USGS-shaped, with whatever is being varied overridden. */
function feedFeature(
  overrides: {
    properties?: Record<string, unknown>;
    coordinates?: unknown;
    type?: unknown;
  } = {},
) {
  return {
    type: "Feature",
    id: "us7000tdfa",
    properties: {
      mag: 4.6,
      place: "78 km ENE of Mutsu, Japan",
      time: 1_788_290_483_337,
      ...overrides.properties,
    },
    geometry: {
      type: overrides.type ?? "Point",
      coordinates: overrides.coordinates ?? [142.0502, 41.6191, 74.021],
    },
  };
}

function collection(features: unknown[]) {
  return { type: "FeatureCollection", features };
}

describe("parseQuakeGeojson — the happy path", () => {
  it("turns a feed feature into the same shape parseQuakeCsv produces", () => {
    const { features, errors, skippedRows } = parseQuakeGeojson(
      collection([feedFeature()]),
    );

    expect(errors).toEqual([]);
    expect(skippedRows).toBe(0);
    expect(features).toHaveLength(1);
    expect(features[0]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [142.0502, 41.6191] },
      properties: {
        mag: 4.6,
        place: "78 km ENE of Mutsu, Japan",
        time: "2026-09-01T19:21:23.337Z",
        depth: 74.021,
      },
    });
  });

  it("reads depth from the third coordinate, not from a property", () => {
    const { features } = parseQuakeGeojson(
      collection([
        feedFeature({
          coordinates: [10, 20, 645.026],
          properties: { depth: 999 },
        }),
      ]),
    );

    expect(features[0].properties.depth).toBe(645.026);
  });

  it("keeps feed order", () => {
    const { features } = parseQuakeGeojson(
      collection([
        feedFeature({ properties: { mag: 5 } }),
        feedFeature({ properties: { mag: 6 } }),
        feedFeature({ properties: { mag: 7 } }),
      ]),
    );

    expect(features.map((f) => f.properties.mag)).toEqual([5, 6, 7]);
  });

  it("produces a feature identical to the CSV parser's for the same event", () => {
    const csv = [
      "time,latitude,longitude,depth,mag,place",
      '2026-09-01T19:21:23.337Z,41.6191,142.0502,74.021,4.6,"78 km ENE of Mutsu, Japan"',
    ].join("\n");

    const fromCsv = parseQuakeCsv(csv).features[0];
    const fromFeed = parseQuakeGeojson(collection([feedFeature()])).features[0];

    // The whole reason the adapter converts epoch to ISO: the two paths have
    // to describe the same earthquake the same way, or the delta below is
    // meaningless the first time a live fetch follows the sample.
    expect(fromFeed).toEqual(fromCsv);
    expect(quakeKey(fromFeed)).toBe(quakeKey(fromCsv));
  });
});

describe("parseQuakeGeojson — the document itself", () => {
  it("reports a non-collection once, having skipped nothing", () => {
    const result = parseQuakeGeojson({ type: "Feature" });

    expect(result.features).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not json"],
    ["an array", [1, 2, 3]],
    ["a features field that is not an array", { features: "nope" }],
  ])("refuses %s without throwing", (_label, input) => {
    expect(() => parseQuakeGeojson(input)).not.toThrow();
    expect(parseQuakeGeojson(input).features).toEqual([]);
  });

  it("accepts an empty collection as an empty result, not an error", () => {
    expect(parseQuakeGeojson(collection([]))).toEqual({
      features: [],
      errors: [],
      skippedRows: 0,
    });
  });
});

describe("parseQuakeGeojson — the same row rules as the CSV parser (D4/D5)", () => {
  it("skips a feature with no magnitude, and says so", () => {
    const { features, errors, skippedRows } = parseQuakeGeojson(
      collection([feedFeature({ properties: { mag: null } })]),
    );

    expect(features).toEqual([]);
    expect(skippedRows).toBe(1);
    expect(errors[0]).toBe("Feature 1 skipped — mag is missing.");
  });

  it("skips a non-numeric magnitude and quotes what it got", () => {
    const { errors } = parseQuakeGeojson(
      collection([feedFeature({ properties: { mag: "big" } })]),
    );

    expect(errors[0]).toBe('Feature 1 skipped — mag is not a number (got "big").');
  });

  it("skips out-of-range latitude and longitude", () => {
    const { features, errors } = parseQuakeGeojson(
      collection([
        feedFeature({ coordinates: [10, 95] }),
        feedFeature({ coordinates: [200, 10] }),
      ]),
    );

    expect(features).toEqual([]);
    expect(errors[0]).toContain("latitude 95 is outside the valid range");
    expect(errors[1]).toContain("longitude 200 is outside the valid range");
  });

  it("skips a feature that is not a point", () => {
    const { features, errors } = parseQuakeGeojson(
      collection([
        feedFeature({ type: "Polygon", coordinates: [[[0, 0]]] }),
      ]),
    );

    expect(features).toEqual([]);
    expect(errors[0]).toBe("Feature 1 skipped — it is not a GeoJSON point.");
  });

  it.each([
    ["missing geometry", { type: "Feature", properties: { mag: 5 } }],
    ["null geometry", { type: "Feature", geometry: null, properties: { mag: 5 } }],
    ["a one-element coordinate array", feedFeature({ coordinates: [10] })],
    ["coordinates that are not an array", feedFeature({ coordinates: "10,20" })],
    ["a NaN coordinate", feedFeature({ coordinates: [Number.NaN, 20, 5] })],
    ["a null feature", null],
  ])("skips %s rather than throwing", (_label, entry) => {
    const result = parseQuakeGeojson(collection([entry]));

    expect(result.features).toEqual([]);
    expect(result.skippedRows).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it("keeps the good features alongside the bad, numbering by feed position", () => {
    const { features, errors, skippedRows } = parseQuakeGeojson(
      collection([
        feedFeature({ properties: { mag: 5.1 } }),
        feedFeature({ properties: { mag: null } }),
        feedFeature({ properties: { mag: 6.2 } }),
      ]),
    );

    expect(features.map((f) => f.properties.mag)).toEqual([5.1, 6.2]);
    expect(skippedRows).toBe(1);
    expect(errors[0]).toContain("Feature 2 skipped");
  });

  it("falls back on the cosmetic fields rather than losing the quake", () => {
    const { features } = parseQuakeGeojson(
      collection([
        feedFeature({
          coordinates: [142.0502, 41.6191],
          properties: { place: null, time: null },
        }),
      ]),
    );

    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({
      place: "Unknown location",
      time: "",
      depth: 0,
    });
  });

  it("treats a blank place as no place at all", () => {
    const { features } = parseQuakeGeojson(
      collection([feedFeature({ properties: { place: "   " } })]),
    );

    expect(features[0].properties.place).toBe("Unknown location");
  });

  it("drops an unusable timestamp to the empty string", () => {
    const { features } = parseQuakeGeojson(
      collection([feedFeature({ properties: { time: "yesterday" } })]),
    );

    expect(features[0].properties.time).toBe("");
  });

  it("accepts a magnitude of zero, which is a number and not a blank", () => {
    const { features } = parseQuakeGeojson(
      collection([feedFeature({ properties: { mag: 0 } })]),
    );

    expect(features[0].properties.mag).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

/** A minimal feature, built from the parts `quakeKey` actually reads. */
function quake(
  time: string,
  lng: number,
  lat: number,
  mag: number,
): QuakeFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { mag, place: "Somewhere", time, depth: 10 },
  };
}

const A = quake("2026-09-01T00:00:00.000Z", 100, 10, 5);
const B = quake("2026-09-01T01:00:00.000Z", 101, 11, 5.5);
const C = quake("2026-09-01T02:00:00.000Z", 102, 12, 6);

describe("quakeKey", () => {
  it("gives the same key to two objects describing the same event", () => {
    expect(quakeKey(A)).toBe(quakeKey(quake(A.properties.time, 100, 10, 5)));
  });

  it.each([
    ["time", quake("2026-09-01T00:00:00.001Z", 100, 10, 5)],
    ["longitude", quake("2026-09-01T00:00:00.000Z", 100.1, 10, 5)],
    ["latitude", quake("2026-09-01T00:00:00.000Z", 100, 10.1, 5)],
    ["magnitude", quake("2026-09-01T00:00:00.000Z", 100, 10, 5.1)],
  ])("separates events differing only in %s", (_label, other) => {
    expect(quakeKey(other)).not.toBe(quakeKey(A));
  });

  it("collects a whole fetch into a set, deduplicating identical events", () => {
    const keys = quakeKeys([A, B, quake(A.properties.time, 100, 10, 5)]);
    expect(keys.size).toBe(2);
    expect(keys.has(quakeKey(A))).toBe(true);
  });
});

describe("findNewQuakes", () => {
  it("returns only the quakes absent from the previous set", () => {
    expect(findNewQuakes(quakeKeys([A, B]), [A, B, C])).toEqual([C]);
  });

  it("returns the very same objects, in input order", () => {
    const fresh = findNewQuakes(quakeKeys([A]), [B, C]);

    expect(fresh).toHaveLength(2);
    expect(fresh[0]).toBe(B);
    expect(fresh[1]).toBe(C);
  });

  it("finds nothing when the two fetches are identical", () => {
    expect(findNewQuakes(quakeKeys([A, B, C]), [A, B, C])).toEqual([]);
  });

  it("finds nothing when the previous set is empty — the first-load rule", () => {
    expect(findNewQuakes(new Set<string>(), [A, B, C])).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("treats %s as no history, so nothing is new", (_label, previous) => {
    expect(findNewQuakes(previous, [A, B, C])).toEqual([]);
  });

  it("finds nothing in an empty fetch, whatever the history", () => {
    expect(findNewQuakes(quakeKeys([A, B]), [])).toEqual([]);
  });

  it("does not care that quakes disappeared from the feed", () => {
    // The month window rolls, so old events drop off every cycle. Only
    // arrivals are interesting; departures are not an event of any kind.
    expect(findNewQuakes(quakeKeys([A, B, C]), [C])).toEqual([]);
  });

  it("matches an event across the CSV and GeoJSON paths", () => {
    const csv = [
      "time,latitude,longitude,depth,mag,place",
      '2026-09-01T19:21:23.337Z,41.6191,142.0502,74.021,4.6,"78 km ENE of Mutsu, Japan"',
    ].join("\n");

    const sample = parseQuakeCsv(csv).features;
    const feed = parseQuakeGeojson(
      collection([feedFeature(), feedFeature({ properties: { mag: 6.9 } })]),
    ).features;

    // The Mutsu quake is in both, so only the second one is new. This is the
    // handoff the whole key design exists for.
    const fresh = findNewQuakes(quakeKeys(sample), feed);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].properties.mag).toBe(6.9);
  });
});
