import type {
  CircleLayerSpecification,
  GeoJSONSourceSpecification,
  MapOptions,
} from "mapbox-gl";
import type { QuakeCollection } from "./types";

/** id of the GeoJSON source holding every quake feature. */
export const SOURCE_ID = "quakes";
/** id of the circle layer drawn from {@link SOURCE_ID}. */
export const LAYER_ID = "quakes-circles";

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
