import type { QuakeFeature } from "./types";

/**
 * Summary of one loaded feature set, computed once after parsing.
 *
 * Every aggregate is nullable rather than defaulted: an empty set has no
 * maximum magnitude, and reporting that as `0` would draw an M0 that never
 * happened. `count` is the one field that is always meaningful.
 */
export interface QuakeStats {
  /** How many features were plotted. */
  count: number;
  /** Largest magnitude in the set, or null if the set has none. */
  maxMag: number | null;
  /** `place` of the feature that held {@link maxMag}. */
  maxMagPlace: string | null;
  /** Shallowest depth in km, or null. */
  minDepth: number | null;
  /** Deepest depth in km, or null. */
  maxDepth: number | null;
}

/**
 * Pure single pass over the parsed features — no map, no DOM, no fetch.
 *
 * Non-finite magnitudes and depths are ignored rather than propagated: one
 * `NaN` would otherwise poison every comparison and blank the whole bar.
 * `parseQuakeCsv` already guarantees finite values, but this helper is the
 * public shape the Phase 3 upload flow will reuse, so it does not assume it.
 *
 * Ties on magnitude keep the first feature, i.e. feed order.
 */
export function computeStats(features: readonly QuakeFeature[]): QuakeStats {
  let maxMag: number | null = null;
  let maxMagPlace: string | null = null;
  let minDepth: number | null = null;
  let maxDepth: number | null = null;

  for (const feature of features) {
    const { mag, depth, place } = feature.properties;

    if (Number.isFinite(mag) && (maxMag === null || mag > maxMag)) {
      maxMag = mag;
      maxMagPlace = place;
    }

    if (Number.isFinite(depth)) {
      if (minDepth === null || depth < minDepth) minDepth = depth;
      if (maxDepth === null || depth > maxDepth) maxDepth = depth;
    }
  }

  return { count: features.length, maxMag, maxMagPlace, minDepth, maxDepth };
}
