"use client";

/** How many of the loaded quakes fall inside the drawn polygon. */
export type Selection = { inside: number; total: number };

/**
 * The polygon filter: one button to draw a shape, one to remove it, and the
 * count of what is inside.
 *
 * The control and its readout are one panel rather than a control on the right
 * and a number on the left, because the number is the answer to the button —
 * splitting them across the map would make the user look in two places for one
 * thought. It joins the existing right-hand stack under the mode toggle; the
 * overlay is a two-column grid and a third floating box would reintroduce
 * exactly the overlap that grid exists to prevent (D24).
 *
 * Buttons reuse `.data-panel__button`, the language already shared by the data
 * panel and the mapper, so this reads as one more control rather than a new
 * kind of thing.
 */
export default function SelectionPanel({
  drawing,
  selection,
  onDraw,
  onClear,
}: {
  drawing: boolean;
  selection: Selection | null;
  onDraw: () => void;
  onClear: () => void;
}) {
  return (
    <section style={styles.panel} aria-label="Polygon selection">
      <div style={styles.row}>
        <button
          type="button"
          className="data-panel__button"
          // The pressed state *is* the aria attribute, so what the eye sees
          // and what a screen reader is told cannot drift apart — the same
          // rule the mode toggle follows.
          aria-pressed={drawing}
          onClick={onDraw}
        >
          Draw area
        </button>
        {selection && (
          <button type="button" className="data-panel__button" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {/* Polite, not assertive: the count changes as a side effect of what the
          user is already doing, so it should be read after them, not over. */}
      <p style={styles.readout} aria-live="polite">
        {selection ? (
          <>
            <span style={styles.count}>{selection.inside}</span> of{" "}
            {selection.total} inside selection
          </>
        ) : drawing ? (
          "Click to place corners, double-click to finish. Esc cancels."
        ) : (
          "Draw a polygon to filter."
        )}
      </p>

      {/* The count recomputing as a corner is dragged is the whole trick, and
          Draw hides its vertex handles until the shape is selected — so the
          one line that would otherwise be blank says where to find them. */}
      {selection && (
        <p style={styles.hint}>Click the shape to move its corners.</p>
      )}
    </section>
  );
}

const styles = {
  panel: {
    pointerEvents: "auto",
    width: "15.5rem",
    padding: "0.55rem 0.65rem 0.6rem",
    borderRadius: "0.6rem",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(11, 15, 20, 0.72)",
    backdropFilter: "blur(6px)",
  },
  row: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  readout: {
    margin: "0.45rem 0 0",
    color: "var(--muted)",
    fontSize: "0.66rem",
    lineHeight: 1.35,
  },
  hint: {
    margin: "0.2rem 0 0",
    color: "var(--muted)",
    fontSize: "0.62rem",
    lineHeight: 1.35,
    opacity: 0.8,
  },
  // The one number worth reading at a glance, so it gets the foreground.
  count: {
    color: "var(--foreground)",
    fontSize: "0.82rem",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
} satisfies Record<string, React.CSSProperties>;
