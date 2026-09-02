"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import ColumnMapper from "@/components/ColumnMapper";
import DataPanel, { type Notice } from "@/components/DataPanel";
import Legend from "@/components/Legend";
import SelectionPanel, { type Selection } from "@/components/SelectionPanel";
import { APP_NAME } from "@/lib/branding";
import {
  detectMapping,
  guessMapping,
  readCsvHeaders,
  type ColumnMapping,
  type MappingDraft,
} from "@/lib/columns";
import { parseQuakeCsv } from "@/lib/csv";
import { countPointsInPolygon } from "@/lib/geo";
import {
  findNewQuakes,
  LIVE_FEED_URL,
  parseQuakeGeojson,
  quakeKey,
  quakeKeys,
  REFRESH_INTERVAL_MS,
} from "@/lib/live";
import {
  DRAW_STYLES,
  EMPTY_COLLECTION,
  HEATMAP_LAYER_ID,
  LAYER_ID,
  MAP_INIT,
  PULSE_DURATION_MS,
  PULSE_LAYER_ID,
  PULSE_SOURCE_ID,
  pulseFrame,
  QUAKE_CIRCLE_LAYER,
  QUAKE_HEATMAP_LAYER,
  QUAKE_PULSE_LAYER,
  QUAKE_PULSE_SOURCE,
  QUAKE_SELECTED_LAYER,
  QUAKE_SELECTED_SOURCE,
  QUAKE_SOURCE,
  SAMPLE_CSV_PATH,
  SELECTED_LAYER_ID,
  SELECTED_SOURCE_ID,
  SOURCE_ID,
  type MapMode,
} from "@/lib/mapbox";
import { computeStats, type QuakeStats } from "@/lib/stats";
import type { ParseResult, QuakeFeature, QuakeProperties } from "@/lib/types";
import {
  checkUploadFile,
  looksBinary,
  safeFileName,
  summarizeErrors,
  unreadableMessage,
} from "@/lib/upload";

// Inlined at build time by Next; reading it at module scope keeps the
// missing-token branch a plain render decision rather than an effect.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/**
 * Where the plotted features came from, and how that reads in the panels.
 *
 * This is also the one place that knows whether live refresh applies. `upload`
 * is the only kind that pauses it — see {@link isLive}, and D30 for why the
 * answer is derived from here rather than tracked as a second piece of state
 * that could disagree with this one.
 */
type DataSource =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "sample"; plotted: number }
  | { kind: "live"; plotted: number }
  | { kind: "upload"; fileName: string; plotted: number };

/**
 * Whether the thing on the map is the feed rather than the user's own file.
 *
 * The rule in one line, named once: a refresh must never overwrite data the
 * user brought (D30). `loading` and `error` count as live because they are
 * states of the feed itself — an `error` refresh is a retry, which is the most
 * useful thing the button can do at that moment.
 */
function isLive(source: DataSource): boolean {
  return source.kind !== "upload";
}

