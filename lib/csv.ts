import Papa from "papaparse";
import {
  USGS_MAPPING,
  validateMapping,
  type ColumnMapping,
} from "./columns";
import type { ParseResult, QuakeFeature } from "./types";

/** A CSV row before validation: every cell arrives as a string. */
type RawRow = Record<string, string | undefined>;

/**
 * Turns CSV text into GeoJSON point features.
 *
 * Pure by design — no DOM, no fetch, no globals — so the whole validation
 * story is unit-testable in isolation and the upload flow reuses it verbatim.
 *
 * `mapping` says which column feeds which field, and defaults to the USGS
 * names, so `parseQuakeCsv(text)` still means "parse a USGS-shaped file".
 * Uploaded files whose headers differ pass a mapping built by the user; the
 * validation rules below are identical either way — only the column names
 * change.
 *
 * Required fields: `latitude`, `longitude`, `mag`. A row missing any of them,
 * or carrying a non-numeric / out-of-range value, is skipped and explained in
 * `errors`, naming the column as the file spells it. `depth`, `place` and
 * `time` are best-effort: they are cosmetic, so a bad value falls back to a
 * default rather than losing an otherwise good earthquake.
 */
export function parseQuakeCsv(
  csvText: string,
  mapping: ColumnMapping = USGS_MAPPING,
): ParseResult {
  // A required field with no column is a fault in the mapping, not in the
  // data. Reporting it once beats skipping every row with the same message.
  const mappingProblems = validateMapping(mapping);
  if (mappingProblems.length > 0) {
    return {
      features: [],
      errors: [`Column mapping is incomplete — ${mappingProblems.join("; ")}.`],
      skippedRows: 0,
    };
  }

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
    const checked = checkRow(row, mapping);

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
        place: cell(row, mapping.place) || "Unknown location",
        time: cell(row, mapping.time),
        depth: toFiniteNumber(cell(row, mapping.depth)) ?? 0,
      },
    });
  });

  return { features, errors, skippedRows: errors.length };
}

type RowCheck =
  | { ok: true; latitude: number; longitude: number; mag: number }
  | { ok: false; problems: string[] };

function checkRow(row: RawRow, mapping: ColumnMapping): RowCheck {
  const problems: string[] = [];

  const latitude = toFiniteNumber(cell(row, mapping.latitude));
  const longitude = toFiniteNumber(cell(row, mapping.longitude));
  const mag = toFiniteNumber(cell(row, mapping.mag));

  if (latitude === null) problems.push(explain(mapping.latitude, row[mapping.latitude]));
  else if (Math.abs(latitude) > 90) {
    problems.push(`${mapping.latitude} ${latitude} is outside the valid range of -90 to 90`);
  }

  if (longitude === null) problems.push(explain(mapping.longitude, row[mapping.longitude]));
  else if (Math.abs(longitude) > 180) {
    problems.push(`${mapping.longitude} ${longitude} is outside the valid range of -180 to 180`);
  }

  if (mag === null) problems.push(explain(mapping.mag, row[mapping.mag]));

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

/** An unmapped optional field reads as an empty cell, i.e. falls back. */
function cell(row: RawRow, column: string | undefined): string {
  return column === undefined ? "" : text(row[column]);
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
