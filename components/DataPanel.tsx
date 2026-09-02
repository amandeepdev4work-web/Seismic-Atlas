"use client";

import { useEffect, useRef, useState } from "react";
import { REFRESH_INTERVAL_MS } from "@/lib/live";
import { FILE_INPUT_ACCEPT } from "@/lib/upload";

/**
 * A one-line result of the last load attempt. `error` keeps the previous data
 * on the map, so it reports what did *not* happen rather than what broke.
 */
export type Notice = { tone: "info" | "error"; text: string };

/**
 * Where the map's data comes from, and how to change it: upload a CSV, go back
 * to the bundled sample, or pull the live feed again.
 *
 * The picker is a hidden `<input type="file">` driven by a real button — no
 * `<form>`, since there is nothing to submit anywhere; the file never leaves
 * the browser.
 *
 * Phase 5's refresh control lives here rather than in a panel of its own. The
 * right-hand column already holds four things and the corners are the binding
 * constraint on this layout; this panel is the one that already says where the
 * data came from, which is exactly where "and it updated 40 seconds ago"
 * belongs (D31).
 */
export default function DataPanel({
  sourceLabel,
  busy,
  canReset,
  live,
  refreshing,
  lastUpdated,
  notice,
  onFile,
  onReset,
  onRefresh,
  onDismissNotice,
}: {
  sourceLabel: string;
  busy: boolean;
  canReset: boolean;
  /** Whether the live feed is the thing on the map — false while an upload is. */
  live: boolean;
  refreshing: boolean;
  /** When the feed last came back, or null if it never has this session. */
  lastUpdated: number | null;
  notice: Notice | null;
  onFile: (file: File) => void;
  onReset: () => void;
  onRefresh: () => void;
  onDismissNotice: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section style={styles.panel} aria-label="Data source">
      <div style={styles.row}>
        <button
          type="button"
          className="data-panel__button data-panel__button--primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Reading…" : "Upload CSV"}
        </button>
        {/* Hidden rather than disabled while an upload is showing. A disabled
            button asks the reader to work out why; the status line below says
            it in words, and the space is spent on that instead. */}
        {live && (
          <button
            type="button"
            className="data-panel__button"
            disabled={busy || refreshing}
            onClick={onRefresh}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
        {canReset && (
          <button
            type="button"
            className="data-panel__button"
            disabled={busy}
            onClick={onReset}
          >
            Reset to sample
          </button>
        )}
      </div>

      <p style={styles.source}>{sourceLabel}</p>

      {/* One quiet line, polite rather than assertive: it changes on a timer
          and must never interrupt whatever a screen reader is in the middle
          of. */}
      <p style={styles.status} aria-live="polite">
        {!live ? (
          "Auto-refresh paused while your file is shown."
        ) : refreshing ? (
          <>
            <span className="data-panel__dot" aria-hidden="true" />
            Fetching the latest events…
          </>
        ) : lastUpdated === null ? (
          `Live · refreshes every ${Math.round(REFRESH_INTERVAL_MS / 1000)}s`
        ) : (
          <ElapsedSince at={lastUpdated} />
        )}
      </p>

      {notice && (
        <div
          className={`data-panel__notice data-panel__notice--${notice.tone}`}
          role="status"
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="data-panel__dismiss"
            aria-label="Dismiss message"
            onClick={onDismissNotice}
          >
            ×
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        // Extensions and MIME types both: Windows types .csv as an Excel
        // file, so a MIME-only filter would grey out the very files this app
        // is for. The real check is `checkUploadFile`, which runs on what
        // comes back — `accept` is a convenience, never a guarantee.
        accept={FILE_INPUT_ACCEPT}
        style={styles.input}
        // Cleared on every pick so choosing the same file twice still fires.
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </section>
  );
}

/**
 * "Updated 42s ago", ticking.
 *
 * Its own component with its own interval on purpose: a clock in `MapView`
 * would re-render the whole overlay — legend, toggle, selection panel, mapper
 * — once a second for the sake of two characters. Here the once-a-second
 * render is a single line of text.
 */
function ElapsedSince({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return <>Updated {formatAgo(now - at)}</>;
}

/** Coarse on purpose — nobody needs the second, only the freshness. */
function formatAgo(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
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
  source: {
    margin: "0.45rem 0 0",
    color: "var(--muted)",
    fontSize: "0.66rem",
    lineHeight: 1.35,
    wordBreak: "break-word",
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    margin: "0.15rem 0 0",
    color: "var(--muted)",
    fontSize: "0.63rem",
    lineHeight: 1.35,
    opacity: 0.85,
    fontVariantNumeric: "tabular-nums",
  },
  input: { display: "none" },
} satisfies Record<string, React.CSSProperties>;
