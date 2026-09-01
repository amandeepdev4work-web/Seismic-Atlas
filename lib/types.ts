import type { Feature, FeatureCollection, Point } from "geojson";

/**
 * The only properties Seismic Atlas carries per earthquake. Kept deliberately
 * small: the USGS CSV has 22 columns, but everything downstream (rendering,
 * heatmap, popups, polygon counts) needs only these four.
 */
export interface QuakeProperties {
  /** Moment magnitude. */
  mag: number;
  /** Human-readable location, e.g. "78 km ENE of Mutsu, Japan". */
  place: string;
  /** Origin time, ISO 8601 UTC string exactly as the feed provides it. */
  time: string;
  /** Depth below the surface, in kilometres. */
  depth: number;
}

/** One earthquake as a GeoJSON point. Coordinates are [longitude, latitude]. */
export type QuakeFeature = Feature<Point, QuakeProperties>;

/** The internal data format for the whole app — see docs/DECISIONS.md D2. */
export type QuakeCollection = FeatureCollection<Point, QuakeProperties>;

/** Outcome of parsing one CSV document. */
export interface ParseResult {
  /** Rows that survived validation, in feed order. */
  features: QuakeFeature[];
  /** One readable message per skipped row. */
  errors: string[];
  /** Length of `errors`, exposed separately for cheap display. */
  skippedRows: number;
}
