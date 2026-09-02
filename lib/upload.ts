/**
 * Everything the upload flow needs to decide before a file reaches the parser,
 * plus the clamping every file-derived string goes through on its way to the
 * UI. Pure: no DOM, no fetch, no globals, so all of it is unit-testable.
 *
 * The rule these functions exist to enforce: nothing a user picked off their
 * disk is ever rendered verbatim. A `.zip` decodes to thousands of replacement
 * characters, and papaparse will happily quote a run of them back at us inside
 * a row-skip message. React escapes, so this was never an injection hole — but
 * a panel full of binary is still the file talking to the user in our voice,
 * which is the same principle D8 applies to popups.
 */

/** Hard ceiling: the file is read into memory in one go. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Extensions the guard accepts. Anything delimited; papaparse sniffs which. */
export const ACCEPTED_EXTENSIONS = ["csv", "tsv", "txt"] as const;

/**
 * What the file picker advertises. Extensions *and* MIME types, because
 * Windows reports `.csv` as `application/vnd.ms-excel` often enough that a
 * MIME-only filter hides the very files this app is for.
 */
export const FILE_INPUT_ACCEPT =
  ".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";

/** The one line shown for any file we cannot make sense of. */
export function unreadableMessage(fileName: string): string {
  return `Couldn’t read ${safeFileName(fileName)} — please upload a .csv.`;
}

/** The subset of `File` this module needs, so tests need no `File`. */
export interface UploadCandidate {
  name: string;
  size: number;
  /** The browser's guess. Advisory only — the extension is the real signal. */
  type?: string;
}

/**
 * Decides whether a picked file is worth reading at all.
 *
 * Returns `null` for "go ahead", or the complete message to show the user.
 * This runs before any read, so a 40 MB zip costs nothing but a glance at its
 * name. It is a first line of defence, not the only one: an extension is a
 * claim, so {@link looksBinary} checks the bytes afterwards.
 */
export function checkUploadFile(file: UploadCandidate): string | null {
  const name = safeFileName(file.name);

  if (file.size === 0) {
    return `${name} is empty — please upload a .csv with a header row.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const megabytes = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return `${name} is ${megabytes} MB — the limit is 25 MB.`;
  }

  if (!hasReadableType(file)) return unreadableMessage(file.name);

  return null;
}

/** Extension first, MIME only as a tie-breaker when there is no extension. */
function hasReadableType({ name, type }: UploadCandidate): boolean {
  const extension = extensionOf(name);

  if (extension !== "") {
    return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
  }

  // No extension at all: fall back to what the browser says it is.
  const mime = (type ?? "").trim().toLowerCase();
  return mime.startsWith("text/") || mime === "application/csv";
}

/** Lowercased text after the last dot, or "" when there is no extension. */
function extensionOf(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  return dot <= 0 || dot === trimmed.length - 1 ? "" : trimmed.slice(dot + 1);
}

/**
 * Whether decoded text is really binary that has been forced through a UTF-8
 * decoder.
 *
 * `File.text()` never throws — it substitutes U+FFFD for every byte sequence it
 * cannot decode — so a zip arrives as a long string of replacement characters
 * rather than as an error. Two signals catch it: a NUL byte, which no text CSV
 * contains, and a high proportion of replacement or control characters.
 *
 * The threshold is deliberately generous, and was set by measuring both ends
 * rather than by taste. A Latin-1 CSV of Spanish place names decodes to about
 * one replacement character per row — 2-3% — and must still load, since a
 * mangled `place` is cosmetic and never costs a row (D4). A zip or a PNG runs
 * past 30%. 10% sits between the two with room on both sides, and the NUL
 * check above catches the container formats long before the ratio matters.
 */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;
  if (sample.includes("\u0000")) return true;

  let suspicious = 0;
  for (const character of sample) {
    if (character === "\ufffd" || isControl(character)) suspicious += 1;
  }

  return suspicious / sample.length > 0.1;
}

/** C0/C1 controls, minus the three that are ordinary CSV whitespace. */
function isControl(character: string): boolean {
  if (character === "\n" || character === "\r" || character === "\t") {
    return false;
  }
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Makes any file-derived string safe to put in a one-line notice: control
 * characters and replacement characters out, runs of whitespace collapsed,
 * length capped with an ellipsis.
 *
 * Cosmetic as much as defensive — a 300-character filename or a quoted row of
 * junk would blow a corner panel apart regardless of what it contained.
 */
export function safeMessage(raw: string, maxLength = 120): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\ufffd]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Same treatment, shorter leash: a name sits inside a longer sentence. */
export function safeFileName(name: string, maxLength = 42): string {
  return safeMessage(name, maxLength) || "that file";
}

/**
 * One line describing why a parse produced nothing usable: the first message,
 * clamped, plus how many others there were.
 *
 * The full list still goes to the console — a corner overlay listing 600
 * messages is not a UI (D18) — and if the first message survives clamping as
 * nothing at all, which is what a row of binary reduces to, the caller gets a
 * plain sentence instead of an empty gap.
 */
export function summarizeErrors(errors: readonly string[]): string {
  if (errors.length === 0) return "It has no data rows.";

  const first = safeMessage(errors[0]);
  const body = first === "" ? "Its rows could not be read." : first;
  const others = errors.length - 1;

  return others > 0 ? `${body} (+${others} more)` : body;
}
