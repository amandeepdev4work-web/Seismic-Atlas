# Current State

_Last updated: Phase 2 follow-up - heatmap retuned (D15)_

Phases 1 and 2 are built and verified: `npm test` (13 passing), `npm run
typecheck` and `npm run build` are all clean, and the production server
renders the map page with the sample CSV served from `/sample-quakes.csv`.

Phase 2 added a heatmap layer on the same source as the Phase 1 circles, a
two-segment Points/Heatmap toggle that flips layer `visibility`, and a stats
bar in the existing corner panel. No new data, and no change to the circle
layer, the CSV parsing or the popup logic.

The Phase 2 follow-up replaced every `heatmap-*` paint value. The first cut
rendered as scattered blue dots with two hard-edged orange discs; the values
are now fitted against a model of Mapbox's heatmap shader rather than chosen
by eye. See D15, which supersedes D13. Nothing outside the heatmap layer's
`paint` block changed - the circle layer in `lib/mapbox.ts` is byte-identical
to Phase 1 (`git diff` reports 0 deletions in that file), and `MapView.tsx`,
`lib/stats.ts` and the popup were not touched.

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
  Phase 2 added `HEATMAP_LAYER_ID` (`"quakes-heatmap"`) and
  `QUAKE_HEATMAP_LAYER` - same `SOURCE_ID`, `layout: { visibility: "none" }`
  so it is added hidden. The follow-up retuned every paint value against a
  model of Mapbox's shader (D15). Weight is compressed to 0.5 at M4.5 -> 1.0
  at M8.5, so magnitude modulates the heat without one big quake saturating
  the ramp alone. `heatmap-intensity` runs 0.3 at z0 -> 0.36 at z1.5 -> 0.75
  at z3 -> 1.3 at z5 -> 1.8 at z7 -> 2.2 at z9; under 1 at world zoom is
  correct, and the cap near 2 stops a lone quake glowing like a cluster.
  `heatmap-radius` is 18px at z0 -> 24 at z2 -> 36 at z4 -> 52 at z6 -> 85 at
  z9, sized to the ~3.8px-per-degree spacing of the arc at the default zoom.
  The colour ramp reads as heat: `rgba(94,30,12,0)` at density 0, a dim ember
  `rgba(122,40,14,0.45)` at 0.06, then `#8c2f0d`, `#cf5a12`, `#ef8b1b`,
  `#ffd166` at 0.8 and `#fff6de` at 1. Opacity is 0.9 -> 0.95 with zoom; the
  ramp's own alpha does the fading, so the basemap is not washed out.
- `lib/stats.ts` - `computeStats(features): QuakeStats`. Pure, single pass,
  no map/DOM/fetch. Returns `{ count, maxMag, maxMagPlace, minDepth,
  maxDepth }`, where every field but `count` is `number | null` - an empty
  set has no maximum, and `0` would be a lie (D14). Non-finite magnitudes and
  depths are ignored rather than propagated; ties on magnitude keep the first
  feature, i.e. feed order.
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
  Phase 2 additions, all inside the same component: both layers are added on
  `load` (heatmap first, so the circles draw above it), `computeStats` runs
  once on the same features handed to the source, and two pieces of plain
  React state - `mode` (`"points" | "heatmap"`) and `stats` - drive the UI.
  A small `useEffect` on `[mode, layersReady]` is the only thing that touches
  the map: two `setLayoutProperty(id, "visibility", ...)` calls, guarded by
  `getLayer` so a click before the data lands cannot throw. `StatsBar`
  extends the existing corner panel with a divider and three rows (Events /
  Max mag plus its place / Depth range). `ModeToggle` is a two-segment
  `role="group"` in the top-right corner, each segment a real `<button>` with
  `aria-pressed`; it renders only once the layers exist.
- `app/page.tsx` — renders `<MapView />` full-viewport (`100dvh`).
  Nothing else.
- `app/layout.tsx` — root layout, and the single entry point for CSS:
  `mapbox-gl/dist/mapbox-gl.css` then `./globals.css`, in that order.
- `app/globals.css` — the dark theme variables from Phase 0, the
  `--popup-*` palette, the overrides that restyle Mapbox's white default
  popup, and the `.quake-popup__*` classes the popup markup uses. Every
  override is written one class more specific than the Mapbox rule it
  replaces, so it wins on specificity as well as on order — see D10.
  Phase 2 appended the `.mode-toggle__option` rules: only the states inline
  styles cannot express - `:hover`, `:focus-visible`, and the pressed segment
  keyed off `[aria-pressed="true"]` so the visual state cannot drift from the
  accessible one. The toggle's panel chrome stays inline in `MapView.tsx`.

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
- `tests/stats.test.ts` - 7 tests covering `lib/stats.ts` only: count and max
  magnitude with its place; depth range across a set; a zero depth kept
  rather than read as missing; a single feature collapsing the range to one
  value; the first feature winning a magnitude tie; an empty set returning
  nulls without throwing; non-finite values ignored instead of poisoning
  every aggregate. The toggle and the map are deliberately untested (D9).

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
- `npm test` -> 13 passed (6 csv + 7 stats). `npm run typecheck` -> clean.
  `npm run build` -> compiled, 3 static pages, no warnings.
- `next start` serves `/` with a 200 and `/sample-quakes.csv` at its full
  116,757 bytes.
