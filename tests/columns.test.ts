import { describe, expect, it } from "vitest";
import {
  USGS_MAPPING,
  detectMapping,
  guessMapping,
  readCsvHeaders,
  toMapping,
  validateMapping,
  type ColumnMapping,
} from "@/lib/columns";
import { parseQuakeCsv } from "@/lib/csv";

/**
 * A file that is shaped like quake data but names nothing the way USGS does:
 * latitude is `Y`, longitude is `X`, and `Site` is text.
 */
const ODD_HEADER = "Site,Y,X,Magnitude,Depth (km),When";

function oddCsv(...rows: string[]): string {
  return [ODD_HEADER, ...rows].join("\n");
}

const ODD_MAPPING: ColumnMapping = {
  latitude: "Y",
  longitude: "X",
  mag: "Magnitude",
  depth: "Depth (km)",
  place: "Site",
  time: "When",
};

describe("readCsvHeaders", () => {
  it("returns the trimmed header row, dropping columns with no name", () => {
    // A repeated name is suffixed by papaparse and is genuinely a second
    // selectable column; an unnamed one keys nothing and is dropped.
    expect(readCsvHeaders("a, b ,,a,c\n1,2,3,4,5")).toEqual([
      "a",
      "b",
      "a_1",
      "c",
    ]);
  });

  it("returns nothing for input with no header row", () => {
    expect(readCsvHeaders("")).toEqual([]);
    expect(readCsvHeaders("   \n  ")).toEqual([]);
  });

  it("reads the header without needing any data rows", () => {
    expect(readCsvHeaders(ODD_HEADER)).toEqual([
      "Site",
      "Y",
      "X",
      "Magnitude",
      "Depth (km)",
      "When",
    ]);
  });
});

describe("detectMapping", () => {
  it("maps a USGS-shaped file with no questions asked", () => {
    const headers = readCsvHeaders("time,latitude,longitude,depth,mag,place");
    expect(detectMapping(headers)).toEqual(USGS_MAPPING);
  });

  it("matches column names case-insensitively, keeping the file's spelling", () => {
    expect(detectMapping(["Latitude", "LONGITUDE", "Mag"])).toEqual({
      latitude: "Latitude",
      longitude: "LONGITUDE",
      mag: "Mag",
    });
  });

  it("omits optional fields the file does not have", () => {
    const mapping = detectMapping(["latitude", "longitude", "mag", "depth"]);
    expect(mapping).toEqual({
      latitude: "latitude",
      longitude: "longitude",
      mag: "mag",
      depth: "depth",
    });
    expect(mapping && "place" in mapping).toBe(false);
  });

  it("returns null when a required column is absent, so the UI can ask", () => {
    expect(detectMapping(["latitude", "longitude", "depth"])).toBeNull();
    expect(detectMapping(readCsvHeaders(ODD_HEADER))).toBeNull();
  });
});

describe("guessMapping", () => {
  it("pre-fills what it recognises, and leaves the rest for the user", () => {
    // `Site` and `When` are not spellings of place and time that anything
    // should guess at: a wrong guess plots the wrong column, an empty one
    // costs a click. The three required fields are what matter, and they fill.
    expect(guessMapping(readCsvHeaders(ODD_HEADER))).toEqual({
      latitude: "Y",
      longitude: "X",
      mag: "Magnitude",
      depth: "Depth (km)",
      place: "",
      time: "",
    });
  });

  it("ignores punctuation and case when matching a spelling", () => {
    expect(guessMapping(["LAT", "Long", "Mw", "depth_km"])).toEqual({
      latitude: "LAT",
      longitude: "Long",
      mag: "Mw",
      depth: "depth_km",
      place: "",
      time: "",
    });
  });

  it("gives every field its own column, never the same one twice", () => {
    const draft = guessMapping(["lat", "latitude", "lon", "mag"]);
    const claimed = Object.values(draft).filter((column) => column !== "");

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(draft.latitude).toBe("lat");
  });

  it("returns an all-empty draft when nothing looks familiar", () => {
    expect(guessMapping(["alpha", "beta"])).toEqual({
      latitude: "",
      longitude: "",
      mag: "",
      depth: "",
      place: "",
      time: "",
    });
  });
});

