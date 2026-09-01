# Current State

_Last updated: Phase 1 + popup legibility fix_

Phase 1 is built and verified: `npm test` (6 passing), `npm run typecheck`
and `npm run build` are all clean, and the production server renders the map
page with the sample CSV served from `/sample-quakes.csv`.

## Exists

### Data
- `public/sample-quakes.csv` — USGS M4.5+ past-month feed, downloaded
  2026-09-02. 619 data rows, all of which parse without a single skip.
  Magnitudes span 4.5–7.8, depths 0–645 km. Refresh it by re-downloading
  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.csv

### Library code
- `lib/types.ts` — `QuakeProperties` (`mag`, `place`, `time`, `depth`),
  `QuakeFeature` (GeoJSON `Feature<Point, QuakeProperties>`),
  `QuakeCollection` (the matching `FeatureCollection`), and `ParseResult`
  (`{ features, errors, skippedRows }`).
- `lib/csv.ts` — `parseQuakeCsv(csvText): ParseResult`. Pure: no DOM, no
  fetch, no globals. Uses papaparse with `header: true`. Requires numeric,
  in-range `latitude` / `longitude` / `mag`; anything else is skipped with a
  message naming the CSV line number and every field at fault. `depth`,
  `place` and `time` are cosmetic and fall back (`0`, `"Unknown location"`,
  `""`) rather than costing a good row. See DECISIONS D4/D5.
- `lib/mapbox.ts` — `SOURCE_ID` (`"quakes"`), `LAYER_ID`
  (`"quakes-circles"`), `SAMPLE_CSV_PATH`, `MAP_INIT`
  (dark-v11, center `[-160, 20]`, zoom `1.4`, mercator), `EMPTY_COLLECTION`,
  `QUAKE_SOURCE`, and `QUAKE_CIRCLE_LAYER` — radius interpolated over `mag`
  (3px at M4.5 → 24px at M8.5), colour interpolated over `depth`
  (warm `#ffd166` at 0 km → cool `#2a4d9b` at 700 km), opacity 0.8, plus a
  0.6px translucent white stroke.
- `lib/branding.ts` — unchanged; `APP_NAME` is still the single source of
  truth for the product name.

### UI
- `components/MapView.tsx` — the whole Phase 1 client component
  (`"use client"`). Reads `NEXT_PUBLIC_MAPBOX_TOKEN` at module scope; if it
  is unset it renders a centered "Mapbox token missing — see
  docs/MAPBOX_SETUP.md" panel instead of a dead grey box. Otherwise it
  builds the map inside a `useEffect`, holds the instance in a ref, and
  removes it on cleanup. On `load` it fetches the sample CSV, parses it,
  adds the source + circle layer, and `setData`s the features. Clicking a
  point opens a popup (magnitude, place, depth, time formatted as UTC);
  the cursor turns into a pointer over points. A corner overlay shows
  `APP_NAME` plus a live count ("619 quakes · M4.5+ past month"), and
  degrades to a readable message if the fetch fails. Skipped rows are
  logged to the console, never shown as an error.
- `app/page.tsx` — renders `<MapView />` full-viewport (`100dvh`).
  Nothing else.
- `app/layout.tsx` — root layout, and the single entry point for CSS:
  `mapbox-gl/dist/mapbox-gl.css` then `./globals.css`, in that order.
- `app/globals.css` — the dark theme variables from Phase 0, the
  `--popup-*` palette, the overrides that restyle Mapbox's white default
  popup, and the `.quake-popup__*` classes the popup markup uses. Every
  override is written one class more specific than the Mapbox rule it
  replaces, so it wins on specificity as well as on order — see D10.

### Tests
- `vitest.config.mts` — node environment (no jsdom: nothing under test
  touches the DOM), `include: ["tests/**/*.test.ts"]`, and
  `resolve.tsconfigPaths` for the `@/*` alias.
- `tests/csv.test.ts` — 6 tests covering `lib/csv.ts` only: correct
  `[lng, lat]` order and properties; zero/negative values kept; missing,
  non-numeric and out-of-range lat/lng/mag skipped and counted; several
  faults reported in one message; cosmetic fields falling back instead of
  skipping; empty/whitespace/header-only input yielding zero features
  without throwing. The map component is deliberately untested.

## Dependencies
Runtime is unchanged from Phase 0 (`next`, `react`, `react-dom`,
`mapbox-gl`, `papaparse`, `@turf/turf`, `@mapbox/mapbox-gl-draw`).
Added as dev deps in Phase 1: `vitest`, `@types/geojson` (was only present
transitively; `lib/types.ts` imports from it directly).

## Scripts
- `npm run dev` — dev server (Turbopack) on http://localhost:3000
- `npm test` — Vitest, single run
- `npm run test:watch` — Vitest in watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` / `npm run start` — production build and serve

## Verified
- `npm test` → 6 passed. `npm run typecheck` → clean.
  `npm run build` → compiled, 3 static pages, no warnings.
- `next start` serves `/` with a 200 and `/sample-quakes.csv` at its full
  116,757 bytes.
- Both stylesheets now share one chunk, and in that file Mapbox's
  `.mapboxgl-popup-content{background:#fff}` sits at byte 37,253 while our
  `.mapboxgl-popup .mapboxgl-popup-content` sits at 41,223 — ours is later
  *and* more specific. Same for the tip (vendor 36,098 → ours 41,436) and
  the close button (vendor 37,062 → ours 42,104). No `!important` anywhere.
- The Mapbox token from `.env.local` is inlined into the client bundle, so
  the page takes the map branch and not the token-missing branch.
- Not verified here: the WebGL render itself. There is no browser in this
  environment, so "the circles look right" is still a human eyeball check.

## Correction to the earlier Phase 1 write-up
The first Phase 1 entry claimed the page loaded mapbox-gl.css before
globals.css. It did not — it was the other way round, and the check that
"confirmed" it had sorted the two hashed filenames alphabetically instead
of reading them in document order. Mapbox therefore loaded second and its
`background:#fff` beat our equally-specific rule, which is why the popup
rendered as pale text on white. Both the ordering and the specificity are
now fixed, and the evidence above is read in document order.

## Does not exist yet
- No heatmap layer or toggle, no stats bar (Phase 2).
- No CSV upload or column mapping (Phase 3) — though `parseQuakeCsv` is
  already the pure function that flow will reuse.
- No polygon draw / point-in-polygon count (Phase 4); `@turf/turf` and
  `@mapbox/mapbox-gl-draw` are installed but unused.
- No live refresh or pulse animation (Phase 5).
- No legend explaining the size and colour encodings — worth adding
  alongside the Phase 2 stats bar.
