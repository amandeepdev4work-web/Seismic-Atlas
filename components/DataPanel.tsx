"use client";

import { useRef } from "react";
import { FILE_INPUT_ACCEPT } from "@/lib/upload";

/**
 * A one-line result of the last load attempt. `error` keeps the previous data
 * on the map, so it reports what did *not* happen rather than what broke.
 */
export type Notice = { tone: "info" | "error"; text: string };

/**
 * Where the map's data comes from, and how to change it: upload a CSV, or go
 * back to the bundled sample.
 *
 * The picker is a hidden `<input type="file">` driven by a real button — no
 * `<form>`, since there is nothing to submit anywhere; the file never leaves
 * the browser.
 */
export default function DataPanel({
  sourceLabel,
  busy,
  canReset,
  notice,
  onFile,
  onReset,
  onDismissNotice,
}: {
  sourceLabel: string;
  busy: boolean;
  canReset: boolean;
  notice: Notice | null;
  onFile: (file: File) => void;
  onReset: () => void;
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
  input: { display: "none" },
} satisfies Record<string, React.CSSProperties>;
