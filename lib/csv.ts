import Papa from "papaparse";
import type { ParseResult, QuakeFeature } from "./types";

/** A CSV row before validation: every cell arrives as a string. */
type RawRow = Record<string, string | undefined>;

/**
 * Turns USGS-shaped CSV text into GeoJSON point features.
 *
 * Pure by design — no DOM, no fetch, no globals — so the whole validation
 * story is unit-testable in isolation and can be reused verbatim by the
 * Phase 3 upload flow.
 *
 * Required columns: `latitude`, `longitude`, `mag`. A row missing any of
 * them, or carrying a non-numeric / out-of-range value, is skipped and
 * explained in `errors`. `depth`, `place` and `time` are best-effort: they
 * are cosmetic, so a bad value falls back to a default rather than losing
 * an otherwise good earthquake.
 */
export function parseQuakeCsv(csvText: string): ParseResult {
  const features: QuakeFeature[] = [];
  const errors: string[] = [];

  const { data } = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  data.forEach((row, index) => {
    // +2: one for the header line, one because humans count rows from 1.
    const lineNumber = index + 2;
    const checked = checkRow(row);

    if (!checked.ok) {
      errors.push(`Row ${lineNumber} skipped — ${checked.problems.join("; ")}.`);
      return;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        // GeoJSON order is [longitude, latitude] — the CSV lists them the other way round.
        coordinates: [checked.longitude, checked.latitude],
      },
      properties: {
        mag: checked.mag,
        place: text(row.place) || "Unknown location",
        time: text(row.time),
        depth: toFiniteNumber(row.depth) ?? 0,
      },
    });
  });

  return { features, errors, skippedRows: errors.length };
}

type RowCheck =
  | { ok: true; latitude: number; longitude: number; mag: number }
  | { ok: false; problems: string[] };

function checkRow(row: RawRow): RowCheck {
  const problems: string[] = [];

  const latitude = toFiniteNumber(row.latitude);
  const longitude = toFiniteNumber(row.longitude);
  const mag = toFiniteNumber(row.mag);

  if (latitude === null) problems.push(explain("latitude", row.latitude));
  else if (Math.abs(latitude) > 90) {
    problems.push(`latitude ${latitude} is outside the valid range of -90 to 90`);
  }

  if (longitude === null) problems.push(explain("longitude", row.longitude));
  else if (Math.abs(longitude) > 180) {
    problems.push(`longitude ${longitude} is outside the valid range of -180 to 180`);
  }

  if (mag === null) problems.push(explain("mag", row.mag));

  if (latitude === null || longitude === null || mag === null || problems.length > 0) {
    return { ok: false, problems };
  }

  return { ok: true, latitude, longitude, mag };
}

function explain(field: string, raw: string | undefined): string {
  const value = text(raw);
  return value === ""
    ? `${field} is missing`
    : `${field} is not a number (got "${value}")`;
}

/** `Number("")` is 0 and `Number(" 4.5 ")` is 4.5, so blanks are rejected first. */
function toFiniteNumber(raw: string | undefined): number | null {
  const value = text(raw);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(raw: string | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}
