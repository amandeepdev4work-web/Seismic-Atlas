"use client";

import { useId, useState } from "react";
import Select, { type SelectOption } from "@/components/Select";
import {
  ALL_FIELDS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  toMapping,
  validateMapping,
  type ColumnMapping,
  type MappingDraft,
  type QuakeField,
} from "@/lib/columns";

const REQUIRED = new Set<QuakeField>(REQUIRED_FIELDS);

/**
 * Shown only when a file does not name its columns the way USGS does. One
 * dropdown per field, pre-filled with {@link import("@/lib/columns").guessMapping}'s
 * best guess so the common case is "check three lines, press Load".
 *
 * The dropdowns are {@link Select}, not native `<select>`: Chrome on Windows
 * renders the native option list light and unreadable against this panel, and
 * ignores every attempt to theme it.
 *
 * All this component decides is which column name goes with which field; the
 * parsing, the validation and the error messages all belong to `lib/`, which
 * is where they can be tested (D9).
 */
export default function ColumnMapper({
  fileName,
  headers,
  initial,
  onApply,
  onCancel,
}: {
  fileName: string;
  headers: readonly string[];
  initial: MappingDraft;
  onApply: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}) {
  const idBase = useId();
  const labelId = (field: QuakeField) => `${idBase}-${field}`;

  const [draft, setDraft] = useState<MappingDraft>(initial);
  const problems = validateMapping(draft, headers);
  const ready = problems.length === 0;

  return (
    <section className="mapper" style={styles.panel} aria-label="Map CSV columns">
      <header style={styles.header}>
        <h2 style={styles.title}>Map columns</h2>
        <p style={styles.hint}>
          <span style={styles.file}>{fileName}</span> does not use the USGS
          column names. Point each field at one of its columns.
        </p>
      </header>

      <div style={styles.fields}>
        {ALL_FIELDS.map((field) => (
          <div key={field} style={styles.field}>
            <span id={labelId(field)} style={styles.label}>
              {FIELD_LABELS[field]}
              {REQUIRED.has(field) && (
                <>
                  <span style={styles.required} aria-hidden="true">
                    {" *"}
                  </span>
                  <span className="visually-hidden"> (required)</span>
                </>
              )}
            </span>
            <Select
              value={draft[field]}
              options={optionsFor(headers, REQUIRED.has(field))}
              labelledBy={labelId(field)}
              onChange={(column) =>
                setDraft((current) => ({ ...current, [field]: column }))
              }
            />
          </div>
        ))}
      </div>

      <p style={styles.footnote}>
        {ready
          ? "Rows whose mapped values are not numbers will be skipped and counted."
          : `Still needed: ${problems.join("; ")}.`}
      </p>

      <div style={styles.actions}>
        <button type="button" className="mapper__button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="mapper__button mapper__button--primary"
          disabled={!ready}
          onClick={() => onApply(toMapping(draft))}
        >
          Load
        </button>
      </div>
    </section>
  );
}

/** The file's columns, behind an entry for "none of them". */
function optionsFor(
  headers: readonly string[],
  required: boolean,
): SelectOption[] {
  return [
    { value: "", label: required ? "Choose a column…" : "Not in this file" },
    ...headers.map((header) => ({ value: header, label: header })),
  ];
}

const styles = {
  panel: {
    pointerEvents: "auto",
    width: "15.5rem",
    maxWidth: "100%",
    // Height is deliberately NOT here: the panel shrinks and scrolls inside
    // itself so it can never push its column into the other one, and the
    // narrow-viewport rule tightens that cap. An inline max-height would beat
    // the media query. See `.mapper` in globals.css.
    padding: "0.7rem 0.8rem 0.75rem",
    borderRadius: "0.6rem",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    background: "rgba(11, 15, 20, 0.88)",
    backdropFilter: "blur(8px)",
    boxShadow: "0 12px 30px rgba(0, 0, 0, 0.45)",
  },
  header: { marginBottom: "0.6rem" },
  title: {
    margin: 0,
    color: "var(--foreground)",
    fontSize: "0.8rem",
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  hint: {
    margin: "0.25rem 0 0",
    color: "var(--muted)",
    fontSize: "0.66rem",
    lineHeight: 1.45,
  },
  file: { color: "var(--foreground)", wordBreak: "break-all" },
  fields: { display: "grid", gap: "0.4rem" },
  field: { display: "grid", gap: "0.15rem" },
  label: {
    color: "var(--muted)",
    fontSize: "0.64rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  required: { color: "#e0a05a" },
  footnote: {
    margin: "0.6rem 0 0",
    color: "var(--muted)",
    fontSize: "0.62rem",
    lineHeight: 1.4,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.35rem",
    marginTop: "0.6rem",
  },
} satisfies Record<string, React.CSSProperties>;
