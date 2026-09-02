import Papa from "papaparse";

/**
 * Which CSV column feeds which field of a {@link import("./types").QuakeFeature}.
 *
 * The USGS feed names its columns exactly like our fields, so the sample data
 * needs no mapping at all. An arbitrary uploaded CSV might call latitude
 * `lat`, or `y`, or "Latitude (deg)" — this module is how such a file becomes
 * the same GeoJSON as the sample, without a second parser.
 *
 * Everything here is pure: no DOM, no fetch, no globals (D9).
 */

/** Fields that decide where a point sits and how big it is — see D4. */
export const REQUIRED_FIELDS = ["latitude", "longitude", "mag"] as const;
/** Cosmetic fields: a missing one costs a detail, never the row. */
export const OPTIONAL_FIELDS = ["depth", "place", "time"] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];
export type QuakeField = RequiredField | OptionalField;

/** Every field, required first — the order the mapping UI renders them in. */
export const ALL_FIELDS: readonly QuakeField[] = [
  ...REQUIRED_FIELDS,
  ...OPTIONAL_FIELDS,
];

/** Human labels. `mag` is the CSV's name for it; "Magnitude" is the reader's. */
export const FIELD_LABELS: Record<QuakeField, string> = {
  latitude: "Latitude",
  longitude: "Longitude",
  mag: "Magnitude",
  depth: "Depth (km)",
  place: "Place",
  time: "Time",
};

/**
 * A resolved mapping. Required fields must name a column; optional ones are
 * absent when the file has nothing to offer.
 */
export type ColumnMapping = { [K in RequiredField]: string } & {
  [K in OptionalField]?: string;
};

/**
 * Every field either mapped or explicitly unmapped (`""`). This is the shape a
 * `<select>`-per-field form holds; {@link toMapping} turns it into a
 * {@link ColumnMapping} once the user is done.
 */
export type MappingDraft = Record<QuakeField, string>;

/** The column names the USGS feed uses — identical to our field names. */
export const USGS_COLUMNS: Record<QuakeField, string> = {
  latitude: "latitude",
  longitude: "longitude",
  mag: "mag",
  depth: "depth",
  place: "place",
  time: "time",
};

/** The default mapping, so `parseQuakeCsv(text)` still means "USGS-shaped". */
export const USGS_MAPPING: ColumnMapping = { ...USGS_COLUMNS };

/**
 * The header row, trimmed, in file order, minus anything a row cannot be keyed
 * by.
 *
 * papaparse gives a repeated column a suffix (`mag`, `mag_1`), and that suffix
 * is the actual key on the parsed row, so both are offered — they really are
 * two selectable columns. An unnamed column has no key at all and is dropped:
 * a dropdown entry that cannot be read from would be a promise we could not
 * keep. The duplicate filter below is belt and braces, for a papaparse that
 * ever stops adding the suffix.
 */
export function readCsvHeaders(csvText: string): string[] {
  const { meta } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    preview: 1,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const fields = meta.fields ?? [];
  return fields.filter(
    (field, index) => field !== "" && fields.indexOf(field) === index,
  );
}

/**
 * The no-questions-asked path: if the file names its required columns the way
 * USGS does, it needs no mapping UI at all.
 *
 * Matching is case-insensitive but otherwise exact — `LATITUDE` is the same
 * column, `lat` is a guess and belongs in {@link guessMapping}, where a human
 * confirms it.
 */
export function detectMapping(headers: readonly string[]): ColumnMapping | null {
  const byLowerName = new Map(
    headers.map((header) => [header.trim().toLowerCase(), header] as const),
  );
  const columnFor = (field: QuakeField) =>
    byLowerName.get(USGS_COLUMNS[field].toLowerCase());

  const latitude = columnFor("latitude");
  const longitude = columnFor("longitude");
  const mag = columnFor("mag");
  if (!latitude || !longitude || !mag) return null;

  const mapping: ColumnMapping = { latitude, longitude, mag };
  for (const field of OPTIONAL_FIELDS) {
    const column = columnFor(field);
    if (column) mapping[field] = column;
  }
  return mapping;
}

/**
 * Common spellings, used only to pre-select the dropdowns. Deliberately looser
 * than {@link detectMapping}: a wrong guess here costs one click, whereas a
 * wrong auto-detect would silently plot the wrong column.
 */
const ALIASES: Record<QuakeField, readonly string[]> = {
  latitude: ["latitude", "lat", "y"],
  longitude: ["longitude", "lon", "lng", "long", "x"],
  mag: ["mag", "magnitude", "mw", "ml", "m"],
  depth: ["depth", "depthkm", "dep", "z"],
  place: ["place", "location", "name", "region", "description", "title"],
  time: ["time", "date", "datetime", "timestamp", "origintime", "utc"],
};

/** "Depth (km)" and "depth_km" both normalise to "depthkm". */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best-effort pre-fill for the mapping form. Required fields are resolved
 * first, and a column already claimed cannot be claimed again — otherwise a
 * file with both `lat` and `latitude` could hand the same column to two fields.
 */
export function guessMapping(headers: readonly string[]): MappingDraft {
  const draft: MappingDraft = {
    latitude: "",
    longitude: "",
    mag: "",
    depth: "",
    place: "",
    time: "",
  };
  const claimed = new Set<string>();

  for (const field of ALL_FIELDS) {
    const aliases = ALIASES[field].map(normalize);
    const match = headers.find(
      (header) => !claimed.has(header) && aliases.includes(normalize(header)),
    );
    if (match) {
      draft[field] = match;
      claimed.add(match);
    }
  }

  return draft;
}

/**
 * Problems with a mapping, as sentence fragments. Empty means usable.
 *
 * Pass `headers` to also catch a mapping that names a column the file does not
 * have — without them only "nothing selected" can be checked.
 */
export function validateMapping(
  mapping: Partial<MappingDraft>,
  headers?: readonly string[],
): string[] {
  const problems: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const label = FIELD_LABELS[field].toLowerCase();
    const column = mapping[field]?.trim() ?? "";

    if (column === "") {
      problems.push(`${label} has no column selected`);
    } else if (headers && !headers.includes(column)) {
      problems.push(`${label} is mapped to "${column}", which this file has no column for`);
    }
  }

  return problems;
}

/** Form state → parser input. Unset optional fields are dropped, not blanked. */
export function toMapping(draft: MappingDraft): ColumnMapping {
  const mapping: ColumnMapping = {
    latitude: draft.latitude.trim(),
    longitude: draft.longitude.trim(),
    mag: draft.mag.trim(),
  };

  for (const field of OPTIONAL_FIELDS) {
    const column = draft[field].trim();
    if (column) mapping[field] = column;
  }

  return mapping;
}
