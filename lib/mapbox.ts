import type {
  CircleLayerSpecification,
  GeoJSONSourceSpecification,
  HeatmapLayerSpecification,
  MapOptions,
} from "mapbox-gl";
import type { QuakeCollection } from "./types";

/** id of the GeoJSON source holding every quake feature. */
export const SOURCE_ID = "quakes";
/** id of the circle layer drawn from {@link SOURCE_ID}. */
export const LAYER_ID = "quakes-circles";
/** id of the heatmap layer drawn from the same {@link SOURCE_ID}. */
export const HEATMAP_LAYER_ID = "quakes-heatmap";

/** Where the preloaded USGS sample lives, relative to the site root. */
export const SAMPLE_CSV_PATH = "/sample-quakes.csv";

/**
 * Everything needed to construct the map except `container`, which only
 * exists at runtime. Centred on the Pacific so the Ring of Fire — where
 * most M4.5+ events are — fills the first frame.
 */
export const MAP_INIT: Omit<MapOptions, "container"> = {
  style: "mapbox://styles/mapbox/dark-v11",
  center: [-160, 20],
  zoom: 1.4,
  // Flat beats the v3 globe here: a scatter plot is easier to read without
  // half the points curving away over the horizon.
  projection: "mercator",
};

/** An empty collection — the source is created empty, then fed via setData. */
export const EMPTY_COLLECTION: QuakeCollection = {
  type: "FeatureCollection",
  features: [],
};

export const QUAKE_SOURCE: GeoJSONSourceSpecification = {
  type: "geojson",
  data: EMPTY_COLLECTION,
};

/**
 * Magnitude → radius, depth → colour. Both are interpolations rather than
 * steps so neighbouring values stay visually adjacent.
 *
 * The magnitude stops are deliberately non-linear: the feed floors at M4.5
 * and the interesting tail is M7+, so the radius grows faster at the top.
 * The depth ramp runs warm (shallow, the destructive ones) to cool (deep).
 */
export const QUAKE_CIRCLE_LAYER: CircleLayerSpecification = {
  id: LAYER_ID,
  type: "circle",
  source: SOURCE_ID,
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "mag"],
      4.5, 3,
      5.5, 5,
      6.5, 9,
      7.5, 15,
      8.5, 24,
    ],
    "circle-color": [
      "interpolate",
      ["linear"],
      ["get", "depth"],
      0, "#ffd166",
      35, "#f9844a",
      70, "#e05780",
      150, "#8e7dbe",
      300, "#4a8fe7",
      700, "#2a4d9b",
    ],
    "circle-opacity": 0.8,
    "circle-stroke-width": 0.6,
    "circle-stroke-color": "rgba(255, 255, 255, 0.35)",
  },
};
/**
 * Density → colour, magnitude → weight.
 *
 * Every number below was fitted against a model of Mapbox's own heatmap
 * shader rather than picked by eye — see docs/DECISIONS.md D15. The detail
 * that governs all of them is `GAUSS_COEF` in heatmap.fragment.glsl: each
 * point contributes `weight * intensity * 0.39894 * exp(-4.5 * (dist/radius)^2)`,
 * so a point's peak contribution is ~40% of `weight * intensity`, not 100%.
 * Tuning without that factor lands the whole map in the bottom third of the
 * ramp, which is exactly what the first cut of this layer did.
 *
 * At the default zoom of 1.4 the world is 1351px wide — 3.8px per degree of
 * longitude — so a radius in the low 20s is what makes neighbouring quakes
 * along a subduction arc melt into continuous heat instead of separate dots.
 */
export const QUAKE_HEATMAP_LAYER: HeatmapLayerSpecification = {
  id: HEATMAP_LAYER_ID,
  type: "heatmap",
  source: SOURCE_ID,
  // Added alongside the circle layer but hidden; the toggle flips both.
  layout: { visibility: "none" },
  paint: {
    // Compressed on purpose: 0.5 at the M4.5 floor against 1.0 at M8.5, so
    // magnitude modulates the heat without dominating it. Heat should come
    // from quakes clustering, not from one big quake — a wider spread lets a
    // single large event saturate the ramp on its own and paint the hard-edged
    // disc this layer used to show off Indonesia.
    "heatmap-weight": [
      "interpolate",
      ["linear"],
      ["get", "mag"],
      4.5, 0.5,
      5.5, 0.65,
      6.5, 0.8,
      7.5, 0.9,
      8.5, 1,
    ],
    // Deliberately below 1 at world zoom. With the radius below, the dense
    // arcs stack far past the top of the ramp anyway; holding intensity down
    // is what keeps Chile, Tonga and Japan at *distinct* brightnesses instead
    // of all three clipping to white. It rises as you zoom in and points stop
    // overlapping, but caps near 2 — past that a lone quake glows as brightly
    // as a cluster, which is the opposite of the point.
    "heatmap-intensity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0, 0.3,
      1.5, 0.36,
      3, 0.75,
      5, 1.3,
      7, 1.8,
      9, 2.2,
    ],
    "heatmap-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0, 18,
      2, 24,
      4, 36,
      6, 52,
      9, 85,
    ],
    // Reads as heat on the dark basemap: transparent, then a dim ember that
    // sparse quakes fade into, up through orange and amber to near-white at
    // the densest cores. The transparent stop carries the same warm hue as
    // the one above it, so the fade-out never passes through grey. `#ffd166`
    // at 0.8 is the circle layer's shallow-depth colour, kept as the one
    // thread tying the two modes together.
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0, "rgba(94, 30, 12, 0)",
      0.06, "rgba(122, 40, 14, 0.45)",
      0.2, "#8c2f0d",
      0.4, "#cf5a12",
      0.6, "#ef8b1b",
      0.8, "#ffd166",
      1, "#fff6de",
    ],
    // The ramp's own alpha does the fading, so the layer opacity can sit high
    // without washing out the basemap under the sparse regions.
    "heatmap-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0, 0.9,
      4, 0.95,
    ],
  },
};