- Phase 2's code reaches the client bundle, not just the source tree: the
  built CSS chunk carries all four `.mode-toggle__option` rules (minified to
  `[aria-pressed=true]`, quotes stripped), and the client JS chunk carries
  `quakes-heatmap` and the `heatmap-density` ramp.
- `computeStats` run over the real `public/sample-quakes.csv` through
  `parseQuakeCsv` returns `count: 619`, `maxMag: 7.8` at "64 km NNW of Ende,
  Indonesia", depth `0` to `645.026` km, `skippedRows: 0`. So the stats bar
  should read **619 / M 7.8 / 0-645 km**. That is the number to check the
  rendered panel against.
- Both stylesheets now share one chunk, and in that file Mapbox's
  `.mapboxgl-popup-content{background:#fff}` sits at byte 37,253 while our
  `.mapboxgl-popup .mapboxgl-popup-content` sits at 41,223 — ours is later
  *and* more specific. Same for the tip (vendor 36,098 → ours 41,436) and
  the close button (vendor 37,062 → ours 42,104). No `!important` anywhere.
- The Mapbox token from `.env.local` is inlined into the client bundle, so
  the page takes the map branch and not the token-missing branch.
- Not verified here: anything needing a browser. There is no WebGL in this
  environment, so everything under "Needs a human eyeball" below is still
  unobserved.

## Correction to the earlier Phase 1 write-up
The first Phase 1 entry claimed the page loaded mapbox-gl.css before
globals.css. It did not — it was the other way round, and the check that
"confirmed" it had sorted the two hashed filenames alphabetically instead
of reading them in document order. Mapbox therefore loaded second and its
`background:#fff` beat our equally-specific rule, which is why the popup
rendered as pale text on white. Both the ordering and the specificity are
now fixed, and the evidence above is read in document order.

## Needs a human eyeball
Nothing below was machine-verified. The code typechecks, builds, and its
output is present in the shipped bundle, but it has never been rendered.

- **The retuned heatmap.** The values are now modelled rather than guessed
  (D15), but modelled is not seen. At zoom 1.4 the model predicts: sparse
  ocean quakes as a dim ember barely above the basemap, Alaska deep orange,
  Chile orange, Tonga and Japan bright amber, and Indonesia and the
  Philippines as near-white cores - the Sunda arc core about 18px across with
  the glow fading out by 46px. If it still reads cold, raise
  `heatmap-intensity`'s z0/z1.5 stops (0.3 / 0.36) together; if the arcs melt
  into one mass, lower `heatmap-radius`'s z0/z2 stops (18 / 24). Change one
  at a time - they pull against each other.
- Whether the model's density figures match what the GPU actually draws. The
  arithmetic follows `heatmap.fragment.glsl`, but it is a reimplementation,
  and Mapbox renders the heatmap through an offscreen texture whose precision
  is not modelled here.
- That the toggle visibly swaps the two layers, with no frame in which both
  or neither is drawn.
- That popups and the pointer cursor go quiet in Heatmap mode and return in
  Points mode. They should - Mapbox does not hit-test hidden layers - but
  that is reasoning from the docs, not a click.
- That the stats bar's longest `place` string wraps inside the panel instead
  of stretching it. "64 km NNW of Ende, Indonesia" is the one in the current
  snapshot; the USGS feed produces longer ones on a different day.
- Toggle placement at narrow widths. It is pinned top-right and the info
  panel top-left, and the two have not been seen on a phone-width viewport.
- Behaviour above zoom 6. The fitting targeted the default world view; the
  higher-zoom stops keep the numbers sane but were checked at only four
  zooms (1.4, 2, 4, 6), and the z6 probe window is too small to sample a
  cluster reliably.

## Investigated and NOT a bug: the circle layer in Heatmap mode
Two hard-edged orange discs near Indonesia and the Philippines were reported
as the circle layer failing to hide. It was not. Three things rule it out:

- `MapView.tsx` adds exactly two layers and one source, and creates no
  markers. The toggle effect sets `visibility` on *both* layers on every run,
  unconditionally, so a leak would show all 619 circles - not two.
- The two discs sit exactly where the sample's densest clusters are, which is
  also where the heatmap's own density peaked hardest.
- Modelling the shader reproduces the artefact from the heatmap alone:
  density 5.5 over Indonesia and 1.9 over the Philippines against a ramp that
  clips at 1, with the falloff from 0.9 to 0.15 spanning 2px. A saturated
  core with a 2px edge is a hard-edged disc.

The cause was the 7.8px radius at the default zoom, and the retune fixes it
by widening that falloff to 28px. The toggle logic was correct and was left
alone (D12 still holds).

## Does not exist yet
- No CSV upload or column mapping (Phase 3) — though `parseQuakeCsv` is
  already the pure function that flow will reuse.
- No polygon draw / point-in-polygon count (Phase 4); `@turf/turf` and
  `@mapbox/mapbox-gl-draw` are installed but unused.
- No live refresh or pulse animation (Phase 5).
- No legend explaining the size and colour encodings. It was on the Phase 2
  wish list but not in the Phase 2 brief, so it was not built; it is carried
  into Phase 3. The heatmap makes it more wanted, not less - there are now
  two meanings for colour behind one toggle (D13).
