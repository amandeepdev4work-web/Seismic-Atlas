import type { ParseResult, QuakeFeature } from "./types";

/**
 * The live feed. The GeoJSON summary rather than the CSV one: it is the same
 * events, it is cached ~1 minute against the CSV's ~5, and it already arrives
 * as a FeatureCollection — which is the internal format anyway (D2), so the
 * adapter below is a validation pass rather than a parse.
 */
export const LIVE_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson";

/** How often the feed is re-fetched while live data is showing. */
export const REFRESH_INTERVAL_MS = 60_000;

/**
 * Turns the USGS GeoJSON feed into the very same `QuakeFeature[]` the CSV
 * parser produces — same four properties, same fallbacks, same skip rules.
 *
 * Pure by design, like `parseQuakeCsv`: no DOM, no fetch, no globals. It takes
 * `unknown` because the input is a parsed network response and nothing has
 * checked it yet; every shape assumption below is therefore made explicitly.
 *
 * The validation *rules* are D4/D5's, deliberately restated rather than shared
 * with `lib/csv.ts`: that parser reads string cells out of papaparse rows and
 * every one of its helpers is written around that, so reusing it would mean
 * turning numbers back into strings to have them parsed again. What must not
 * drift is the outcome, and the outcome is the contract the tests pin:
 * `latitude`, `longitude` and `mag` decide where a point is and how big it is,
 * so a bad one skips the feature; `depth`, `place` and `time` are cosmetic and
 * fall back to `0`, `"Unknown location"` and `""`.
 *
 * Two details of the feed's own shape:
 * - depth is the **third coordinate**, not a property.
 * - `time` is epoch milliseconds, and is converted to the ISO 8601 UTC string
 *   the CSV feed spells out. That is what keeps a live feature and a sample
 *   feature for the same earthquake identical — see {@link quakeKey}.
 */
export function parseQuakeGeojson(input: unknown): ParseResult {
  const collection = input as { features?: unknown } | null | undefined;
  const raw = collection?.features;

  // A fault in the document, not in any one feature — reported once, having
  // skipped nothing, exactly as an incomplete column mapping is (D16).
  if (!Array.isArray(raw)) {
    return {
      features: [],
      errors: ["The feed did not return a GeoJSON FeatureCollection."],
      skippedRows: 0,
    };
  }

  const features: QuakeFeature[] = [];
  const errors: string[] = [];

  raw.forEach((entry, index) => {
    // 1-based, and named "Feature" rather than "Row": there is no header line
    // to offset past and no line number to point the reader at.
    const checked = checkFeature(entry);

    if (!checked.ok) {
      errors.push(`Feature ${index + 1} skipped — ${checked.problems.join("; ")}.`);
      return;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [checked.longitude, checked.latitude],
      },
      properties: {
        mag: checked.mag,
        place: checked.place,
        time: checked.time,
        depth: checked.depth,
      },
    });
  });

  return { features, errors, skippedRows: errors.length };
}

type FeatureCheck =
  | {
      ok: true;
      latitude: number;
      longitude: number;
      mag: number;
      depth: number;
      place: string;
      time: string;
    }
  | { ok: false; problems: string[] };

function checkFeature(entry: unknown): FeatureCheck {
  const feature = entry as
    | { geometry?: unknown; properties?: unknown }
    | null
    | undefined;

  const geometry = feature?.geometry as
    | { type?: unknown; coordinates?: unknown }
    | null
    | undefined;

  if (!geometry || geometry.type !== "Point") {
    return { ok: false, problems: ["it is not a GeoJSON point"] };
  }

  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { ok: false, problems: ["its coordinates are missing"] };
  }

  const problems: string[] = [];
  const longitude = finite(coordinates[0]);
  const latitude = finite(coordinates[1]);

  const properties = (feature?.properties ?? {}) as Record<string, unknown>;
  const mag = finite(properties.mag);

  if (latitude === null) problems.push(explain("latitude", coordinates[1]));
  else if (Math.abs(latitude) > 90) {
    problems.push(`latitude ${latitude} is outside the valid range of -90 to 90`);
  }

  if (longitude === null) problems.push(explain("longitude", coordinates[0]));
  else if (Math.abs(longitude) > 180) {
    problems.push(
      `longitude ${longitude} is outside the valid range of -180 to 180`,
    );
  }

  if (mag === null) problems.push(explain("mag", properties.mag));

  if (
    latitude === null ||
    longitude === null ||
    mag === null ||
    problems.length > 0
  ) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    latitude,
    longitude,
    mag,
    // The third coordinate is depth in km. Cosmetic, so it falls back (D4).
    depth: finite(coordinates[2]) ?? 0,
    place:
      typeof properties.place === "string" && properties.place.trim() !== ""
        ? properties.place.trim()
        : "Unknown location",
    time: isoTime(properties.time),
  };
}

