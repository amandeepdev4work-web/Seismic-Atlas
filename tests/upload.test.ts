import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  checkUploadFile,
  looksBinary,
  safeFileName,
  safeMessage,
  summarizeErrors,
} from "@/lib/upload";

/** Built rather than written as escapes, so nothing in the toolchain eats them. */
const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const REPLACEMENT = String.fromCharCode(0xfffd);

/** What `File.text()` hands back when the file was never text. */
function decodedBinary(length: number): string {
  return REPLACEMENT.repeat(length);
}

describe("checkUploadFile", () => {
  it("accepts a plain CSV", () => {
    expect(checkUploadFile({ name: "quakes.csv", size: 4096 })).toBeNull();
  });

  it("accepts the extension whatever its case, and the tab/text cousins", () => {
    for (const name of ["QUAKES.CSV", "quakes.Csv", "quakes.tsv", "notes.txt"]) {
      expect(checkUploadFile({ name, size: 10 })).toBeNull();
    }
  });

  it("accepts a .csv that Windows reports as a spreadsheet", () => {
    // Chrome on Windows types .csv as application/vnd.ms-excel; filtering on
    // MIME alone would reject the exact files this app exists for.
    expect(
      checkUploadFile({
        name: "quakes.csv",
        size: 4096,
        type: "application/vnd.ms-excel",
      }),
    ).toBeNull();
  });

  it("rejects a zip, an image and anything else that is not text", () => {
    for (const file of [
      { name: "archive.zip", size: 900_000, type: "application/zip" },
      { name: "photo.png", size: 500_000, type: "image/png" },
      { name: "report.pdf", size: 20_000, type: "application/pdf" },
      { name: "sheet.xlsx", size: 20_000 },
    ]) {
      const problem = checkUploadFile(file);
      expect(problem).toContain("please upload a .csv");
      expect(problem).toContain(file.name);
    }
  });

  it("falls back to the MIME type only when there is no extension", () => {
    expect(checkUploadFile({ name: "quakes", size: 10, type: "text/csv" })).toBeNull();
    expect(
      checkUploadFile({ name: "quakes", size: 10, type: "application/zip" }),
    ).toContain("please upload a .csv");
    // A trailing dot names no extension either.
    expect(checkUploadFile({ name: "quakes.", size: 10 })).toContain(
      "please upload a .csv",
    );
  });

  it("rejects an empty file before anything tries to read it", () => {
    expect(checkUploadFile({ name: "quakes.csv", size: 0 })).toContain("is empty");
  });

  it("rejects a file over the size ceiling, and says how big it was", () => {
    const problem = checkUploadFile({
      name: "huge.csv",
      size: MAX_UPLOAD_BYTES + 1024 * 1024,
    });

    expect(problem).toContain("26 MB");
    expect(problem).toContain("the limit is 25 MB");
  });

  it("never echoes a hostile file name back at full length", () => {
    const problem = checkUploadFile({
      name: `${"a".repeat(300)}${BELL}.zip`,
      size: 10,
    });

    expect(problem).not.toContain(BELL);
    expect(problem!.length).toBeLessThan(100);
  });
});