describe("validateMapping", () => {
  it("accepts a mapping whose required fields all name a real column", () => {
    expect(validateMapping(ODD_MAPPING, readCsvHeaders(ODD_HEADER))).toEqual([]);
  });

  it("names every required field left unselected", () => {
    const problems = validateMapping({ latitude: "Y", longitude: "", mag: "  " });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("longitude has no column selected");
    expect(problems[1]).toContain("magnitude has no column selected");
  });

  it("catches a mapping that names a column the file does not have", () => {
    const problems = validateMapping(
      { ...ODD_MAPPING, latitude: "Latitude" },
      readCsvHeaders(ODD_HEADER),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('mapped to "Latitude"');
  });

  it("does not object to unmapped optional fields", () => {
    expect(
      validateMapping({ latitude: "Y", longitude: "X", mag: "Magnitude" }),
    ).toEqual([]);
  });
});

describe("toMapping", () => {
  it("drops optional fields left unset rather than mapping them to nothing", () => {
    const mapping = toMapping({
      latitude: " Y ",
      longitude: "X",
      mag: "Magnitude",
      depth: "",
      place: "Site",
      time: "   ",
    });

    expect(mapping).toEqual({
      latitude: "Y",
      longitude: "X",
      mag: "Magnitude",
      place: "Site",
    });
  });
});

describe("parseQuakeCsv with a column mapping", () => {
  it("produces the same features a USGS file would, from oddly named columns", () => {
    const result = parseQuakeCsv(
      oddCsv(
        '"78 km ENE of Mutsu, Japan",41.6191,142.0502,4.6,74.021,2026-09-01T19:21:23.337Z',
      ),
      ODD_MAPPING,
    );

    expect(result.errors).toEqual([]);
    expect(result.skippedRows).toBe(0);
    expect(result.features).toHaveLength(1);

    const [feature] = result.features;
    expect(feature.geometry.type).toBe("Point");
    // Still [longitude, latitude], whatever the file called the columns.
    expect(feature.geometry.coordinates).toEqual([142.0502, 41.6191]);
    expect(feature.properties).toEqual({
      mag: 4.6,
      depth: 74.021,
      place: "78 km ENE of Mutsu, Japan",
      time: "2026-09-01T19:21:23.337Z",
    });
  });

  it("falls back on optional fields the mapping leaves out", () => {
    const result = parseQuakeCsv(oddCsv("Somewhere,10,20,4.9,33,yesterday"), {
      latitude: "Y",
      longitude: "X",
      mag: "Magnitude",
    });

    expect(result.skippedRows).toBe(0);
    expect(result.features[0].properties).toEqual({
      mag: 4.9,
      depth: 0,
      place: "Unknown location",
      time: "",
    });
  });

  it("skips rows whose mapped column holds something non-numeric", () => {
    // `Site` is the text column — pointing magnitude at it cannot work.
    const result = parseQuakeCsv(
      oddCsv(
        "Kermadec Islands,-30.1,-178.2,5.1,15,2026-08-02T00:00:00.000Z",
        "Vanuatu,-20.5,169.8,5.4,120,2026-08-03T00:00:00.000Z",
      ),
      { ...ODD_MAPPING, mag: "Site" },
    );

    expect(result.features).toEqual([]);
    expect(result.skippedRows).toBe(2);
    // The message names the column as the file spells it, not our field name.
    expect(result.errors[0]).toContain("Row 2");
    expect(result.errors[0]).toContain(
      'Site is not a number (got "Kermadec Islands")',
    );
  });

  it("keeps the good rows when only some are unusable under the mapping", () => {
    const result = parseQuakeCsv(
      oddCsv(
        "Good,10,20,4.9,5,2026-08-02T00:00:00.000Z",
        "Blank magnitude,11,21,,5,2026-08-03T00:00:00.000Z",
        "Out of range,95,21,4.9,5,2026-08-04T00:00:00.000Z",
      ),
      ODD_MAPPING,
    );

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.place).toBe("Good");
    expect(result.skippedRows).toBe(2);
    expect(result.errors[0]).toContain("Magnitude is missing");
    expect(result.errors[1]).toContain("Y 95 is outside");
  });

  it("skips every row when the mapping names a column the file lacks", () => {
    const result = parseQuakeCsv(
      oddCsv("Somewhere,10,20,4.9,33,2026-08-02T00:00:00.000Z"),
      { ...ODD_MAPPING, latitude: "lat" },
    );

    expect(result.features).toEqual([]);
    expect(result.skippedRows).toBe(1);
    expect(result.errors[0]).toContain("lat is missing");
  });

  it("reports an incomplete mapping once, rather than skipping every row", () => {
    const result = parseQuakeCsv(
      oddCsv(
        "Somewhere,10,20,4.9,33,2026-08-02T00:00:00.000Z",
        "Elsewhere,11,21,5.0,34,2026-08-03T00:00:00.000Z",
      ),
      { latitude: "Y", longitude: "", mag: "Magnitude" },
    );

    expect(result.features).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Column mapping is incomplete");
    expect(result.errors[0]).toContain("longitude has no column selected");
    // Nothing was read, so nothing was skipped — the fault is in the mapping.
    expect(result.skippedRows).toBe(0);
  });

  it("defaults to the USGS names when no mapping is given", () => {
    const usgs = "time,latitude,longitude,depth,mag,place\n2026-08-02T00:00:00.000Z,10,20,5,4.9,Somewhere";

    expect(parseQuakeCsv(usgs)).toEqual(parseQuakeCsv(usgs, USGS_MAPPING));
    expect(parseQuakeCsv(usgs).features).toHaveLength(1);
  });
});