/** `null` for anything that is not a real number; numeric strings are taken. */
function finite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function explain(field: string, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") {
    return `${field} is missing`;
  }
  return `${field} is not a number (got "${String(raw)}")`;
}

/**
 * Epoch milliseconds → the ISO 8601 UTC string the CSV feed writes. Anything
 * else becomes `""`, the same fallback `parseQuakeCsv` uses for a missing
 * time, which the popup already renders as "Unknown".
 */
function isoTime(value: unknown): string {
  const ms = finite(value);
  if (ms === null) return "";
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/* ---------------------------------------------------------------------------
   Identity, and the delta between two fetches
   --------------------------------------------------------------------------- */

/**
 * A stable identity for one earthquake: when, where, and how big.
 *
 * Deliberately **not** the USGS event id, even though the live feed carries
 * one. The id exists only on the GeoJSON path — the CSV parser keeps four
 * properties and an id is not among them, and its row rules are not being
 * changed to add one — so an id-based key could never compare a live fetch
 * against the sample the page opens with, which is the very first comparison
 * that has to work. Time to the millisecond, position and magnitude identify
 * an event as well as its catalogue number does, and identify it the same way
 * on both paths: the sample CSV writes `2026-09-01T19:21:23.337Z` and the
 * adapter above reconstructs exactly that string from the feed's epoch.
 *
 * The consequence worth knowing: USGS revises events, and a revision that
 * moves the magnitude or the epicentre reads here as a new quake. That is
 * uncommon, it is genuinely a change, and the cost of being wrong is one extra
 * ring fading out — see docs/DECISIONS.md D32.
 */
export function quakeKey(feature: QuakeFeature): string {
  const [longitude, latitude] = feature.geometry.coordinates;
  return `${feature.properties.time}|${longitude}|${latitude}|${feature.properties.mag}`;
}

/** The key set of a whole fetch, ready to diff the next one against. */
export function quakeKeys(features: readonly QuakeFeature[]): Set<string> {
  const keys = new Set<string>();
  for (const feature of features) keys.add(quakeKey(feature));
  return keys;
}

/**
 * Which of `features` were not in the previous fetch — the ones that should
 * pulse, and nothing else.
 *
 * **No previous set means nothing is new.** `null`, `undefined` and an empty
 * set all answer the same way, and that one rule is what keeps the first load
 * calm: there is no earlier fetch to have been absent from, so every quake on
 * screen is simply "already there" rather than "just arrived". The other
 * reading — an empty history makes everything new — is just as defensible in
 * the abstract and would flash all 619 points the moment the page opened,
 * which is the failure this whole feature is trying not to be. The narrow cost
 * of the rule chosen: if a fetch ever legitimately returned zero events, the
 * arrivals in the *next* one would not pulse. That is one missed pulse against
 * a guaranteed wall of them, and a pulse is an attention signal — better to
 * under-fire than over-fire (D33).
 *
 * Returns the very same feature objects, in input order, so the caller can
 * hand them straight to a source — the same contract `countPointsInPolygon`
 * keeps, and for the same reason.
 */
export function findNewQuakes(
  previous: ReadonlySet<string> | null | undefined,
  features: readonly QuakeFeature[],
): QuakeFeature[] {
  if (!previous || previous.size === 0) return [];
  return features.filter((feature) => !previous.has(quakeKey(feature)));
}
