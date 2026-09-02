"use client";

import { useState } from "react";
import {
  DENSITY_LEGEND_STOPS,
  DEPTH_LEGEND_STOPS,
  MAGNITUDE_LEGEND_STOPS,
  type MapMode,
} from "@/lib/mapbox";

/**
 * What the colours and sizes on the map mean — and, crucially, that they mean
 * two different things either side of the toggle. In Points mode colour is
 * depth; in Heatmap mode it is density. That ambiguity was noted as acceptable
 * only because the modes are mutually exclusive (D13/D15); the legend is what
 * makes it legible rather than merely defensible.
 *
 * Collapsible, and small enough that nobody needs to collapse it: the map is
 * the point, this is a footnote.
 */
export default function Legend({ mode }: { mode: MapMode }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="legend" style={styles.panel} aria-label="Legend">
      <button
        type="button"
        className="legend__toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span>Legend</span>
        <span aria-hidden="true" className="legend__chevron">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open &&
        (mode === "points" ? <PointsLegend /> : <HeatmapLegend />)}
    </section>
  );
}

function PointsLegend() {
  return (
    <div style={styles.body}>
      <p style={styles.caption}>Circle size — magnitude</p>
      <div style={styles.magRow}>
        {MAGNITUDE_LEGEND_STOPS.map(({ mag, px }) => (
          <div key={mag} style={styles.magItem}>
            <span style={{ ...styles.magDot, width: px, height: px }} />
            <span style={styles.magLabel}>M{mag}</span>
          </div>
        ))}
      </div>

      <p style={{ ...styles.caption, marginTop: "0.7rem" }}>
        Circle colour — depth
      </p>
      <div style={{ ...styles.ramp, background: rampCss(DEPTH_LEGEND_STOPS) }} />
      {/* Ticks are positioned at their true fraction of the ramp, not spread
          evenly: the depth interpolation is front-loaded (300 km sits at 43%
          of the bar, not halfway), and evenly spaced labels would misread it. */}
      <div style={styles.scaleTrack}>
        {DEPTH_TICKS.map((km, index) => (
          <span
            key={km}
            style={{
              ...styles.tick,
              left: `${(km / DEEPEST) * 100}%`,
              transform: tickShift(index, DEPTH_TICKS.length),
            }}
          >
            {km === DEEPEST ? `${km} km` : km}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The deepest stop the ramp covers — the scale it is drawn against. */
const DEEPEST = DEPTH_LEGEND_STOPS[DEPTH_LEGEND_STOPS.length - 1].km;
const DEPTH_TICKS = [0, 300, DEEPEST];

/** Ends sit inside the bar; anything between is centred on its own mark. */
function tickShift(index: number, count: number): string {
  if (index === 0) return "translateX(0)";
  if (index === count - 1) return "translateX(-100%)";
  return "translateX(-50%)";
}

function HeatmapLegend() {
  return (
    <div style={styles.body}>
      <p style={styles.caption}>Colour — quake density</p>
      <div
        style={{ ...styles.ramp, background: rampCss(DENSITY_LEGEND_STOPS) }}
      />
      <div style={styles.scale}>
        <span>Sparse</span>
        <span>Dense</span>
      </div>
      <p style={styles.note}>
        Brightness is how many quakes fall nearby, not how deep or how big any
        one of them is. Magnitude nudges the weight; clustering does the rest.
      </p>
    </div>
  );
}

/** Stops → a CSS gradient, spaced by the same fractions the layer uses. */
function rampCss(
  stops: ReadonlyArray<{ km?: number; at?: number; color: string }>,
): string {
  const values = stops.map((stop) => stop.km ?? stop.at ?? 0);
  const max = values[values.length - 1] || 1;
  const parts = stops.map(
    (stop, index) => `${stop.color} ${((values[index] / max) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

const styles = {
  panel: {
    pointerEvents: "auto",
    width: "13.5rem",
    padding: "0.5rem 0.7rem 0.6rem",
    borderRadius: "0.6rem",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(11, 15, 20, 0.72)",
    backdropFilter: "blur(6px)",
  },
  body: { marginTop: "0.45rem" },
  caption: {
    margin: 0,
    color: "var(--muted)",
    fontSize: "0.68rem",
    letterSpacing: "0.05em",
  },
  magRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "0.85rem",
    margin: "0.45rem 0 0",
    paddingLeft: "0.1rem",
  },
  magItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.25rem",
  },
  // The stroke matches the circle layer's, so the swatch is the same object.
  magDot: {
    display: "block",
    borderRadius: "50%",
    background: "rgba(255, 209, 102, 0.8)",
    boxShadow: "0 0 0 0.6px rgba(255, 255, 255, 0.35)",
  },
  magLabel: {
    color: "var(--muted)",
    fontSize: "0.62rem",
    fontVariantNumeric: "tabular-nums",
  },
  ramp: {
    height: "0.5rem",
    margin: "0.4rem 0 0.25rem",
    borderRadius: "0.25rem",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  scale: {
    display: "flex",
    justifyContent: "space-between",
    color: "var(--muted)",
    fontSize: "0.62rem",
    fontVariantNumeric: "tabular-nums",
  },
  scaleTrack: {
    position: "relative",
    height: "0.8rem",
    color: "var(--muted)",
    fontSize: "0.62rem",
    fontVariantNumeric: "tabular-nums",
  },
  tick: { position: "absolute", top: 0, whiteSpace: "nowrap" },
  note: {
    margin: "0.5rem 0 0",
    color: "var(--muted)",
    fontSize: "0.64rem",
    lineHeight: 1.4,
  },
} satisfies Record<string, React.CSSProperties>;
