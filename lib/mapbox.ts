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

/** Which of the two mutually exclusive layers is showing. */
export type MapMode = "points" | "heatmap";

/**
 * What the legend draws. These mirror the layers above rather than being read
 * out of them: the layer specs are Mapbox expression arrays whose types resist
 * being built from shared constants, and the Phase 1 circle layer is not to be
 * restructured for the sake of a swatch. They sit here, next to the paint
 * values they describe, so a change to one has the other in view.
 */

/** Sampled from `QUAKE_CIRCLE_LAYER`'s `circle-color` stops — keep in sync. */
export const DEPTH_LEGEND_STOPS: ReadonlyArray<{ km: number; color: string }> = [
  { km: 0, color: "#ffd166" },
  { km: 35, color: "#f9844a" },
  { km: 70, color: "#e05780" },
  { km: 150, color: "#8e7dbe" },
  { km: 300, color: "#4a8fe7" },
  { km: 700, color: "#2a4d9b" },
];

/**
 * Sampled from `QUAKE_HEATMAP_LAYER`'s `heatmap-color` ramp — keep in sync.
 * The fully transparent density-0 stop is left out: a legend swatch showing
 * "nothing" as a colour teaches nothing, and the basemap already says it.
 */
export const DENSITY_LEGEND_STOPS: ReadonlyArray<{ at: number; color: string }> = [
  { at: 0, color: "#7a280e" },
  { at: 0.2, color: "#8c2f0d" },
  { at: 0.4, color: "#cf5a12" },
  { at: 0.6, color: "#ef8b1b" },
  { at: 0.8, color: "#ffd166" },
  { at: 1, color: "#fff6de" },
];

/**
 * Three magnitudes worth showing a circle for, with the diameter the legend
 * draws them at. The layer's own radii (3px at M4.5 up to 24px at M8.5) would
 * put a 48px disc in a corner panel, so these are proportional-but-scaled:
 * the ratio between them is what the reader takes away, not the absolute size.
 */
export const MAGNITUDE_LEGEND_STOPS: ReadonlyArray<{ mag: number; px: number }> = [
  { mag: 4.5, px: 6 },
  { mag: 6, px: 13 },
  { mag: 7.5, px: 22 },
];

/* ---------------------------------------------------------------------------
   Phase 4 — the drawn selection

   Everything below is additive: a second source, a layer that rings whichever
   points fall inside the drawn shape, and the theme Mapbox Draw paints itself
   with. Nothing above this line moves. The selection is a *third* thing on the
   map and it has to read as one — see docs/DECISIONS.md D25 for why it is
   drawn in neutral chrome colours rather than in either data palette.
   --------------------------------------------------------------------------- */

/** id of the source holding only the quakes inside the drawn polygon. */
export const SELECTED_SOURCE_ID = "quakes-selected";
/** id of the ring layer drawn from {@link SELECTED_SOURCE_ID}. */
export const SELECTED_LAYER_ID = "quakes-selected-ring";

/** Empty until a polygon exists; fed by the same setData path as the quakes. */
export const QUAKE_SELECTED_SOURCE: GeoJSONSourceSpecification = {
  type: "geojson",
  data: EMPTY_COLLECTION,
};

/**
 * A ring around each selected quake, drawn above the circle layer.
 *
 * It is a ring and not a re-fill on purpose: the circle underneath keeps its
 * depth colour, so the selection says "this one is in" without overwriting
 * what the point already meant. The radii mirror `QUAKE_CIRCLE_LAYER`'s with a
 * constant 2.5px added — the same restate-rather-than-derive call D20 made for
 * the legend, for the same reason, and with the same obligation: **if the
 * circle layer's radius stops move, move these too.**
 *
 * Hidden in Heatmap mode by the toggle. The count still works there; the ring
 * does not, because a heatmap deliberately has no individual points to ring.
 */
export const QUAKE_SELECTED_LAYER: CircleLayerSpecification = {
  id: SELECTED_LAYER_ID,
  type: "circle",
  source: SELECTED_SOURCE_ID,
  layout: { visibility: "none" },
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "mag"],
      4.5, 5.5,
      5.5, 7.5,
      6.5, 11.5,
      7.5, 17.5,
      8.5, 26.5,
    ],
    // No fill at all — the quake's own circle shows through the middle.
    "circle-opacity": 0,
    "circle-stroke-width": 1.4,
    "circle-stroke-color": "#f2f6fa",
    "circle-stroke-opacity": 0.9,
  },
};

/**
 * One layer of Mapbox Draw's own styling. Draw takes `object[]` and injects
 * the `source` itself (and clones each entry into a hot and a cold copy), so
 * these cannot be `LayerSpecification`s — the shape below is as much checking
 * as the option allows.
 */
type DrawStyle = {
  id: string;
  type: "fill" | "line" | "circle";
  filter?: unknown[];
  layout?: Record<string, unknown>;
  paint: Record<string, unknown>;
};

/**
 * Draw's default theme is a blue-and-orange that belongs to some other
 * application, and its orange is within a shade of this map's shallow-depth
 * and heatmap colours. So the selection is drawn in near-white chrome instead:
 * nothing on this map encodes data in neutral white, which is exactly why the
 * outline can use it without claiming to mean anything.
 *
 * Filters are Draw's own, unchanged — they are how Draw addresses its internal
 * feature/vertex/midpoint bookkeeping, and are not ours to reinterpret. Only
 * the paint differs. The point layers of the default theme are left out: the
 * only mode this app enables is polygon drawing.
 */
const SELECTION_INK = "#f2f6fa";

export const DRAW_STYLES: DrawStyle[] = [
  {
    id: "gl-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"]],
    paint: {
      "fill-color": SELECTION_INK,
      // Barely there. The polygon's job is to bound the count, not to hide
      // the quakes the count is about.
      "fill-opacity": [
        "case",
        ["==", ["get", "active"], "true"], 0.1,
        0.06,
      ],
    },
  },
  {
    id: "gl-draw-lines",
    type: "line",
    filter: ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": SELECTION_INK,
      "line-opacity": 0.85,
      // Dashed while the shape is live, solid once it is settled — the same
      // convention Draw's own theme uses, and the only cue that the outline
      // under the cursor is still being drawn.
      "line-dasharray": [
        "case",
        ["==", ["get", "active"], "true"], ["literal", [0.4, 2]],
        ["literal", [1, 0]],
      ],
      "line-width": 1.6,
    },
  },
  {
    id: "gl-draw-vertex-outer",
    type: "circle",
    filter: [
      "all",
      ["==", "$type", "Point"],
      ["==", "meta", "vertex"],
      ["!=", "mode", "simple_select"],
    ],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 6, 4.5],
      "circle-color": SELECTION_INK,
    },
  },
  {
    // The dark centre is what turns the handle into a ring rather than a
    // blob, so a vertex sitting on a quake does not swallow it.
    id: "gl-draw-vertex-inner",
    type: "circle",
    filter: [
      "all",
      ["==", "$type", "Point"],
      ["==", "meta", "vertex"],
      ["!=", "mode", "simple_select"],
    ],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 3.5, 2.4],
      "circle-color": "#0b0f14",
    },
  },
  {
    // Midpoints are an invitation, not a state — dimmer than a real vertex.
    id: "gl-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"]],
    paint: {
      "circle-radius": 2.6,
      "circle-color": SELECTION_INK,
      "circle-opacity": 0.55,
    },
  },
];