/** A file waiting on the user to say which column is which. */
type MapperState = {
  fileName: string;
  csvText: string;
  headers: string[];
  initial: MappingDraft;
};

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The map instance is a large mutable object — it lives in a ref, never in
  // state, so commanding it imperatively cannot trigger a re-render loop.
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Draw is another large mutable object commanded imperatively, so it lives
  // beside the map for the same reason (D3).
  const drawRef = useRef<MapboxDraw | null>(null);
  // The parsed sample, kept so "reset to sample" costs no fetch and no reparse.
  const sampleRef = useRef<QuakeFeature[] | null>(null);
  // Whatever is on the map right now — sample or upload. The polygon count is
  // taken against this, so it has to be the same array the source was fed.
  const featuresRef = useRef<QuakeFeature[]>([]);
  // Mirrors `drawing` for the popup handler, which is wired once on load and
  // so cannot see later renders' state.
  const drawingRef = useRef(false);
  // The features the ring layer was last fed. Kept so a frame that changed
  // nothing does not pay to re-upload identical geometry — see the note in
  // `refreshSelection`.
  const ringedRef = useRef<QuakeFeature[]>([]);

  // The keys of the last *successful live fetch* — not of whatever is on the
  // map. Only `refreshLive` writes it, which is what makes the delta mean "new
  // since the feed last answered" rather than "absent from the snapshot the
  // page happened to open with". Null until the feed has answered once, which
  // is what keeps the first refresh from pulsing everything (D33).
  const liveKeysRef = useRef<Set<string> | null>(null);
  // The running pulse cohort, or null when none is animating. `still` is the
  // reader's reduced-motion preference, sampled when the cohort started.
  const pulseRef = useRef<{ startedAt: number; still: boolean } | null>(null);
  // The one rAF handle this component ever holds. Null means the loop is not
  // running, which is the idle state — it is not left spinning between pulses.
  const frameRef = useRef<number | null>(null);
  // Mirrors `isLive(dataSource)` and `mode` for the callbacks that outlive a
  // render: a timer tick, and the continuation of a fetch that was in flight
  // when the user uploaded a file.
  const liveRef = useRef(true);
  const modeRef = useRef<MapMode>("points");
  // Guards against a manual click landing on top of a timer tick, or a second
  // click while the first fetch is still out.
  const refreshingRef = useRef(false);

  // All plain UI state. None of it holds anything the map owns, so none of it
  // can trigger the render loop D3 keeps the map instance out of.
  const [dataSource, setDataSource] = useState<DataSource>({ kind: "loading" });
  const [layersReady, setLayersReady] = useState(false);
  const [mode, setMode] = useState<MapMode>("points");
  const [stats, setStats] = useState<QuakeStats | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mapper, setMapper] = useState<MapperState | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const live = isLive(dataSource);

  useEffect(() => {
    const container = containerRef.current;
    if (!MAPBOX_TOKEN || !container) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({ container, ...MAP_INIT });
    mapRef.current = map;

    // Flipped by the cleanup below, so the async load never touches a map
    // that has already been removed (in dev, React mounts every effect,
    // tears it down and mounts it again).
    let cancelled = false;

    map.on("error", (event) => {
      console.error("[Seismic Atlas] Mapbox error:", event.error);
    });

    map.on("load", () => {
      // The source and both layers are created before any data arrives, and
      // exactly once. That is what makes an upload independent of the sample
      // fetch: if the sample 404s there is still a source to setData on.
      map.addSource(SOURCE_ID, QUAKE_SOURCE);
      // The heatmap goes on first so the circles draw above it, and starts
      // hidden — the toggle only ever flips `visibility`.
      map.addLayer(QUAKE_HEATMAP_LAYER);
      map.addLayer(QUAKE_CIRCLE_LAYER);

      // The selection ring is its own source and its own layer, added above
      // the circles and fed only with whatever falls inside the polygon. It
      // is additive on purpose: neither of the two layers below it changes,
      // and with no polygon drawn its source is empty and it draws nothing.
      map.addSource(SELECTED_SOURCE_ID, QUAKE_SELECTED_SOURCE);
      map.addLayer(QUAKE_SELECTED_LAYER);

      // The pulse goes on top of all three, and is additive in exactly the
      // same way: its own source, its own layer, empty and fully transparent
      // unless a refresh has just brought something. None of the layers below
      // it is repainted, filtered or re-fed to make it work.
      map.addSource(PULSE_SOURCE_ID, QUAKE_PULSE_SOURCE);
      map.addLayer(QUAKE_PULSE_LAYER);

      wireInteractions(map, drawingRef);
      wireDrawing(map);
      if (cancelled) return;
      setLayersReady(true);
      void loadSample();
    });

    /**
     * Draw goes on last, so its outline and handles sit above every data
     * layer. `displayControlsDefault: false` suppresses Draw's own button
     * bar — it is a light-themed control that would land in a corner this
     * layout has already spent (D26); the buttons in the right-hand stack
     * drive it instead.
     */
    function wireDrawing(map: mapboxgl.Map) {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        // Shift-drag stays the map's box zoom rather than becoming Draw's
        // marquee select — there is only ever one shape to select.
        boxSelect: false,
        styles: DRAW_STYLES,
      });
      drawRef.current = draw;
      map.addControl(draw);

      // Every listener below is registered once and reads only refs and state
      // setters, so it never goes stale against a later render.
      //
      // These three are the authoritative edges and are deliberately *not*
      // mode-guarded. `draw.create` in particular fires from the outgoing
      // mode's `onStop`, which Draw runs *before* it updates the mode name —
      // so at that instant `getMode()` still says `draw_polygon`, and a
      // guarded handler would drop the one count that matters most.
      map.on("draw.create", refreshSelection);
      map.on("draw.update", refreshSelection);
      map.on("draw.delete", refreshSelection);

      // And this is the continuous one, between those edges.
      map.on("draw.render", refreshSelectionLive);

      // Fired when Draw changes mode on its own — finishing a polygon, or
      // Escape cancelling one. Asking Draw for its mode rather than reading
      // the event keeps one answer to "are we drawing?".
      map.on("draw.modechange", () => {
        setDrawingMode(drawRef.current?.getMode() === "draw_polygon");
      });
    }

    async function loadSample() {
      try {
        const { features, errors, skippedRows } = await fetchSample();
        if (cancelled) return;

        sampleRef.current = features;
        featuresRef.current = features;
        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features });

        // Computed once, from the same features that were just handed to the
        // source. Nothing recomputes it on toggle.
        setStats(computeStats(features));
        applyDataSource({ kind: "sample", plotted: features.length });

        if (errors.length > 0) {
          console.warn(
            `[Seismic Atlas] skipped ${skippedRows} row(s) in ${SAMPLE_CSV_PATH}:`,
            errors,
          );
        }
      } catch (error) {
        if (cancelled) return;
        applyDataSource({ kind: "error", message: describeError(error) });
      }
    }

    return () => {
      cancelled = true;
      // The animation frame goes first, and unconditionally: a frame left
      // queued would fire after `map.remove()` and reach for a torn-down map.
      // Nothing else in the pulse teardown is needed here — the source it
      // would clear is about to cease to exist with the map.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pulseRef.current = null;
      // `map.remove()` calls every control's onRemove, which leaves Draw's
      // internals torn down — so the ref is dropped in the same breath, or a
      // late refresh would ask a gutted Draw for its features.
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      drawingRef.current = false;
    };
  }, []);

  // Switching modes is two layout-property flips on layers that already exist
  // and already hold the data — no refetch, no reparse, no setData.
  useEffect(() => {
    // Read by `startPulse`, which is called from a fetch continuation and so
    // cannot see this render's `mode`.
    modeRef.current = mode;

    const map = mapRef.current;
    if (!map || !layersReady) return;
    if (!map.getLayer(LAYER_ID) || !map.getLayer(HEATMAP_LAYER_ID)) return;

    map.setLayoutProperty(
      LAYER_ID,
      "visibility",
      mode === "points" ? "visible" : "none",
    );
    map.setLayoutProperty(
      HEATMAP_LAYER_ID,
      "visibility",
      mode === "heatmap" ? "visible" : "none",
    );

    // The selection ring follows Points mode. The count is a fact about the
    // data and holds in either mode, but a ring drawn around an individual
    // quake is a claim Heatmap mode cannot make — see D25.
    if (map.getLayer(SELECTED_LAYER_ID)) {
      map.setLayoutProperty(
        SELECTED_LAYER_ID,
        "visibility",
        mode === "points" ? "visible" : "none",
      );
    }

    // The pulse follows Points mode for D25's reason, restated: a ring drawn
    // around one quake is a claim about an individual point, and Heatmap mode
    // deliberately has none — the arrival is already in the density. Leaving
    // this effect the *only* owner of the layer's visibility is what keeps the
    // animation loop from having to know about modes: it owns the layer's
    // content, this owns whether the content is drawn.
    if (map.getLayer(PULSE_LAYER_ID)) {
      map.setLayoutProperty(
        PULSE_LAYER_ID,
        "visibility",
        mode === "points" ? "visible" : "none",
      );
    }

    // Switching to Heatmap mid-pulse ends it rather than animating something
    // nobody can see. Switching back does not resurrect it: a pulse is an
    // announcement of an arrival, and the moment to hear it has passed.
    if (mode !== "points") stopPulse();
  }, [mode, layersReady]);

  /**
   * The auto-refresh timer.
   *
   * Its two dependencies are the whole of the pause rule: it exists only once
   * the layers do, and only while the feed is what is on the map. Uploading a
   * file flips `live` to false, React tears the interval down, and there is
   * simply no timer left to clobber the user's data with (D30). Resetting to
   * the sample flips it back and a fresh interval starts.
   *
   * There is no immediate fetch on mount. The sample is a deliberate first
   * frame — instant, and independent of whether USGS is reachable — and
   * replacing it two seconds in would read as a flicker rather than as news.
   * The first live data lands on the first tick, or immediately if the reader
   * presses Refresh (D31).
   */
  useEffect(() => {
    if (!layersReady || !live) return;

    const id = window.setInterval(() => {
      void refreshLive();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [layersReady, live]);

  /**
   * Two console handles for testing the pulse by hand, and **they do not exist
   * in a production build**.
   *
   * `process.env.NODE_ENV` is inlined by Next at build time, so this is not a
   * flag checked at runtime — the whole body is a dead branch that the
   * minifier removes, along with everything only it referenced. There is
   * nothing to ship, rather than something that ships and declines to run.
   *
   * They exist because the pulse is the one thing here that cannot be
   * triggered on demand: it fires only when the USGS feed gains an event, and
   * M4.5+ worldwide averages one every couple of hours. The honest lever is
   * the baseline — `liveKeysRef` is what the next fetch is diffed against, so
   * forgetting a few of its keys makes those quakes read as arrivals. Nothing
   * is faked: the features that pulse are real ones that really came back in
   * a real fetch.
   *
   * The effect is deliberately last among the effects and reads only refs, so
   * nothing else in the component can be affected by its presence.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const scope = window as typeof window & {
      __seismicDropKeys?: (count?: number) => QuakeFeature[];
      __seismicMap?: mapboxgl.Map | null;
    };

    scope.__seismicMap = mapRef.current;

    scope.__seismicDropKeys = (count = 3) => {
      const baseline = liveKeysRef.current;

      if (!baseline) {
        console.warn(
          "[Seismic Atlas] No live baseline yet — the feed has not answered this session.\n" +
            "Press Refresh once (or wait for the first tick), then call this again.",
        );
        return [];
      }

      if (!liveRef.current) {
        console.warn(
          '[Seismic Atlas] Uploaded data is showing, so refresh is paused and nothing will pulse.\n' +
            'Press "Reset to sample" first.',
        );
        return [];
      }

      if (modeRef.current !== "points") {
        console.warn(
          "[Seismic Atlas] Heatmap mode does not pulse (D34). Dropping the keys anyway —\n" +
            "switch to Points *before* you refresh, or the next fetch consumes them and draws nothing.",
        );
      }

      // The biggest quakes on the map, because a ring around a 15px M7 disc is
      // findable at world zoom and one around a 3px M4.6 is not. They are also
      // the least likely to roll off the month window between now and the
      // fetch that is meant to pulse them.
      const dropped = [...featuresRef.current]
        .sort((a, b) => b.properties.mag - a.properties.mag)
        .slice(0, Math.max(1, count))
        // `Set.delete` reports whether the key was actually there, so this
        // filters to what genuinely left the baseline.
        .filter((feature) => baseline.delete(quakeKey(feature)));

      if (dropped.length === 0) {
        console.warn(
          "[Seismic Atlas] Nothing was dropped — the map's features and the baseline have diverged.\n" +
            "Press Refresh once to resynchronise them, then call this again.",
        );
        return [];
      }

      console.log(
        `[Seismic Atlas] Dropped ${dropped.length} key(s); baseline is now ${baseline.size}.\n` +
          "Press Refresh (or wait for the next tick). These should pulse for ~4s, and nothing else should move:",
      );
      for (const feature of dropped) {
        const [lng, lat] = feature.geometry.coordinates;
        console.log(
          `  M${feature.properties.mag} · ${feature.properties.place}\n` +
            `      __seismicMap.flyTo({ center: [${lng}, ${lat}], zoom: 4 })`,
        );
      }

      return dropped;
    };

    return () => {
      delete scope.__seismicDropKeys;
      delete scope.__seismicMap;
    };
  }, [layersReady]);

  /**
   * The one path that changes `dataSource`, and with it the answer to "may a
   * refresh touch the map?".
   *
   * The ref is written here rather than in an effect mirroring `dataSource`,
   * because the reader that matters is `refreshLive` picking back up after an
   * `await` — and an effect runs after the render that would have told it. A
   * fetch that was in flight when the user uploaded a file has to see the new
   * answer at the instant the upload happened, not one render later (D30).
   */
  function applyDataSource(next: DataSource) {
    liveRef.current = isLive(next);
    setDataSource(next);
  }

  /**
   * The one path that changes what is on the map. Uploaded and sample data go
   * through it identically — same source, same setData — so both layers pick
   * up new data with no extra wiring (D1/D2).
   */
  function showFeatures(
    features: QuakeFeature[],
    options: { fit: boolean },
  ): boolean {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!map || !source) return false;

    // A running pulse belongs to the fetch that produced it. Whatever the new
    // data is — an upload, a reset, the next refresh — those rings are now
    // drawn over a set that no longer contains them, so they end here. The
    // refresh path starts its own cohort immediately after this returns.
    stopPulse();

    source.setData({ type: "FeatureCollection", features });
    featuresRef.current = features;
    setStats(computeStats(features));

    // A polygon outlives the data it was drawn over: it is a question about a
    // region, and the answer is simply recomputed against whatever is on the
    // map now. Deleting the user's shape to tidy up the state would be the
    // same mistake D18 refuses to make with the points themselves.
    refreshSelection();

    if (options.fit) fitToFeatures(map, features);
    return true;
  }

  /**
   * Recounts what is inside the drawn polygon and re-feeds the ring layer.
   *
   * Touches only refs and state setters, which is what lets the Draw
   * listeners bind it once on load and never see a stale render.
   */
  function refreshSelection() {
    const map = mapRef.current;
    const polygon = drawnPolygon(drawRef.current);
    const source = map?.getSource(SELECTED_SOURCE_ID) as
      | GeoJSONSource
      | undefined;

    if (!polygon) {
      if (ringedRef.current.length > 0) {
        source?.setData(EMPTY_COLLECTION);
        ringedRef.current = [];
      }
      setSelection(null);
      return;
    }

    const features = featuresRef.current;
    const { inside, insideFeatures } = countPointsInPolygon(features, polygon);

    // Now that this runs per frame, the two writes below are the expensive
    // part — the count itself is a fraction of a millisecond, but `setData`
    // costs a worker round trip and a re-tile, and `setSelection` costs a
    // React render. Most frames of a drag change neither: a vertex crossing
    // empty ocean encloses exactly the same quakes it did last frame.
    //
    // So both are skipped when nothing changed. This is not throttling —
    // every genuine change still lands on the frame it happened — it is
    // declining to redo work with no effect. The identity comparison is
    // sound because `insideFeatures` holds the very same objects in input
    // order, which is a contract of `countPointsInPolygon` (D28).
    if (!sameFeatures(insideFeatures, ringedRef.current)) {
      source?.setData({ type: "FeatureCollection", features: insideFeatures });
      ringedRef.current = insideFeatures;
    }

    setSelection((previous) =>
      previous !== null &&
      previous.inside === inside &&
      previous.total === features.length
        ? previous
        : { inside, total: features.length },
    );
  }

  /**
   * The per-frame path, behind the one guard that matters.
   *
   * While a polygon is still being drawn its half-finished self is already in
   * Draw's store, with a trailing vertex glued to the cursor — and asking for
   * it back gives a *closed* ring regardless, because Draw's Polygon model
   * closes every ring on the way out (`getCoordinates` concatenates the first
   * position onto the end). So "is the ring closed?" cannot tell a finished
   * shape from an unfinished one, and neither can "does it have enough
   * corners": two clicks in, it has three. **The mode is the only thing that
   * knows**, so the mode is the guard.
   *
   * Nothing downstream depends on this being the only line of defence —
   * `drawnPolygon` still returns null when there is no polygon, and
   * `countPointsInPolygon` still refuses to throw on a degenerate ring (D28).
   * The guard is about not showing a number, not about safety.
   */
  function refreshSelectionLive() {
    const draw = drawRef.current;
    if (!draw) return;
    if (draw.getMode() === MapboxDraw.constants.modes.DRAW_POLYGON) return;
    refreshSelection();
  }

  /* -------------------------------------------------------------------------
     Live refresh
     ------------------------------------------------------------------------- */

  /**
   * Pulls the USGS feed and puts it on the map, from the timer or the button —
   * they are the same call, because they should do the same thing.
   *
   * Everything that could go wrong ends the same way: the data already on the
   * map stays exactly where it is and one quiet line says the update did not
   * land (D18's rule, applied to a source that fails on its own schedule). The
   * timer is untouched by a failure; the next tick simply tries again.
   */
  async function refreshLive() {
    // One fetch at a time. A button press during a timer tick — or an
    // impatient double-click — is a no-op rather than a second request.
    if (refreshingRef.current) return;
    if (!liveRef.current) return;

    refreshingRef.current = true;
    setRefreshing(true);

    try {
      // `no-store` because the feed is the point: a 304 from the browser cache
      // would report success and change nothing.
      const response = await fetch(LIVE_FEED_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`the feed responded ${response.status}`);
      }

      const { features, errors, skippedRows } = parseQuakeGeojson(
        await response.json(),
      );

      // The map has gone (unmount), or the user uploaded a file while this
      // was in flight. Either way what came back is no longer wanted, and in
      // the second case writing it would destroy their data — which is the
      // one thing refresh must never do (D30).
      if (!mapRef.current || !liveRef.current) return;

      if (features.length === 0) {
        throw new Error("the feed returned no usable events");
      }

      // The delta is taken *before* the keys are replaced, and against the
      // previous live fetch rather than against what is on the map: see the
      // note on `liveKeysRef`.
      const arrived = findNewQuakes(liveKeysRef.current, features);
      liveKeysRef.current = quakeKeys(features);

      // The existing path, unchanged: setData on the one source, recompute
      // the stats, recount the polygon if there is one. Nothing about refresh
      // is a second way for data to reach the map (D19).
      if (!showFeatures(features, { fit: false })) {
        throw new Error("the map is not ready");
      }

      applyDataSource({ kind: "live", plotted: features.length });
      setLastUpdated(Date.now());
      // A failure notice always ends "still showing the last data that
      // loaded", and newer data has just landed, so the sentence has stopped
      // being true. An info notice reports a load the reader asked for and is
      // theirs to dismiss.
      setNotice((current) => (current?.tone === "error" ? null : current));
      startPulse(arrived);

      if (errors.length > 0) {
        console.warn(
          `[Seismic Atlas] skipped ${skippedRows} feature(s) in the live feed:`,
          errors,
        );
      }
    } catch (error) {
      if (!mapRef.current) return;
      console.warn("[Seismic Atlas] live refresh failed:", error);
      setNotice({
        tone: "error",
        text: `Couldn't refresh — ${describeError(error)}. Still showing the last data that loaded.`,
      });
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  /* -------------------------------------------------------------------------
     The arrival pulse

     One requestAnimationFrame loop, and it only exists while something is
     pulsing. The Phase 4 per-frame recount is driven by Draw's own render
     event, which comes from Draw's store and not from map repaints, so the two
     never drive each other — see D35 for why that matters and what was checked.
     ------------------------------------------------------------------------- */

  /**
   * Starts a ring on each of `features`, replacing whatever was pulsing.
   *
   * Replacing rather than merging is what stops pulses accumulating: there is
   * one cohort with one start time, so the loop animates three scalars however
   * many rings are on screen, and a cohort that is four seconds old is gone
   * whether or not a new one arrives.
   */
  function startPulse(features: QuakeFeature[]) {
    if (features.length === 0) return;

    // Nothing to see in Heatmap mode, so nothing is started — no source
    // write, no loop, no frames spent on an invisible layer.
    if (modeRef.current !== "points") return;

    const source = mapRef.current?.getSource(PULSE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;

    // The only `setData` this animation performs: once, at the start. The
    // frames after it move paint properties, never data — which is what keeps
    // it off the worker and out of the way of the quake source (D34).
    source.setData({ type: "FeatureCollection", features });
    pulseRef.current = { startedAt: performance.now(), still: prefersStillness() };

    // Frame zero, painted here rather than waited for. `setData` takes effect
    // on the next repaint, and the paint properties are still sitting where
    // the *previous* cohort's last frame left them — a wide, all-but-invisible
    // ring — so without this the first thing drawn is the end of the last
    // animation rather than the start of this one.
    paintPulse(0);

    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(stepPulse);
    }
  }

  /**
   * Whether the reader has asked the system for less movement.
   *
   * Read per cohort rather than cached: it is one media-query lookup every few
   * minutes at most, and the setting can change while the page is open.
   */
  function prefersStillness(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /** Writes one frame's three values onto the layer. */
  function paintPulse(t: number) {
    const map = mapRef.current;
    if (!map || !map.getLayer(PULSE_LAYER_ID)) return;

    // Under `prefers-reduced-motion` the ring does not travel: the geometry is
    // frozen at the size it would have settled at, and only the opacity runs.
    // A fade is not the kind of movement that setting is about, and dropping
    // the pulse entirely would take the signal away from readers who asked for
    // calm rather than for silence.
    const geometry = pulseFrame(pulseRef.current?.still ? 1 : t);
    const { opacity } = pulseFrame(t);

    map.setPaintProperty(PULSE_LAYER_ID, "circle-radius", geometry.radius);
    map.setPaintProperty(PULSE_LAYER_ID, "circle-stroke-width", geometry.width);
    map.setPaintProperty(PULSE_LAYER_ID, "circle-stroke-opacity", opacity);
  }

  /**
   * One frame. Reads only refs and the map, so the copy of this function that
   * a queued frame is holding is as good as the current one.
   *
   * `requestAnimationFrame` hands back a timestamp on the same clock
   * `performance.now()` reads, so the elapsed time is exact and the animation
   * does not drift with the frame rate.
   */
  function stepPulse(now: number) {
    frameRef.current = null;

    const map = mapRef.current;
    const pulse = pulseRef.current;
    if (!map || !pulse || !map.getLayer(PULSE_LAYER_ID)) {
      stopPulse();
      return;
    }

    const t = (now - pulse.startedAt) / PULSE_DURATION_MS;
    if (t >= 1) {
      stopPulse();
      return;
    }

    paintPulse(t);
    frameRef.current = requestAnimationFrame(stepPulse);
  }

  /**
   * Ends the animation and empties the layer. Not scheduling the next frame is
   * the whole of "pause when idle": between pulses this component holds no rAF
   * at all and costs the browser nothing.
   */
  function stopPulse() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (pulseRef.current === null) return;
    pulseRef.current = null;

    const source = mapRef.current?.getSource(PULSE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData(EMPTY_COLLECTION);
  }

  /** Keeps the popup handler's copy of "are we drawing?" with the UI's. */
  function setDrawingMode(next: boolean) {
    drawingRef.current = next;
    setDrawing(next);
  }

  function handleDraw() {
    const draw = drawRef.current;
    if (!draw) return;

    if (drawingRef.current) {
      draw.changeMode("simple_select");
      setDrawingMode(false);
      return;
    }

    // One shape at a time. Starting a new one replaces the old, which is why
    // there is never a set of polygons to reconcile — `drawnPolygon` can take
    // the first it finds.
    draw.deleteAll();
    refreshSelection();
    draw.changeMode("draw_polygon");
    setDrawingMode(true);
  }

  function handleClearSelection() {
    const draw = drawRef.current;
    if (!draw) return;

    // Draw suppresses events for its own API calls, so `deleteAll` fires no
    // `draw.delete` and the refresh below is the thing that updates the UI.
    draw.deleteAll();
    draw.changeMode("simple_select");
    setDrawingMode(false);
    refreshSelection();
  }

  /**
   * Turns a parse result into either new data or a message. Zero valid points
   * is a refusal, not a load: the previous features stay on the map, because
   * blanking it would destroy the thing the user was looking at.
   */
  function applyParsed(result: ParseResult, fileName: string) {
    const { features, errors, skippedRows } = result;

    if (features.length === 0) {
      setNotice({
        tone: "error",
        // Every part of this line that came from the file has been through
        // `safeMessage` — the name when it was picked, the reason here.
        text: `No usable points in ${fileName}. ${summarizeErrors(errors)} The map still shows the previous data.`,
      });
      return;
    }

    if (!showFeatures(features, { fit: true })) {
      setNotice({
        tone: "error",
        text: "The map is not ready yet — try again in a moment.",
      });
      return;
    }

    applyDataSource({ kind: "upload", fileName, plotted: features.length });
    setNotice({
      tone: "info",
      text:
        skippedRows > 0
          ? `Loaded ${plural(features.length, "point")} · ${plural(skippedRows, "row")} skipped`
          : `Loaded ${plural(features.length, "point")}`,
    });

    if (errors.length > 0) {
      console.warn(
        `[Seismic Atlas] skipped ${skippedRows} row(s) in ${fileName}:`,
        errors,
      );
    }
  }

  async function handleFile(file: File) {
    setMapper(null);
    setNotice(null);

    // The name is clamped once, here, and every later message uses this one
    // rather than `file.name` — nothing off the user's disk reaches the panel
    // at full length or with control characters in it.
    const name = safeFileName(file.name);

    // Cheap checks first: a 40 MB zip costs a glance at its name, not a read.
    const rejection = checkUploadFile(file);
    if (rejection) {
      setNotice({ tone: "error", text: rejection });
      return;
    }

    setBusy(true);
    try {
      const csvText = await file.text();

      // An extension is a claim; these are the bytes. `File.text()` never
      // throws — it substitutes U+FFFD — so a .csv that is really a zip only
      // shows up here.
      if (looksBinary(csvText)) {
        setNotice({ tone: "error", text: unreadableMessage(file.name) });
        return;
      }

      const headers = readCsvHeaders(csvText);
      if (headers.length === 0) {
        setNotice({
          tone: "error",
          text: `${name} has no readable header row. The map still shows the previous data.`,
        });
        return;
      }

      // USGS-shaped files need no questions asked; anything else gets mapped.
      const detected = detectMapping(headers);
      if (detected) {
        applyParsed(parseQuakeCsv(csvText, detected), name);
        return;
      }

      setMapper({
        fileName: name,
        csvText,
        headers,
        initial: guessMapping(headers),
      });
    } catch (error) {
      // Whatever went wrong reading it, the user's next move is the same, and
      // the underlying message is not theirs to act on — it goes to the console.
      console.error(`[Seismic Atlas] could not read ${name}:`, error);
      setNotice({ tone: "error", text: unreadableMessage(file.name) });
    } finally {
      setBusy(false);
    }
  }

  /** The mapping UI has closed with a choice; parse the file it was holding. */
  function handleMapping(mapping: ColumnMapping) {
    if (!mapper) return;
    const { csvText, fileName } = mapper;
    setMapper(null);
    applyParsed(parseQuakeCsv(csvText, mapping), fileName);
  }

  async function handleReset() {
    setMapper(null);

    const features = sampleRef.current ?? (await refetchSample());
    if (!features) return;

    if (!showFeatures(features, { fit: false })) {
      setNotice({
        tone: "error",
        text: "The map is not ready yet — try again in a moment.",
      });
      return;
    }

    // Back to the framing MAP_INIT chose, rather than to the sample's bounds:
    // the Pacific-centred first frame is the point of the default view (D7).
    mapRef.current?.easeTo({
      center: MAP_INIT.center,
      zoom: MAP_INIT.zoom,
      duration: 700,
    });
    applyDataSource({ kind: "sample", plotted: features.length });
    setNotice({
      tone: "info",
      text: `Back to the sample · ${plural(features.length, "point")}`,
    });
  }

  /** Only reached if the sample never loaded in the first place. */
  async function refetchSample(): Promise<QuakeFeature[] | null> {
    setBusy(true);
    try {
      const { features } = await fetchSample();
      sampleRef.current = features;
      return features;
    } catch (error) {
      setNotice({
        tone: "error",
        text: `Could not load the sample — ${describeError(error)}`,
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!MAPBOX_TOKEN) {
    return <TokenMissing />;
  }

  return (
    <main style={styles.root}>
      <div ref={containerRef} style={styles.canvas} />

      {/* One grid over the map, two columns pinned to its edges. Grid columns
          cannot overlap each other however tall or narrow they get, which is
          the whole reason this is not two absolutely positioned stacks any
          more. The mapping panel adds a class so the narrow-width rules can
          make room for it. */}
      <div className={`map-overlay${mapper ? " map-overlay--mapping" : ""}`}>
        <div className="map-overlay__stack">
          <div style={styles.overlay}>
            <h1 style={styles.title}>{APP_NAME}</h1>
            <p style={styles.subtitle}>{describe(dataSource)}</p>
            {stats && <StatsBar stats={stats} />}
          </div>
          {layersReady && <Legend mode={mode} />}
        </div>

        <div className="map-overlay__stack map-overlay__stack--right">
          {layersReady && (
            <>
              <ModeToggle mode={mode} onChange={setMode} />
              <SelectionPanel
                drawing={drawing}
                selection={selection}
                onDraw={handleDraw}
                onClear={handleClearSelection}
              />
              <DataPanel
                sourceLabel={sourceLabel(dataSource)}
                busy={busy}
                canReset={dataSource.kind === "upload"}
                live={live}
                refreshing={refreshing}
                lastUpdated={lastUpdated}
                notice={notice}
                onFile={(file) => void handleFile(file)}
                onReset={() => void handleReset()}
                onRefresh={() => void refreshLive()}
                onDismissNotice={() => setNotice(null)}
              />
              {mapper && (
                <ColumnMapper
                  // Remounts per file, so the dropdowns reset to the new guess.
                  key={`${mapper.fileName}:${mapper.headers.join("|")}`}
                  fileName={mapper.fileName}
                  headers={mapper.headers}
                  initial={mapper.initial}
                  onApply={handleMapping}
                  onCancel={() => setMapper(null)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

async function fetchSample(): Promise<ParseResult> {
  const response = await fetch(SAMPLE_CSV_PATH);
  if (!response.ok) {
    throw new Error(
      `${SAMPLE_CSV_PATH} responded ${response.status} ${response.statusText}`,
    );
  }
  return parseQuakeCsv(await response.text());
}

/**
 * Frames the new data. Uploaded points can sit anywhere — a survey of one
 * Chilean province would be a few pixels at the edge of the default Pacific
 * view — so the map goes to them rather than making the user hunt.
 *
 * `LngLatBounds` rather than `turf.bbox`: it is the same arithmetic either
 * way, and this way the client bundle does not gain the turf meta-package for
 * six lines of it. Turf earns its place in Phase 4, where the geometry is real.
 */
function fitToFeatures(map: mapboxgl.Map, features: readonly QuakeFeature[]) {
  const bounds = new mapboxgl.LngLatBounds();

  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    if (Number.isFinite(lng) && Number.isFinite(lat)) bounds.extend([lng, lat]);
  }
  if (bounds.isEmpty()) return;

  // maxZoom keeps a single point from slamming into street level.
  map.fitBounds(bounds, { padding: 64, maxZoom: 6, duration: 700 });
}

/** "1 point", "8 rows" — a notice that says "1 rows" reads like a bug. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function describe(source: DataSource): string {
  switch (source.kind) {
    case "loading":
      return "Loading recent earthquakes…";
    case "error":
      return `Could not load quake data — ${source.message}`;
    case "sample":
      return `${source.plotted} quakes · M4.5+ past month`;
    // Same sentence as the sample's, plus the one word that is different
    // about it. The reader should not have to notice the change to be told
    // what they are looking at.
    case "live":
      return `${source.plotted} quakes · M4.5+ past month · live`;
    case "upload":
      return `${source.plotted} quakes · ${source.fileName}`;
  }
}

function sourceLabel(source: DataSource): string {
  switch (source.kind) {
    case "loading":
      return "Loading the sample…";
    case "error":
      return "No data loaded";
    case "sample":
      return "Sample · USGS M4.5+, past month";
    case "live":
      return "Live · USGS M4.5+, past month";
    case "upload":
      return `Uploaded · ${source.fileName}`;
  }
}

/**
 * The three numbers worth knowing about the loaded set. Extends the existing
 * corner panel rather than adding a second one — same panel, one divider.
 */
function StatsBar({ stats }: { stats: QuakeStats }) {
  return (
    <dl style={styles.stats}>
      <dt style={styles.statLabel}>Events</dt>
      <dd style={styles.statValue}>{stats.count}</dd>

      <dt style={styles.statLabel}>Max mag</dt>
      <dd style={styles.statValue}>
        {stats.maxMag === null ? "—" : `M ${stats.maxMag.toFixed(1)}`}
        {stats.maxMagPlace !== null && (
          <span style={styles.statPlace}>{stats.maxMagPlace}</span>
        )}
      </dd>

      <dt style={styles.statLabel}>Depth</dt>
      <dd style={styles.statValue}>{formatDepthRange(stats)}</dd>
    </dl>
  );
}

/** e.g. "0–645 km" — an en dash, because it is a range and not a subtraction. */
function formatDepthRange({ minDepth, maxDepth }: QuakeStats): string {
  if (minDepth === null || maxDepth === null) return "—";
  return `${Math.round(minDepth)}–${Math.round(maxDepth)} km`;
}

const MODES: ReadonlyArray<{ value: MapMode; label: string }> = [
  { value: "points", label: "Points" },
  { value: "heatmap", label: "Heatmap" },
];

/**
 * Two segments rather than one on/off button: the labels say what each mode
 * shows, so nobody has to click to find out. Hover and focus styling lives in
 * globals.css — inline styles cannot express either.
 */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (next: MapMode) => void;
}) {
  return (
    <div
      className="mode-toggle"
      style={styles.toggle}
      role="group"
      aria-label="Layer mode"
    >
      {MODES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className="mode-toggle__option"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The one polygon on the map, or `null`. Only one can exist at a time —
 * `handleDraw` clears before it starts — so the first is the only.
 */
function drawnPolygon(
  draw: MapboxDraw | null,
): Feature<Polygon | MultiPolygon> | null {
  if (!draw) return null;

  for (const feature of draw.getAll().features) {
    const type = feature.geometry?.type;
    if (type === "Polygon" || type === "MultiPolygon") {
      return feature as Feature<Polygon | MultiPolygon>;
    }
  }
  return null;
}

/**
 * Whether two selections are the same features in the same order.
 *
 * Identity, not deep equality: `countPointsInPolygon` returns the very
 * features it was given (D28), so two runs over the same data yield the same
 * objects, and a reference comparison is both exact and free. 619 of them cost
 * microseconds against the millisecond a needless `setData` would cost.
 */
function sameFeatures(
  a: readonly QuakeFeature[],
  b: readonly QuakeFeature[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/** Click a point for its details; the cursor advertises that it is clickable. */
function wireInteractions(
  map: mapboxgl.Map,
  drawing: React.RefObject<boolean>,
) {
  map.on("click", LAYER_ID, (event) => {
    // While a shape is being drawn, a click on the map is a corner. Draw does
    // not stop this layer's own handler from firing, so a click that landed
    // on a quake would place a vertex *and* open a popup over the shape being
    // drawn. Nothing about the popup itself changes — only when it opens.
    if (drawing.current) return;

    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;

    const properties = (feature.properties ?? {}) as Partial<QuakeProperties>;
    const [lng, lat] = feature.geometry.coordinates;

    // Keep the popup on whichever copy of the world was actually clicked.
    let anchorLng = lng;
    while (Math.abs(event.lngLat.lng - anchorLng) > 180) {
      anchorLng += event.lngLat.lng > anchorLng ? 360 : -360;
    }

    new mapboxgl.Popup({ offset: 12, maxWidth: "280px" })
      .setLngLat([anchorLng, lat])
      .setHTML(popupHtml(properties))
      .addTo(map);
  });

  map.on("mouseenter", LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

function popupHtml(properties: Partial<QuakeProperties>): string {
  const mag =
    typeof properties.mag === "number" ? properties.mag.toFixed(1) : "—";
  const depth =
    typeof properties.depth === "number"
      ? `${properties.depth.toFixed(1)} km`
      : "—";

  return `
    <div class="quake-popup">
      <p class="quake-popup__mag">M ${escapeHtml(mag)}</p>
      <p class="quake-popup__place">${escapeHtml(properties.place ?? "Unknown location")}</p>
      <dl class="quake-popup__facts">
        <dt>Depth</dt><dd>${escapeHtml(depth)}</dd>
        <dt>Time</dt><dd>${escapeHtml(formatTime(properties.time))}</dd>
      </dl>
    </div>
  `;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** USGS timestamps are ISO 8601 UTC; show them as UTC so they are unambiguous. */
function formatTime(time: string | undefined): string {
  if (!time) return "Unknown";
  const parsed = new Date(time);
  return Number.isNaN(parsed.getTime())
    ? time
    : `${TIME_FORMAT.format(parsed)} UTC`;
}

/** `place` comes from a data file, so it is never trusted inside setHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function TokenMissing() {
  return (
    <main style={{ ...styles.root, ...styles.centered }}>
      <div style={styles.notice}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.noticeText}>
          Mapbox token missing — see <code>docs/MAPBOX_SETUP.md</code>
        </p>
        <p style={styles.noticeHint}>
          Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in <code>.env.local</code>,
          then restart the dev server.
        </p>
      </div>
    </main>
  );
}

const styles = {
  root: {
    position: "relative",
    width: "100%",
    height: "100dvh",
    overflow: "hidden",
    background: "var(--background)",
  },
  canvas: { position: "absolute", inset: 0 },
  centered: { display: "flex", alignItems: "center", justifyContent: "center" },
  // The two stacks and the grid holding them live in globals.css: keeping the
  // columns from overlapping needs media queries, which inline styles cannot
  // express. Panel chrome stays here.
  overlay: {
    maxWidth: "100%",
    padding: "0.7rem 1rem",
    borderRadius: "0.6rem",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(11, 15, 20, 0.72)",
    backdropFilter: "blur(6px)",
    pointerEvents: "none",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--foreground)",
  },
  subtitle: {
    margin: "0.2rem 0 0",
    fontSize: "0.78rem",
    letterSpacing: "0.04em",
    color: "var(--muted)",
    wordBreak: "break-word",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0.3rem 0.9rem",
    margin: "0.7rem 0 0",
    paddingTop: "0.6rem",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    fontSize: "0.78rem",
  },
  statLabel: {
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  statValue: {
    margin: 0,
    color: "var(--foreground)",
    fontVariantNumeric: "tabular-nums",
  },
  statPlace: {
    display: "block",
    maxWidth: "14rem",
    marginTop: "0.1rem",
    color: "var(--muted)",
    fontSize: "0.72rem",
    letterSpacing: 0,
    lineHeight: 1.35,
  },
  toggle: {
    display: "flex",
    gap: "0.15rem",
    padding: "0.2rem",
    borderRadius: "0.5rem",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(11, 15, 20, 0.72)",
    backdropFilter: "blur(6px)",
    pointerEvents: "auto",
  },
  notice: { maxWidth: "34rem", padding: "0 1.5rem", textAlign: "center" },
  noticeText: {
    margin: "0.75rem 0 0",
    fontSize: "1rem",
    color: "var(--foreground)",
  },
  noticeHint: {
    margin: "0.5rem 0 0",
    fontSize: "0.85rem",
    color: "var(--muted)",
  },
} satisfies Record<string, React.CSSProperties>;
