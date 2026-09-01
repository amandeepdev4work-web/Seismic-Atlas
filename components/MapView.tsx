"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";
import { APP_NAME } from "@/lib/branding";
import { parseQuakeCsv } from "@/lib/csv";
import {
  LAYER_ID,
  MAP_INIT,
  QUAKE_CIRCLE_LAYER,
  QUAKE_SOURCE,
  SAMPLE_CSV_PATH,
  SOURCE_ID,
} from "@/lib/mapbox";
import type { QuakeProperties } from "@/lib/types";

// Inlined at build time by Next; reading it at module scope keeps the
// missing-token branch a plain render decision rather than an effect.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type Status =
  | { phase: "loading" }
  | { phase: "ready"; plotted: number; skipped: number }
  | { phase: "error"; message: string };

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The map instance is a large mutable object — it lives in a ref, never in
  // state, so commanding it imperatively cannot trigger a re-render loop.
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "loading" });

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
      void loadQuakes();
    });

    async function loadQuakes() {
      try {
        const response = await fetch(SAMPLE_CSV_PATH);
        if (!response.ok) {
          throw new Error(
            `${SAMPLE_CSV_PATH} responded ${response.status} ${response.statusText}`,
          );
        }

        const { features, errors, skippedRows } = parseQuakeCsv(
          await response.text(),
        );
        if (cancelled) return;

        map.addSource(SOURCE_ID, QUAKE_SOURCE);
        map.addLayer(QUAKE_CIRCLE_LAYER);

        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features });

        wireInteractions(map);
        setStatus({
          phase: "ready",
          plotted: features.length,
          skipped: skippedRows,
        });

        if (errors.length > 0) {
          console.warn(
            `[Seismic Atlas] skipped ${skippedRows} row(s) in ${SAMPLE_CSV_PATH}:`,
            errors,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setStatus({
          phase: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  if (!MAPBOX_TOKEN) {
    return <TokenMissing />;
  }

  return (
    <main style={styles.root}>
      <div ref={containerRef} style={styles.canvas} />
      <div style={styles.overlay}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.subtitle}>{describe(status)}</p>
      </div>
    </main>
  );
}

function describe(status: Status): string {
  switch (status.phase) {
    case "loading":
      return "Loading recent earthquakes…";
    case "ready":
      return status.skipped > 0
        ? `${status.plotted} quakes · M4.5+ past month · ${status.skipped} rows skipped`
        : `${status.plotted} quakes · M4.5+ past month`;
    case "error":
      return `Could not load quake data — ${status.message}`;
  }
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
  overlay: {
    position: "absolute",
    top: "1rem",
    left: "1rem",
    zIndex: 1,
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
  },
  notice: { maxWidth: "34rem", padding: "0 1.5rem", textAlign: "center" },
  noticeText: {
    margin: "0.75rem 0 0",
    fontSize: "1rem",
    color: "var(--foreground)",
  },
  noticeHint: { margin: "0.5rem 0 0", fontSize: "0.85rem", color: "var(--muted)" },
} satisfies Record<string, React.CSSProperties>;
