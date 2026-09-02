"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";
import ColumnMapper from "@/components/ColumnMapper";
import DataPanel, { type Notice } from "@/components/DataPanel";
import Legend from "@/components/Legend";
import { APP_NAME } from "@/lib/branding";
import {
  detectMapping,
  guessMapping,
  readCsvHeaders,
  type ColumnMapping,
  type MappingDraft,
} from "@/lib/columns";
import { parseQuakeCsv } from "@/lib/csv";
import {
  HEATMAP_LAYER_ID,
  LAYER_ID,
  MAP_INIT,
  QUAKE_CIRCLE_LAYER,
  QUAKE_HEATMAP_LAYER,
  QUAKE_SOURCE,
  SAMPLE_CSV_PATH,
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

/** Where the plotted features came from, and how that reads in the panels. */
type DataSource =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "sample"; plotted: number }
  | { kind: "upload"; fileName: string; plotted: number };

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
  // The parsed sample, kept so "reset to sample" costs no fetch and no reparse.
  const sampleRef = useRef<QuakeFeature[] | null>(null);

  // All plain UI state. None of it holds anything the map owns, so none of it
  // can trigger the render loop D3 keeps the map instance out of.
  const [dataSource, setDataSource] = useState<DataSource>({ kind: "loading" });
  const [layersReady, setLayersReady] = useState(false);
  const [mode, setMode] = useState<MapMode>("points");
  const [stats, setStats] = useState<QuakeStats | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mapper, setMapper] = useState<MapperState | null>(null);
  const [busy, setBusy] = useState(false);

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
      wireInteractions(map);
      if (cancelled) return;
      setLayersReady(true);
      void loadSample();
    });

    async function loadSample() {
      try {
        const { features, errors, skippedRows } = await fetchSample();
        if (cancelled) return;

        sampleRef.current = features;
        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features });

        // Computed once, from the same features that were just handed to the
        // source. Nothing recomputes it on toggle.
        setStats(computeStats(features));
        setDataSource({ kind: "sample", plotted: features.length });

        if (errors.length > 0) {
          console.warn(
            `[Seismic Atlas] skipped ${skippedRows} row(s) in ${SAMPLE_CSV_PATH}:`,
            errors,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setDataSource({ kind: "error", message: describeError(error) });
      }
    }

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switching modes is two layout-property flips on layers that already exist
  // and already hold the data — no refetch, no reparse, no setData.
  useEffect(() => {
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
  }, [mode, layersReady]);

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

    source.setData({ type: "FeatureCollection", features });
    setStats(computeStats(features));
    if (options.fit) fitToFeatures(map, features);
    return true;
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

    setDataSource({ kind: "upload", fileName, plotted: features.length });
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
    setDataSource({ kind: "sample", plotted: features.length });
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
              <DataPanel
                sourceLabel={sourceLabel(dataSource)}
                busy={busy}
                canReset={dataSource.kind === "upload"}
                notice={notice}
                onFile={(file) => void handleFile(file)}
                onReset={() => void handleReset()}
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

/** Click a point for its details; the cursor advertises that it is clickable. */
function wireInteractions(map: mapboxgl.Map) {
  map.on("click", LAYER_ID, (event) => {
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
