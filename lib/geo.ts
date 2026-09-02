import { booleanPointInPolygon } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { QuakeFeature } from "./types";

/**
 * Anything a caller might reasonably hand us as "the shape". Mapbox Draw
 * returns whole `Feature`s; a caller with a geometry in hand should not have
 * to wrap it, and `null` is the ordinary state (no polygon drawn yet) rather
 * than a mistake — so it is accepted and answered with a zero, not a throw.
 */
export type PolygonInput =
  | Polygon
  | MultiPolygon
  | Feature<Polygon | MultiPolygon>
  | null
  | undefined;

export interface PointsInPolygonResult {
  /** How many of `features` fall inside the polygon. */
  inside: number;
  /** Those features, in the order they were given. */
  insideFeatures: QuakeFeature[];
}

/** One turn of the world, in degrees of longitude. */
const WORLD_DEGREES = 360;

/**
 * How many earthquakes fall inside a drawn shape.
 *
 * Pure: features in, a count out. No map, no DOM, no globals — which is what
 * makes this the unit-tested core of the polygon filter while the drawing
 * itself is left to a browser (D9).
 *
 * Three behaviours are deliberate and are what the tests pin down:
 *
 * - **A point on the boundary counts as inside.** That is turf's default and
 *   it is the answer to give: a quake exactly on a line the user just drew is
 *   one they meant to enclose, and "inside" is at least a rule they can
 *   predict. Vertices count too.
 * - **Nothing throws.** An absent polygon, an empty ring, a two-point ring, a
 *   ring whose last position does not repeat its first — turf throws on most
 *   of those, so they are screened out here and answered with zero. A shape
 *   half-drawn is the normal state of a drawing tool, not an error.
 * - **The polygon is matched against every copy of the world it covers.** See
 *   {@link longitudeShifts}.
 */
export function countPointsInPolygon(
  features: readonly QuakeFeature[] | null | undefined,
  polygon: PolygonInput,
): PointsInPolygonResult {
  const geometry = usableGeometry(polygon);
  if (!geometry || !features || features.length === 0) {
    return { inside: 0, insideFeatures: [] };
  }

  const [minX, minY, maxX, maxY] = outerBounds(geometry);
  const shifts = longitudeShifts(minX, maxX);
  const insideFeatures: QuakeFeature[] = [];

  for (const feature of features) {
    const position = feature?.geometry?.coordinates;
    if (!isFinitePosition(position)) continue;

    const [lng, lat] = position;
    // The bounding box is a cheap reject that costs one comparison and saves
    // a ray cast — most of a global feed is nowhere near any drawn shape.
    if (lat < minY || lat > maxY) continue;

    for (const shift of shifts) {
      const shifted = lng + shift;
      if (shifted < minX || shifted > maxX) continue;
      if (booleanPointInPolygon([shifted, lat], geometry)) {
        insideFeatures.push(feature);
        break;
      }
    }
  }

  return { inside: insideFeatures.length, insideFeatures };
}

/**
 * Which copies of the world to test each point against.
 *
 * A web map repeats the world sideways, and Mapbox Draw records what the user
 * actually clicked — longitudes anywhere in -270…270. So a box drawn across
 * the antimeridian comes back as 170…190, while the quakes it visibly encloses
 * are stored at -175. Those are the same place, and testing the raw numbers
 * against each other counts none of them.
 *
 * Rather than cutting the polygon at the seam, each point is offered at every
 * longitude that names it — +360 when the shape reaches past 180, -360 when it
 * reaches past -180. A shape inside one world (the overwhelming majority) gets
 * one test per point and pays nothing for the fix.
 */
function longitudeShifts(minX: number, maxX: number): number[] {
  const shifts = [0];
  if (maxX > 180) shifts.push(WORLD_DEGREES);
  if (minX < -180) shifts.push(-WORLD_DEGREES);
  return shifts;
}

/**
 * Everything drawable reduced to one `MultiPolygon`, or `null` if there is no
 * usable shape in there at all. Normalising here means the hot loop above has
 * one geometry type to think about, and turf is only ever handed rings it can
 * survive.
 */
function usableGeometry(input: PolygonInput): MultiPolygon | null {
  const geometry = input && input.type === "Feature" ? input.geometry : input;
  if (!geometry) return null;

  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : null;
  if (!polygons) return null;

  const usable: Position[][][] = [];
  for (const rings of polygons) {
    const polygon = usablePolygon(rings);
    if (polygon) usable.push(polygon);
  }

  return usable.length === 0
    ? null
    : { type: "MultiPolygon", coordinates: usable };
}

/** An outer ring that holds up, plus whichever holes also do. */
function usablePolygon(rings: Position[][] | undefined): Position[][] | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;

  const outer = usableRing(rings[0]);
  if (!outer) return null;

  const result = [outer];
  for (const hole of rings.slice(1)) {
    const ring = usableRing(hole);
    if (ring) result.push(ring);
  }
  return result;
}

/**
 * A ring turf will accept, or `null`. Closes an unclosed one rather than
 * refusing it — GeoJSON requires the repeat and every renderer assumes it, so
 * a caller who left it off meant the closed shape. A ring that still has fewer
 * than three distinct corners after that encloses no area and is dropped.
 */
function usableRing(ring: Position[] | undefined): Position[] | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  if (!ring.every(isFinitePosition)) return null;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];

  // Three corners plus the repeat.
  return closed.length >= 4 ? closed : null;
}

/** The box around every outer ring. Holes sit inside it by definition. */
function outerBounds(geometry: MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rings of geometry.coordinates) {
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return [minX, minY, maxX, maxY];
}

function isFinitePosition(position: Position | undefined): position is Position {
  return (
    Array.isArray(position) &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1])
  );
}