describe("looksBinary", () => {
  it("passes ordinary CSV text, including tabs and CRLF", () => {
    expect(looksBinary("time,latitude,longitude\r\n2026-01-01,10,20\r\n")).toBe(
      false,
    );
    expect(looksBinary("a\tb\tc\n1\t2\t3\n")).toBe(false);
  });

  it("passes an empty string rather than calling it binary", () => {
    expect(looksBinary("")).toBe(false);
  });

  it("catches a NUL byte, which no text CSV contains", () => {
    expect(looksBinary(`time,lat,lon${NUL}garbage`)).toBe(true);
  });

  it("catches a file that decoded mostly to replacement characters", () => {
    expect(looksBinary(`PK${decodedBinary(400)}`)).toBe(true);
  });

  it("catches control-character noise even without a NUL", () => {
    expect(looksBinary(BELL.repeat(50) + "some text")).toBe(true);
  });

  it("still accepts a mis-encoded CSV with mangled accents", () => {
    // A Latin-1 file decoded as UTF-8: replacement characters scattered through
    // otherwise good text must still load, since a mangled place name is
    // cosmetic and never costs a row (D4). This row is ~2.3% replacements.
    const row = `2026-01-01,10,20,4.9,Ba${REPLACEMENT}a de Caraquez\n`;
    expect(looksBinary(row.repeat(30))).toBe(false);
  });

  it("holds the line between mangled text and actual binary", () => {
    // Twice as damaged as the row above — three mangled accents in a 57-char
    // Spanish row, about 5% — and still unmistakably a CSV.
    const damaged =
      `2026-01-01T00:00:00Z,10.5,-75.2,4.9,` +
      `${REPLACEMENT}vila,C${REPLACEMENT}rdoba,Espa${REPLACEMENT}a\n`;
    expect(looksBinary(damaged.repeat(40))).toBe(false);

    // A third of the characters unreadable is not a CSV by any reading.
    expect(looksBinary(`a,b,c${decodedBinary(200)}`)).toBe(true);
  });

  it("only reads the head of a large file", () => {
    const clean = "time,lat,lon\n".repeat(600);
    expect(clean.length).toBeGreaterThan(4096);
    expect(looksBinary(clean + decodedBinary(5000))).toBe(false);
  });
});

describe("safeMessage", () => {
  it("leaves a short, clean message exactly as it is", () => {
    const message = "Row 3 skipped — latitude is missing.";
    expect(safeMessage(message)).toBe(message);
  });

  it("strips control and replacement characters", () => {
    expect(safeMessage(`Row 3${NUL}${BELL} skipped${REPLACEMENT}`)).toBe(
      "Row 3 skipped",
    );
  });

  it("collapses newlines and runs of whitespace onto one line", () => {
    expect(safeMessage("Row 3\n\n  skipped   —\tlatitude")).toBe(
      "Row 3 skipped — latitude",
    );
  });

  it("truncates to the cap and marks that it did", () => {
    const clamped = safeMessage("x".repeat(400), 40);

    expect(clamped).toHaveLength(40);
    expect(clamped.endsWith("…")).toBe(true);
  });

  it("reduces a message that was nothing but binary to an empty string", () => {
    expect(safeMessage(decodedBinary(200))).toBe("");
  });
});

describe("safeFileName", () => {
  it("clamps a very long name", () => {
    expect(safeFileName(`${"quake".repeat(40)}.csv`).length).toBeLessThanOrEqual(
      42,
    );
  });

  it("names something rather than nothing when the name is unusable", () => {
    expect(safeFileName(decodedBinary(30))).toBe("that file");
  });
});

describe("summarizeErrors", () => {
  it("explains an empty list without pretending a row failed", () => {
    expect(summarizeErrors([])).toBe("It has no data rows.");
  });

  it("shows one message on its own", () => {
    expect(summarizeErrors(["Row 3 skipped — mag is missing."])).toBe(
      "Row 3 skipped — mag is missing.",
    );
  });

  it("counts the rest instead of listing them", () => {
    expect(
      summarizeErrors(["Row 2 skipped — mag is missing.", "b", "c"]),
    ).toBe("Row 2 skipped — mag is missing. (+2 more)");
  });

  it("caps a message that quoted a huge cell", () => {
    const summary = summarizeErrors([
      `Row 2 skipped — mag is not a number (got "${"x".repeat(5000)}").`,
    ]);

    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary).toContain("Row 2 skipped");
  });

  it("says something readable when the message was pure binary", () => {
    const summary = summarizeErrors([
      `${decodedBinary(80)}`,
      `${decodedBinary(80)}`,
    ]);

    expect(summary).toBe("Its rows could not be read. (+1 more)");
    expect(summary).not.toContain(REPLACEMENT);
  });
});
