import { describe, expect, it } from "vitest";
import { parseQuakeCsv } from "@/lib/csv";

const HEADER = "time,latitude,longitude,depth,mag,place";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseQuakeCsv", () => {
  it("converts well-formed rows into GeoJSON points", () => {
    const result = parseQuakeCsv(
      csv(
        '2026-09-01T19:21:23.337Z,41.6191,142.0502,74.021,4.6,"78 km ENE of Mutsu, Japan"',
        '2026-08-30T04:02:11.000Z,-20.5024,169.7829,122.461,5.2,"118 km SSE of Isangel, Vanuatu"',
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.skippedRows).toBe(0);
    expect(result.features).toHaveLength(2);

    const [first, second] = result.features;

    expect(first.type).toBe("Feature");
    expect(first.geometry.type).toBe("Point");
    // GeoJSON is [longitude, latitude] — the reverse of the CSV column order.
    expect(first.geometry.coordinates).toEqual([142.0502, 41.6191]);
    expect(first.properties).toEqual({
      mag: 4.6,
      depth: 74.021,
      place: "78 km ENE of Mutsu, Japan",
      time: "2026-09-01T19:21:23.337Z",
    });

    expect(second.geometry.coordinates).toEqual([169.7829, -20.5024]);
    expect(second.properties.mag).toBe(5.2);
  });

  it("keeps negative and zero values that are legitimate data", () => {
    const result = parseQuakeCsv(
      csv("2026-08-01T00:00:00.000Z,0,0,0,4.5,Null Island"),
    );

    expect(result.skippedRows).toBe(0);
    expect(result.features[0].geometry.coordinates).toEqual([0, 0]);
    expect(result.features[0].properties.depth).toBe(0);
  });

  it("skips and counts rows with missing, non-numeric or out-of-range coordinates", () => {
    const result = parseQuakeCsv(
      csv(
        "2026-08-02T00:00:00.000Z,10,20,5,4.9,Good row",
        "2026-08-03T00:00:00.000Z,,20,5,4.9,Missing latitude",
        "2026-08-04T00:00:00.000Z,10,,5,4.9,Missing longitude",
        "2026-08-05T00:00:00.000Z,north,20,5,4.9,Non-numeric latitude",
        "2026-08-06T00:00:00.000Z,10,20,5,,Missing magnitude",
        "2026-08-07T00:00:00.000Z,10,20,5,strong,Non-numeric magnitude",
        "2026-08-08T00:00:00.000Z,120,20,5,4.9,Latitude out of range",
        "2026-08-09T00:00:00.000Z,10,200,5,4.9,Longitude out of range",
      ),
    );

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.place).toBe("Good row");
    expect(result.skippedRows).toBe(7);
    expect(result.errors).toHaveLength(7);

    // Row numbers are 1-based and count the header, so the first bad row is 3.
    expect(result.errors[0]).toContain("Row 3");
    expect(result.errors[0]).toContain("latitude is missing");
    expect(result.errors[2]).toContain('latitude is not a number (got "north")');
    expect(result.errors[3]).toContain("mag is missing");
    expect(result.errors[5]).toContain("latitude 120 is outside");
    expect(result.errors[6]).toContain("longitude 200 is outside");
  });

  it("reports every problem in a row in one message", () => {
    const result = parseQuakeCsv(
      csv("2026-08-10T00:00:00.000Z,nope,nope,5,nope,Hopeless"),
    );

    expect(result.skippedRows).toBe(1);
    expect(result.errors[0]).toContain("latitude is not a number");
    expect(result.errors[0]).toContain("longitude is not a number");
    expect(result.errors[0]).toContain("mag is not a number");
  });

  it("falls back rather than skipping when only cosmetic fields are bad", () => {
    const result = parseQuakeCsv(
      csv("2026-08-11T00:00:00.000Z,10,20,deep,4.9,"),
    );

    expect(result.skippedRows).toBe(0);
    expect(result.features[0].properties.depth).toBe(0);
    expect(result.features[0].properties.place).toBe("Unknown location");
  });

  it("returns no features for empty input, and does not throw", () => {
    for (const input of ["", "   ", "\n\n", HEADER, `${HEADER}\n`]) {
      const result = parseQuakeCsv(input);

      expect(result.features).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.skippedRows).toBe(0);
    }
  });
});
