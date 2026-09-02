# Current State

_Last updated: Project complete — all five phases shipped, deployed, and verified in-browser._

**Every phase on the roadmap is built, deployed live, and confirmed in a real
browser.** `npm test` (130 passing), `npm run typecheck` and `npm run build`
are all clean. Beyond the machine checks, every interactive behaviour has been
manually verified against the live deployment: point rendering and popups, the
heatmap and its toggle, CSV upload with column mapping and bad-file guards, the
polygon filter with live antimeridian-correct counting, and live refresh with
the arrival pulse — including the amber pulse and the white selection ring
reading as distinct on the same quake in a dense cluster. The live USGS feed
serves with open CORS, so the deployed build behaves as the local one does. The
full step-by-step verification record lives in `docs/TESTING.md`.

Phase 5 makes the map live. The USGS M4.5+ GeoJSON feed is re-fetched every 60
seconds — and on demand from a `Refresh` button in the data panel — and any
quake that was not in the previous fetch gets a soft amber ring that expands
and fades over four seconds. Everything else stays exactly as calm as it was.

Three things about it are worth knowing before touching it, and each has a
decision entry behind it:

1. **Refresh is paused by the data source, structurally.** The timer lives in
   an effect keyed on `[layersReady, live]`, so uploading a CSV does not make
   the timer decline to fire — it makes React tear the timer down. There is
   nothing left to clobber the user's data with. A fetch already in flight is
   caught by a re-check after the `await`, reading a ref that is written
   synchronously rather than mirrored in an effect (D30).
2. **A quake's identity is `time|lng|lat|mag`, not the USGS event id.** The id
   exists only on the GeoJSON path, so it could never compare a live fetch
   against the CSV sample the page opens with. This was checked against real
   data, not argued: 606 of the live feed's 631 events matched sample-CSV
   features exactly by key (D32).
3. **The pulse baseline is the last *live* fetch, not what is on the map.**
   Diffing against the displayed data sounds more natural and would have rung
   25 rings simultaneously on the first auto-refresh, because the bundled
   sample is a snapshot of a rolling feed. Anchoring on the previous live
   fetch makes the first one pulse nothing and every one after it a genuine
   sixty-second delta (D33).

The pure parts — the feed adapter and the diff — live in a new module,
`lib/live.ts`, which is where the 41 new tests point. The timer, the animation
loop and the map are not tested and will not be (D9).

Phases 1, 2 and 4 are again provably untouched: `git diff --numstat` reports
**0 deletions** in `lib/mapbox.ts` (89 additions, all appended below the Draw
theme) and **0 deletions** in `app/globals.css` (36 additions). No layer's
paint values moved; the pulse is a fourth source and a fifth layer above them.
`components/MapView.tsx` is `467 5`, and every one of those five deletions is
either a reworded doc comment or a `setDataSource` renamed to
`applyDataSource`. `components/DataPanel.tsx` is `90 3`, on the same terms.
The parser, `lib/geo.ts`, the popup, the legend, the mapper, the upload path
and the polygon count logic were not touched at all.

Phase 4 puts a drawing tool on the map. Draw a polygon and the panel says how
many of the loaded quakes are inside it, recomputing as the shape is created,
edited or removed, and the quakes inside get a neutral white ring. It works on
uploaded data for the same structural reason Heatmap mode does: the count is
taken against `featuresRef`, which is set by `showFeatures` — the one path
through which anything reaches the source (D19) — so upload, reset and any
future data path are covered without a second wire.

**The Phase 4 follow-up** made the count update per frame rather than on
mouse-up. Nothing about the counting changed — `lib/geo.ts` and its 25 tests
are byte-identical — only *when* it is called: `draw.render` is wired
alongside the three edge events, guarded on Draw's mode so a shape still being
drawn shows no number. The guard has to be the mode and cannot be geometric,
which is the one genuinely surprising thing in this phase and is written up in
D28. Two writes (the ring layer's `setData` and the panel's `setState`) are
skipped on frames where the inside set is unchanged, which is what keeps a
drag cheap without throttling anything.

The arithmetic lives in a new pure module, `lib/geo.ts`, which is where the 25
new tests point. The drawing itself is not tested and will not be (D9/D28).
Two things about the geometry turned out to matter more than expected and are
worth reading before touching this: the date line is in the middle of the
default frame, so a shape drawn around Tonga arrives with longitudes past 180
while the quakes it encloses are stored below -180 (D27); and turf throws on
most malformed rings, which is the normal state of a shape mid-drawing (D28).

Phases 1 and 2 are again provably untouched: `git diff` reports **0 deletions**
in `lib/mapbox.ts` (164 additions, all appended below the existing layers) and
**0 deletions** in `app/globals.css` (27 additions). The circle and heatmap
paint values did not move, are not re-painted at runtime, and are not filtered
— the selection highlight is its own source and its own layer drawn above them
(D25). The parser, the popup content, the legend, the mapper and the upload
path were not touched at all; the only change to the popup is a guard on *when*
it opens (D26).

Phase 3 adds a second way for data to reach the map. A user can upload their
own CSV; it goes through the *same* `parseQuakeCsv`, the same GeoJSON source
and the same two layers as the sample, so Points and Heatmap both work on
uploaded data with no extra wiring (confirmed: the toggle has no code path to
`fetch`, `parseQuakeCsv` or `setData`, and neither does the upload path have
one to the layers — it calls `setData` on the one source both layers read).
Files that do not use the USGS column names get a small mapping UI. Parse
results are surfaced as a one-line notice, a file that yields zero valid points
is refused with the previous data left on the map, and a legend now states what
size and colour mean in each mode.

The Phase 1 circle layer and the Phase 2 heatmap paint values were not touched:
`git diff` reports **0 deletions** in `lib/mapbox.ts` (47 additions, all of them
new exports appended below the layers) and **0 deletions** in `app/globals.css`.
The core parser's row-validation rules are unchanged too — all 6 original
`tests/csv.test.ts` tests pass against the refactored parser without a single
edit.

**The Phase 3 follow-up** fixed three things a browser found, and touched
nothing outside the upload path, the mapper and the overlay CSS:

1. A `.zip` was accepted, read, and its decoded bytes echoed into the error
   notice through a parser message that quoted the offending cell. There is now
   a type guard before the read and a binary check after it, and every
   file-derived string in the UI goes through a clamp (D22).
2. The native `<select>` option list rendered light and unreadable on Windows
   Chrome, which ignores `color-scheme: dark` for the popup. The field
   dropdowns are now a hand-rolled listbox (D23).
3. The two overlay stacks were absolutely positioned and ran into each other
   when the tall mapping panel opened. They are now two columns of one grid,
   which cannot overlap, plus a narrow-width rule that stacks them (D24).

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
  (`{ features, errors, skippedRows }`). Phase 3 restated `skippedRows` as
  "rows dropped", which is `errors.length` in every case except an incomplete
  column mapping — that reports one error having skipped nothing (D16).
- `lib/csv.ts` — `parseQuakeCsv(csvText, mapping = USGS_MAPPING): ParseResult`.
  Still pure: no DOM, no fetch, no globals. The only change in Phase 3 is that
  every column name it reads now comes from `mapping` instead of being a
  literal, so one parser serves both data paths (D16). Validation is exactly as
  before: numeric, in-range latitude/longitude/mag or the row is skipped;
  `depth`, `place` and `time` fall back to `0`, `"Unknown location"` and `""`.
  Skip messages now name the column as the *file* spells it (`Y 95 is outside
  the valid range…`), which for a USGS file reads identically to Phase 1.
  An incomplete mapping short-circuits: zero features, one message, and
  `skippedRows: 0`.
- `lib/columns.ts` — **new.** The mapping vocabulary, and nothing else; it
  knows about CSV headers and dropdowns, never about GeoJSON, so the dependency
  runs one way (columns → csv) and cannot cycle. Exports `REQUIRED_FIELDS`
  (`latitude`, `longitude`, `mag`), `OPTIONAL_FIELDS` (`depth`, `place`,
  `time`), `ALL_FIELDS`, `FIELD_LABELS`, `USGS_COLUMNS` / `USGS_MAPPING`, the
  `ColumnMapping` and `MappingDraft` types, and four pure functions:
  - `readCsvHeaders(csvText)` — the header row, trimmed, in file order.
    Unnamed columns are dropped (nothing can be keyed by them); repeated names
    keep papaparse's suffix (`mag`, `mag_1`) because that suffix *is* the row
    key, so both really are selectable.
  - `detectMapping(headers)` — USGS names, case-insensitive and otherwise
    exact, or `null`. This is the "proceed without asking" check (D17).
  - `guessMapping(headers)` — a looser alias match (`lat`, `y`, `lng`, `mw`,
    `depth_km`, …) that only ever pre-fills the form. Required fields resolve
    first, no column is claimed twice, and a weak match is left blank.
  - `validateMapping(mapping, headers?)` — problems as sentence fragments;
    empty means usable. Catches both an unselected required field and one
    pointed at a column the file does not have.
  - plus `toMapping(draft)`, which drops optional fields left unset.
- `lib/upload.ts` — **new in the follow-up.** Everything decided about a file
  before it reaches the parser, plus the clamping every file-derived string
  passes through on its way to the UI. Also pure, also tested:
  - `checkUploadFile({ name, size, type })` — `null` for "worth reading", or
    the complete message to show. Rejects empty files, anything over
    `MAX_UPLOAD_BYTES` (25 MB), and any extension outside `.csv` / `.tsv` /
    `.txt`. The extension decides, not the MIME type: Chrome on Windows reports
    `.csv` as `application/vnd.ms-excel`, so a MIME-only filter would reject
    the very files this app is for. MIME is consulted only when there is no
    extension at all.
  - `looksBinary(text)` — the second line of defence, since an extension is
    only a claim. `File.text()` never throws; it substitutes U+FFFD, so a zip
    arrives as a long string rather than as an error. A NUL, or more than 10%
    replacement/control characters in the first 4 KB, means binary. The
    threshold was measured from both ends: a Latin-1 CSV of Spanish place names
    sits at 2-5% and must still load (D4), a zip or PNG runs past 30%.
  - `safeMessage(raw, maxLength = 120)` and `safeFileName(name)` — controls and
    replacement characters out, whitespace collapsed, length capped with an
    ellipsis. `safeFileName` falls back to "that file" when a name reduces to
    nothing.
  - `summarizeErrors(errors)` — the first parser message, clamped, plus a count
    of the rest, with a plain sentence substituted if the first message was
    entirely binary.
  - `FILE_INPUT_ACCEPT` — what the picker advertises. A convenience, never the
    check: `accept` is trivially bypassed by choosing "All files".
- `lib/geo.ts` — **new in Phase 4**, and the only thing Phase 4 unit-tests.
  `countPointsInPolygon(features, polygon): { inside, insideFeatures }`. Pure:
  no map, no DOM, no globals, the same rule `parseQuakeCsv` and `computeStats`
  follow. Takes a bare `Polygon`, a `MultiPolygon`, a `Feature` wrapping
  either, or `null`/`undefined`. `insideFeatures` holds the very same feature
  objects in input order, because the ring layer needs the features and not
  copies. Three contracts, each with tests (D28):
  - **On the boundary is inside.** Edges and vertices both. That is turf's
    default and it is kept deliberately, not inherited by accident.
  - **Nothing throws.** Turf throws on an empty ring, a two-point ring, or a
    ring whose last position does not repeat its first — all of which are
    ordinary states of a shape being drawn. Those are screened out and
    answered with zero; a merely-unclosed ring is closed rather than refused;
    a feature with a non-numeric coordinate is skipped, not fatal.
  - **Every copy of the world.** A shape reaching past ±180 tests each point
    at ±360 too, stopping at the first copy that lands inside so nothing is
    double-counted (D27). A shape inside one world pays nothing for this.

  Internally it computes the outer bounding box once per call and uses it both
  to decide which shifts are needed and as a cheap reject before each ray
  cast. Import is `booleanPointInPolygon` from `@turf/turf`; the meta-package
  tree-shakes (verified below).
- `lib/mapbox.ts` — unchanged through `MAGNITUDE_LEGEND_STOPS`; see the Phase 2
  and Phase 3 notes. Phase 3 **appended** `MapMode` (`"points" | "heatmap"`,
  moved out of `MapView` so the legend can take it as a prop) and three legend
  constants that mirror the layers' paint values: `DEPTH_LEGEND_STOPS`,
  `DENSITY_LEGEND_STOPS`, `MAGNITUDE_LEGEND_STOPS`. They restate rather than
  derive, deliberately (D20), and sit directly beneath the layers they
  describe with a keep-in-sync note.

  Phase 4 **appended** again, 164 lines and no deletions:
  - `SELECTED_SOURCE_ID` / `SELECTED_LAYER_ID`, `QUAKE_SELECTED_SOURCE` (empty
    to start, like the quake source) and `QUAKE_SELECTED_LAYER` — a circle
    layer with no fill (`circle-opacity: 0`) and a 1.4px `#f2f6fa` stroke, so
    a selected quake gets a ring and keeps its depth colour underneath. Its
    radii are the circle layer's plus a constant 2.5px, **restated, with the
    same keep-in-sync obligation D20 put on the legend swatches.** It starts
    `visibility: none` and follows Points mode.
  - `DRAW_STYLES` — Mapbox Draw's theme, recoloured. Draw's filters are copied
    unchanged (they address Draw's own feature/vertex/midpoint bookkeeping);
    only the paint differs, and it is all `#f2f6fa` chrome rather than either
    data palette (D25). Polygon fill at 6% (10% while active), a 1.6px outline
    dashed while the shape is live, vertex handles drawn as a white disc with
    a `#0b0f14` centre so a handle over a quake does not swallow it, and
    dimmer midpoints. The default theme's Point-feature layers are left out —
    polygon is the only mode this app enables. Typed as a local `DrawStyle`
    shape rather than a `LayerSpecification`, because Draw injects `source`
    itself and clones each entry into a hot and a cold copy.

  Phase 5 **appended** again, 89 lines and no deletions:
  - `PULSE_SOURCE_ID` / `PULSE_LAYER_ID`, `PULSE_DURATION_MS` (4000),
    `QUAKE_PULSE_SOURCE` (empty, like the other two) and `QUAKE_PULSE_LAYER` —
    a circle layer with no fill and an amber `#ffd166` stroke, starting fully
    transparent so a layer with no animation behind it draws nothing whatever
    is in its source. It starts `visibility: none` and follows Points mode.
    Its `circle-radius` is a **flat number, not a magnitude interpolation** —
    which is what keeps this layer out of the keep-in-sync obligation D20 and
    D25 carry, and D34 argues it is also the right thing to draw.
  - `pulseFrame(t)` — the three animated values at `t ∈ [0, 1]`, clamped at
    both ends. Ease-out cubic on the radius, a slower power fade on the
    opacity, and a stroke that thins as it grows. Sampled: `t=0` is 5.0px at
    0.90 alpha, `t=0.25` (1s) is 19.5px at 0.57, `t=0.5` is 26.9px at 0.30,
    `t=0.75` is 29.6px at 0.10, and it ends at 30.0px and 0. So most of the
    travel is in the first second and the last second is barely visible —
    a ripple settling rather than a blink.
- `lib/stats.ts` — unchanged. `computeStats(features): QuakeStats`, pure,
  single pass, every aggregate nullable (D14). Phase 3 reuses it verbatim: it
  is recomputed once per successful load, sample or upload, on the same
  features handed to the source.
- `lib/live.ts` — **new in Phase 5**, and the only thing Phase 5 unit-tests.
  Pure: no DOM, no fetch, no globals, no map. Four exports plus two constants:
  - `LIVE_FEED_URL` — the M4.5+ month **GeoJSON** summary. The GeoJSON rather
    than the CSV because it is cached ~1 minute against the CSV's ~5, and
    because it already arrives as a FeatureCollection, which is the internal
    format anyway (D2).
  - `REFRESH_INTERVAL_MS` — 60 000.
  - `parseQuakeGeojson(input: unknown): ParseResult` — the adapter. Returns the
    same `ParseResult` the CSV parser does, holding features that are
    `toEqual`-identical to what `parseQuakeCsv` produces for the same event.
    It takes `unknown` because the input is a parsed network response and
    nothing has checked it: a document that is not a FeatureCollection is one
    error having skipped nothing (D16's shape), and any individual entry that
    is malformed — no geometry, a null geometry, a non-Point, a one-element
    coordinate array, a `NaN` coordinate, a null feature — is skipped rather
    than thrown on. The **rules** are D4/D5's and are deliberately restated
    rather than shared with `lib/csv.ts`: that parser reads string cells out of
    papaparse rows and every helper in it is built around that, so reusing it
    would mean turning numbers back into strings to have them parsed again.
    What must not drift is the outcome, and 15 tests pin the outcome. Two
    details of the feed's own shape: **depth is the third coordinate**, not a
    property; and `time` is epoch milliseconds, converted to the exact ISO 8601
    string the CSV feed writes — which is the load-bearing line, because it is
    what makes a live feature and a sample feature for the same earthquake
    identical.
  - `quakeKey(feature)` — `time|longitude|latitude|mag`. Not the USGS event id,
    and D32 is the whole argument for that.
  - `quakeKeys(features)` — the key set of one fetch.
  - `findNewQuakes(previous, features)` — the features whose key is not in
    `previous`, as **the very same objects in input order** (the contract
    `countPointsInPolygon` keeps, for the same reason: the caller feeds them
    straight to a source). `null`, `undefined` and an empty set all mean
    "nothing is new" — the first-load rule, and D33 says why that reading was
    chosen over the other one.
- `lib/branding.ts` — unchanged; `APP_NAME` is still the single source of truth
  for the product name.

#### The Phase 2 heatmap paint values, for reference
Unchanged in Phase 3 and reproduced here because the verification record in
`docs/TESTING.md` refers to them. Weight is compressed to 0.5 at M4.5 → 1.0 at M8.5.
`heatmap-intensity` runs 0.3 at z0 → 0.36 at z1.5 → 0.75 at z3 → 1.3 at z5 →
1.8 at z7 → 2.2 at z9. `heatmap-radius` is 18px at z0 → 24 at z2 → 36 at z4 →
52 at z6 → 85 at z9. The colour ramp is `rgba(94,30,12,0)` at density 0, a dim
ember `rgba(122,40,14,0.45)` at 0.06, then `#8c2f0d`, `#cf5a12`, `#ef8b1b`,
`#ffd166` at 0.8 and `#fff6de` at 1. Opacity 0.9 → 0.95 with zoom. All of it
fitted against a model of Mapbox's shader — see D15.

### UI
- `components/MapView.tsx` — still the one client component that owns the map
  (`"use client"`). Reads `NEXT_PUBLIC_MAPBOX_TOKEN` at module scope and
  renders a "Mapbox token missing" panel if it is unset. The map instance lives
  in a ref, never in state (D3). What changed in Phase 3:
  - **The source and both layers are now added on `load`, before any data**
    (D19). `layersReady` flips there rather than when the sample fetch
    resolves, so an upload works even if `/sample-quakes.csv` 404s. The popup
    and cursor handlers are wired at the same moment, once.
  - `showFeatures(features, { fit })` is the single path that changes what is
    on the map: `setData` on the existing source, recompute stats, optionally
    fit the bounds. Sample and upload both go through it.
  - `applyParsed(result, fileName)` turns a `ParseResult` into either new data
    or a message. Zero features is a refusal — no `setData`, no stats change,
    previous data left alone (D18). Skipped rows load fine and produce
    "Loaded 412 points · 8 rows skipped"; the full messages go to the console.
  - `handleFile` clamps the file name once, runs `checkUploadFile` **before**
    reading anything, reads, runs `looksBinary` on the text, then calls
    `readCsvHeaders` and `detectMapping` and either parses straight away or
    opens the mapping panel pre-filled by `guessMapping`. A file with no
    readable header row is refused with a message. Every rejection uses the
    clamped name, never `file.name`, and the caught-error branch logs the real
    error to the console while showing the same one-line message (D22).
  - `handleReset` restores the sample from a ref cached at first load — no
    fetch, no reparse — and eases the view back to `MAP_INIT` (D21). It
    refetches only if the sample never loaded in the first place.
  - `fitToFeatures` frames uploaded data via `mapboxgl.LngLatBounds`, padding
    64, `maxZoom: 6`. No turf (D21).
  - The overlays are **one grid across the map** with a column pinned to each
    edge (`.map-overlay` in globals.css): left holds the title/status/stats
    panel and the legend, right holds the mode toggle, the data panel and —
    when open — the mapping panel. Grid columns cannot overlap, which is why
    this is no longer two absolutely positioned stacks (D24). The grid is
    `pointer-events: none` and each panel opts back in, so the map stays
    draggable in the gaps. `MapView` adds `map-overlay--mapping` while the
    mapper is open, which is what the narrow-width rule keys off.
  - The mode toggle effect is untouched: two `setLayoutProperty` calls guarded
    by `getLayer`, keyed on `[mode, layersReady]` (D12).

  What Phase 4 added, all of it around the existing structure rather than
  through it:
  - **Four more refs.** `drawRef` holds the `MapboxDraw` instance, beside the
    map and for the same reason (D3). `featuresRef` holds whatever is on the
    map right now — it is the array the count is taken against, and it is set
    in exactly the two places the source is fed, `loadSample` and
    `showFeatures`. `drawingRef` mirrors the `drawing` state for the popup
    handler, which is wired once on `load` and so cannot see later renders.
    `ringedRef` (follow-up) holds the features the ring layer was last fed, so
    a frame that changed nothing does not pay to re-upload identical geometry.
  - **`wireDrawing(map)`**, called from the `load` handler after the layers, so
    Draw's outline and handles sit above every data layer. It constructs Draw
    with `displayControlsDefault: false` (D26), `boxSelect: false` (so
    shift-drag stays the map's box zoom) and `DRAW_STYLES`, adds it as a
    control, and binds five listeners. `draw.create` / `draw.update` /
    `draw.delete` all call `refreshSelection` **unguarded**; `draw.render`
    calls `refreshSelectionLive`, which is the same thing behind a mode guard;
    `draw.modechange` asks Draw for its mode rather than reading the event, so
    there is one answer to "are we drawing?". **Every listener reads only refs
    and state setters**, which is what makes binding them once on `load` safe.
  - **`refreshSelection()`** — reads the polygon back out of Draw, counts,
    feeds the ring source, and sets the panel state. With no polygon it clears
    both. This is the only thing that changes the selection. Since the
    follow-up it also skips the two expensive writes when the inside set is
    identical to last time, compared by identity against `ringedRef` — sound
    because `countPointsInPolygon` returns the very features it was given.
  - **`refreshSelectionLive()`** — the per-frame path, added in the follow-up.
    One guard: skip while `getMode()` is `draw_polygon`. It cannot be a
    geometric guard, because Draw closes every ring on the way out of
    `getCoordinates`, so a half-drawn shape is indistinguishable from a
    finished one by inspection; see D28. The three edge events stay unguarded
    because `draw.create` fires while the mode name still says `draw_polygon`.
  - **`handleDraw` / `handleClearSelection`.** Drawing calls `deleteAll` first,
    so one shape exists at a time and the code reading it back can take the
    first polygon it finds. Both call `refreshSelection` themselves, because
    Draw fires no events for its own API calls (`suppressAPIEvents` is on by
    default) — `deleteAll` is silent, and so is a programmatic `changeMode`.
  - **`showFeatures` calls `refreshSelection`** after `setData`, which is what
    makes an upload or a reset recount against the new data rather than
    clearing the shape (D29).
  - **The mode effect gained a third branch**, guarded by `getLayer` like the
    other two: the ring follows Points mode. The count keeps working in
    Heatmap mode; the ring does not, and D25 says why.
  - **The popup handler gained one guard** — `if (drawing.current) return;` —
    so a click that lands on a quake while a shape is being drawn places a
    corner without also opening a popup over it. Content, escaping and styling
    are untouched.
  - **The effect cleanup drops `drawRef`**, because `map.remove()` calls every
    control's `onRemove` and leaves Draw's internals torn down; a late refresh
    would otherwise ask a gutted Draw for its features.

  What Phase 5 added, again around the existing structure rather than through
  it. Five deletions in the whole file, all of them either a reworded doc
  comment or `setDataSource` renamed to `applyDataSource`:
  - **`DataSource` gained a `live` kind**, and `isLive(source)` —
    `kind !== "upload"` — is the single named place that answers "may a refresh
    touch the map?". There is deliberately no second piece of state saying the
    same thing (D30). `describe` and `sourceLabel` gained the matching case:
    "631 quakes · M4.5+ past month · live" and "Live · USGS M4.5+, past month".
  - **`applyDataSource(next)`** is now the one path that changes `dataSource`,
    and it writes `liveRef` **synchronously** on the way through. That is the
    point of it: the reader that matters is `refreshLive` picking back up after
    an `await`, and an effect mirroring the state would run one render too
    late. Same reason `drawingRef` exists for the popup handler.
  - **Six more refs.** `liveKeysRef` (the keys of the last successful *live*
    fetch — not of what is on the map, and D33 is why), `pulseRef` (the running
    cohort's start time and the reader's reduced-motion preference, or null),
    `frameRef` (the one rAF handle this component ever holds; null means idle),
    `liveRef` and `modeRef` (mirrors, for callbacks that outlive a render), and
    `refreshingRef` (one fetch at a time).
  - **`refreshLive()`** — the timer and the button call the identical function,
    because they should do the identical thing. Fetches with `cache: "no-store"`
    (a 304 out of the browser cache would report success and change nothing),
    adapts, re-checks `mapRef` and `liveRef` after the `await`, takes the delta
    *before* replacing `liveKeysRef`, and then goes through **`showFeatures`** —
    the same single path an upload takes (D19), so the stats recompute and the
    polygon recount for free. Every failure ends the same way: the data on the
    map stays, one warm notice says the update did not land, and the timer is
    untouched. A later success clears that notice, because it ends "still
    showing the last data that loaded" and newer data has just landed.
  - **The auto-refresh effect**, `[layersReady, live]`. Those two dependencies
    *are* the pause rule: an upload flips `live` false and React removes the
    interval; a reset flips it back and a new one starts. There is no immediate
    fetch on mount — D31 says why the sample stays as the first frame.
  - **`startPulse` / `stepPulse` / `paintPulse` / `stopPulse`** — one rAF loop
    that exists only while something is pulsing. `startPulse` writes the cohort
    to the pulse source **once** and paints frame zero synchronously; the four
    seconds after that move three scalars and never touch data (D34). It
    returns early in Heatmap mode, so no frames are spent on an invisible
    layer. `stopPulse` does not schedule another frame, which is the whole of
    "pause when idle", and it is also called from `showFeatures` — those rings
    were computed against a feature set that is no longer on the map.
  - **The mode effect gained a fourth branch and a mirror.** It writes
    `modeRef`, sets the pulse layer's visibility (Points only, D25's argument
    transferred), and ends any running pulse on the way into Heatmap mode. It
    is the *only* owner of that layer's visibility; the animation is the only
    owner of its content, so neither has to know about the other.
  - **The effect cleanup cancels the frame** unconditionally and before
    `map.remove()` — a queued frame would otherwise fire against a torn-down
    map, the same hazard `drawRef` is dropped for.
  - **Two dev-only console handles**, `__seismicDropKeys(n)` and
    `__seismicMap`, in a final effect guarded by
    `process.env.NODE_ENV === "production"`. Next inlines that at build time,
    so the branch is dead code the minifier removes — **there is nothing to
    ship, rather than something that ships and declines to run**, and the
    built chunks were grepped to confirm it (see Verified). They exist because
    the pulse is the one behaviour here that cannot be triggered on demand:
    it fires only when the feed gains an event, and M4.5+ worldwide averages
    one every couple of hours. `__seismicDropKeys` deletes the N
    highest-magnitude quakes' keys from `liveKeysRef` — the biggest because a
    ring around a 15px M7 disc is findable at world zoom and one around a 3px
    M4.6 is not — so the next fetch reads them as arrivals. Nothing is faked;
    the features that pulse are real ones from a real response, and the
    refresh rebuilds the baseline, so the effect is one-shot. It refuses with
    an explanation when there is no baseline yet or an upload is showing, and
    warns (but proceeds) in Heatmap mode.
- `components/SelectionPanel.tsx` — **new in Phase 4.** "Draw area", "Clear"
  (only while a shape exists), and the count. Buttons reuse
  `.data-panel__button`, the pill language the data panel and the mapper
  already share, so this reads as one more control rather than a new kind of
  thing. "Draw area" holds a pressed state keyed off `aria-pressed` — a mode,
  not a click — and it toggles: pressing it again leaves draw mode.
  The readout is one `aria-live="polite"` line with three states: the count
  (`87` in the foreground, `of 619 inside selection` muted), the drawing hint
  ("Click to place corners, double-click to finish. Esc cancels."), or the
  neutral prompt ("Draw a polygon to filter."). A second, dimmer line appears
  only alongside the count: "Click the shape to move its corners." Draw hides
  vertex handles until a shape is selected, and the count updating as a corner
  is dragged is the whole trick, so the line that would otherwise be blank
  says where to find the handles. The control and the number are in the same
  panel deliberately — D26 argues that against putting the count in the stats
  bar.
- `components/DataPanel.tsx` — **new in Phase 3.** Upload button, "Reset to
  sample" (shown only when uploaded data is displayed), the current source
  label, and the dismissible notice. The picker is a hidden
  `<input type="file">` driven by a real button — no `<form>`, since the file
  never leaves the browser. The input's value is cleared on every pick so
  re-selecting the same file fires again.

  **Phase 5 put the refresh control here** rather than in a fifth panel, which
  is the guardrail Phase 4 carried forward: this panel already names where the
  data came from, and "and it updated 40 seconds ago" is the same sentence
  continued (D31). Three additions and nothing moved:
  - A `Refresh` pill in the row that already holds `Upload CSV`, reading
    "Refreshing…" and disabled while a fetch is out. It is **hidden**, not
    disabled, while an upload is displayed — a disabled control asks the reader
    to work out why, and the space is spent saying it instead.
  - One quiet status line under the source label, `aria-live="polite"` because
    it changes on a timer and must never interrupt a screen reader mid-
    sentence. Four states: "Auto-refresh paused while your file is shown.";
    a breathing dot plus "Fetching the latest events…"; "Live · refreshes every
    60s" before the first fetch; and "Updated 42s ago" after it.
  - `ElapsedSince`, a component whose entire job is that clock, with its own
    one-second interval. A `now` ticking in `MapView` would re-render the
    legend, the toggle, the selection panel and the mapper once a second for
    the sake of two characters. The label is coarse on purpose — "just now",
    seconds, then minutes.
- `components/ColumnMapper.tsx` — **new.** One `Select` per field, required
  ones marked (an asterisk plus a visually-hidden "(required)" for screen
  readers), pre-filled from `guessMapping`. Live problems from
  `validateMapping`; "Load" is disabled until the three required fields are
  set. It decides nothing but which column name goes with which field —
  parsing, validation and messages all live in `lib/`, where they are tested.
- `components/Select.tsx` — **new in the follow-up.** The dark dropdown that
  replaced the native `<select>` (D23): the ARIA 1.2 select-only combobox
  pattern — a real button with `role="combobox"`, a `role="listbox"`, and focus
  that stays on the button while `aria-activedescendant` points at the active
  option. Keyboard support is the part that had to be rebuilt by hand: arrows
  (wrapping), Home/End, Enter/Space, Escape, Tab-closes, and type-ahead that
  cycles on a repeated letter and narrows on a longer string. The list renders
  in normal flow rather than as a positioned overlay, because the mapping panel
  scrolls internally and would clip a popup drawn over it. Pointer and keyboard
  share one highlight class, so what the eye follows and what
  `aria-activedescendant` names can never be two different rows.
- `components/Legend.tsx` — **new.** Collapsible (open by default), and it
  follows the mode. Points: three scaled circles for magnitude, then the depth
  gradient with 0 / 150 / 700 km labels. Heatmap: the density ramp labelled
  Sparse → Dense, plus a line saying brightness is how many quakes are nearby,
  not how deep or how big. This is what makes the two meanings of colour
  stated rather than merely mutually exclusive (D20).
- `app/page.tsx` — renders `<MapView />` full-viewport (`100dvh`).
- `app/layout.tsx` — root layout and the single entry point for CSS. Phase 4
  added a third sheet in the middle: `mapbox-gl.css`, then
  `@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css`, then `./globals.css`, in
  that order (D10). Draw's sheet is mostly the button bar we suppress, but it
  also carries the cursor rules — crosshair while placing corners, a grab hand
  over a vertex — which are most of what makes drawing feel like drawing.
- `app/globals.css` — everything from Phases 1-2 is still byte-identical.
  Phase 3 added `color-scheme: dark` on `:root` (still worth having, for
  scrollbars and native chrome, though the dropdown no longer relies on it),
  `.legend__*`, the shared `.data-panel__button` / `.mapper__button` language,
  and `.data-panel__notice--info|--error`. The follow-up replaced
  `.mapper__select` with the `.select__*` block, and added `.visually-hidden`,
  `.mapper` (the height and scroll behaviour, which had to leave the inline
  styles so that a media query could override it), and the `.map-overlay`
  layout with its `max-width: 46rem` rule. As before, only what inline styles
  cannot express lives in CSS - states, and now media queries.

  Phase 4 appended 27 lines and deleted none: `.data-panel__button
  [aria-pressed="true"]`, a tinted pressed state for "Draw area" (tinted
  rather than merely brighter, because while it is on a click on the map does
  something different); and `.mapboxgl-ctrl-group.mapboxgl-ctrl:empty {
  display: none }`. That second one is load-bearing —
  `displayControlsDefault: false` suppresses Draw's buttons but *not* the
  container they would have gone in, and mapbox-gl.css gives an empty control
  group a white background and a shadow, which is a pale smudge in a corner.
  `:empty` is the whole condition, so a control group with buttons in it is
  left alone.

  Phase 5 appended 36 lines and deleted none, all of them `.data-panel__dot`:
  the fetching indicator, a 0.36rem amber dot breathing on a 1.4s opacity
  keyframe. A dot rather than a spinner because the map underneath is the
  thing worth watching and a rotating ring in the corner pulls the eye off it.
  `prefers-reduced-motion` stops it moving and leaves it visible — it is a
  state, not a decoration, and the words beside it already say what is
  happening. Read in document order the built chunk still goes mapbox-gl.css →
  mapbox-gl-draw.css (40991) → globals.css (45514) → Phase 4's `:empty` rule
  (51998) → this block (52053), so D10's ordering holds with a fifth block on
  the end.

### Tests
- `vitest.config.mts` — node environment (no jsdom: nothing under test touches
  the DOM), `include: ["tests/**/*.test.ts"]`, `resolve.tsconfigPaths`.
- `tests/csv.test.ts` — 6 tests, **unchanged from Phase 1** and passing against
  the refactored parser, which is the evidence that D4/D5's row rules did not
  move.
- `tests/stats.test.ts` — 7 tests, unchanged.
- `tests/upload.test.ts` — **new in the follow-up**, 28 tests over
  `lib/upload.ts` only: the type guard (plain CSV, any case, `.tsv`/`.txt`, a
  `.csv` typed as an Excel file, zip/PNG/PDF/XLSX rejected, MIME consulted only
  when there is no extension, empty, oversized, and a 300-character hostile
  name clamped); `looksBinary` (CRLF and tabs fine, empty fine, NUL caught, a
  decoded zip caught, control noise caught, a mis-encoded Latin-1 CSV **not**
  caught at 2.3% and still not at 5%, a third-binary string caught, and only
  the first 4 KB read); `safeMessage` and `safeFileName` (clean text untouched,
  controls stripped, newlines collapsed, capped with an ellipsis, pure binary
  reduced to nothing and named "that file"); and `summarizeErrors` (empty list,
  one message, a count for the rest, a 5000-character cell capped to 120, and a
  readable sentence when every message was binary).
- `tests/columns.test.ts` — **new**, 23 tests over the pure mapping logic only:
  header reading (unnamed columns dropped, papaparse's `_1` suffix kept, no
  data rows needed); `detectMapping` (USGS file, case-insensitivity keeping the
  file's own spelling, optional fields omitted, `null` when a required column
  is absent); `guessMapping` (alias and punctuation matching, no column claimed
  twice, all-empty when nothing is recognised, and that `Site`/`When` are
  deliberately *not* guessed); `validateMapping` (unselected required fields,
  a mapping naming a column the file lacks, optional fields not objected to);
  `toMapping`; and parsing under a mapping (correct features from oddly named
  columns, optional fallbacks, rows skipped when a mapped column is
  non-numeric, good rows kept alongside bad, a mapping naming an absent column,
  an incomplete mapping reported once, and the default equalling
  `USGS_MAPPING`).
- `tests/geo.test.ts` — **new in Phase 4**, 25 tests over `lib/geo.ts` only:
  points clearly inside a 0–10 square and clearly outside it; a mixed set
  keeping input order and returning the *same objects*; the boundary rule
  (edges, vertices, and a hair either side of an edge at 1e-6); the zero
  cases (empty feature set, `null`/`undefined` polygon, `null`/`undefined`
  features, a polygon with no rings, an empty ring, a two-point ring, a ring
  holding `NaN`, a feature holding `NaN`) — every one of which makes turf
  throw if handed to it raw; the shapes a caller might pass (a `Feature`
  wrapper, an unclosed ring that gets closed, a `MultiPolygon` counted across
  both parts, a hole that excludes what is in it, and a self-touching bow tie
  answered by the even-odd rule); the date line, both ways round and with a
  wrapped point counted exactly once; and a 29-feature global set filtered to
  a 25-point region.
- `tests/live.test.ts` — **new in Phase 5**, 41 tests over `lib/live.ts` only.
  The adapter: a real feed feature becoming the expected four properties,
  depth taken from the third coordinate and *not* from a `depth` property,
  feed order preserved, and — the one that matters — a feature built from the
  GeoJSON path being `toEqual` a feature built from the CSV path for the same
  earthquake, with matching keys. The document itself: a non-collection
  reported once having skipped nothing, and `null`/`undefined`/a string/an
  array/a non-array `features` field all refused without throwing; an empty
  collection is an empty result, not an error. The row rules, which is the
  evidence D4/D5 did not drift: a missing magnitude, a non-numeric one quoted
  back, out-of-range latitude and longitude, a non-Point geometry, six
  malformed entries skipped rather than thrown on, good features kept
  alongside bad and numbered by feed position, the cosmetic fields falling
  back rather than losing the quake, a blank place, an unusable timestamp, and
  a magnitude of zero accepted because it is a number and not a blank.
  `quakeKey`: same key for two objects describing one event, and a different
  key for each of the four fields varied on its own. `findNewQuakes`: only the
  absent ones; the very same objects in input order; nothing when the two
  fetches are identical; nothing when the previous set is empty, `null` or
  `undefined`; nothing in an empty fetch; departures from the rolling window
  ignored; and an event matched across the CSV and GeoJSON paths at once.
- The upload UI, the dropdowns, the drawing, the timer, the animation loop and
  the map are deliberately untested (D9). Note what that means:
  `checkUploadFile`, `looksBinary`, the clamps, `countPointsInPolygon` and now
  `parseQuakeGeojson` and `findNewQuakes` are covered because they are pure
  functions, but `Select`'s keyboard handling, every Draw event, the
  `setInterval` and the `requestAnimationFrame` loop are not — they are DOM,
  timer and WebGL behaviour, and testing them would mean the jsdom setup D9
  declined plus fake timers and mocked animation frames. They are covered by
  the manual verification record in `docs/TESTING.md` instead, with the
  specific things to press and watch — all since confirmed passing.

## Dependencies
**Unchanged, again.** Phase 5 added no runtime and no dev dependencies —
`git diff` touches neither `package.json` nor `package-lock.json`; the live
feed is `fetch`, and the animation is `requestAnimationFrame`. Phase 4 added
none either —
`git diff` touches neither `package.json` nor `package-lock.json`. Runtime is
`next`, `react`, `react-dom`, `mapbox-gl`, `papaparse`, `@turf/turf`,
`@mapbox/mapbox-gl-draw`; dev adds `vitest`, `@types/geojson` and
`@types/mapbox__mapbox-gl-draw`.

What changed is that the last two runtime deps are finally *used*. Both earn
their keep as D21 predicted they would:
- `@mapbox/mapbox-gl-draw` 1.5.1, added as a map control with its own button
  bar suppressed (D26).
- `@turf/turf` 7.4.0, for `booleanPointInPolygon` only. **The meta-package
  tree-shakes**: the built chunks contain no `voronoi`, no `tesselate`, no
  `@turf/clusters`, no `bezierSpline`. D21's reason for *not* reaching for it
  in Phase 3 — six lines of bbox arithmetic are not worth a meta-package — has
  not been undermined; the geometry here is real, and only the part that is
  real got bundled.

## Scripts
- `npm run dev` — dev server (Turbopack) on http://localhost:3000
- `npm test` — Vitest, single run
- `npm run test:watch` — Vitest in watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` / `npm run start` — production build and serve

## Verified
Everything in this section was actually run, in this environment.

### Phase 5
- `npm test` → **130 passed** (6 csv + 7 stats + 23 columns + 28 upload + 25
  geo + 41 live). `npm run typecheck` → clean. `npm run build` → compiled, 3
  static pages, no warnings.
- **This environment turned out to have network access**, which Phases 1–4
  never needed, so Phase 5's central claims were checked against the real USGS
  feed rather than against fixtures. The feed answers `200` with
  `Access-Control-Allow-Origin: *`, so the browser fetch will work.
- **The adapter, over the real feed:** 631 features in, **631 kept, 0
  skipped, 0 errors**. `computeStats` over the result reads 631 / M 7.8 at "64
  km NNW of Ende, Indonesia" / 0–645.026 km — the same headline event the
  sample has, which is the sanity check that the two paths are describing the
  same catalogue. Adapting all 631 takes **2.7 ms**.
- **The identity key, on real data and not in the abstract.** Diffed against
  the real 619-row sample CSV through the real `parseQuakeCsv`:

  | | |
  |---|---|
  | Live feed events | 631 |
  | Sample CSV events | 619 |
  | **Matched across CSV ↔ GeoJSON by key** | **606** |
  | In the feed, not in the snapshot (arrived since) | 25 |
  | In the snapshot, not in the feed (rolled off the month) | 13 |

  606 exact matches is the whole of D32's argument demonstrated: a key built
  from time, position and magnitude identifies the same earthquake on both
  data paths, which an event id could not have done.
- **Two back-to-back fetches of the live feed produced zero deltas.** This is
  the failure that would have mattered most — a key that jittered between
  fetches (a re-rounded coordinate, a revised magnitude) would ring the whole
  map every sixty seconds. It does not.
- **The 25-arrival figure is why the baseline is what it is.** Those 25 are
  what a naive "diff against what is on the map" would have pulsed
  simultaneously on the first auto-refresh, and the number grows every day the
  bundled snapshot is not refreshed. `liveKeysRef` starting `null` is what
  makes the first live fetch pulse nothing (D33).
- **Cost.** A diff over 631 features is **0.35 ms**; building the next key set
  is **0.25 ms**. Both run once a minute. The animation writes three scalars
  per frame and no data.
- **The pulse curve was sampled** rather than eyeballed — 5.0px/0.90α at 0ms,
  19.5px/0.57α at 1s, 26.9px/0.30α at 2s, 29.6px/0.10α at 3s, 30.0px/0α at 4s.
  It clears an M8.5 circle (24px) before it fades, and it clamps rather than
  extrapolating outside `[0, 1]`.
- **Phases 1, 2 and 4 are provably untouched.** `git diff --numstat` reports
  `89 0` for `lib/mapbox.ts` and `36 0` for `app/globals.css` — every Phase 5
  line is appended below what was there. `components/MapView.tsx` is `467 5`
  and `components/DataPanel.tsx` is `90 3`; all eight deletions were inspected
  and are doc-comment rewordings plus the four `setDataSource` →
  `applyDataSource` renames. `lib/csv.ts`, `lib/geo.ts`, `lib/columns.ts`,
  `lib/stats.ts`, `lib/upload.ts`, `lib/types.ts`, `Legend.tsx`,
  `ColumnMapper.tsx`, `Select.tsx` and `SelectionPanel.tsx` do not appear in
  the diff at all.
- **The dev-only console helpers are provably absent from the production
  build.** `npm run build`, then grepping every file under `.next/static`:
  zero hits for `__seismicDropKeys`, `__seismicMap`, `baseline is now` or
  `No live baseline`. The two apparent hits when grepping loosely are Next's
  own "Dropped segment" router message and Mapbox's public `flyTo` method,
  both checked in context. `process.env.NODE_ENV` is inlined at build time, so
  the guard removes the code rather than skipping it.
- **Phase 5 reaches the client bundle.** The built JS chunk carries
  `quakes-pulse-ring`, `4.5_month.geojson`, `no-store`, `circle-stroke-opacity`,
  "Refreshing", "Auto-refresh paused", "Fetching the latest" and "Live · USGS";
  the CSS chunk carries `data-panel__dot`, the `data-panel-breathe` keyframes
  and the `prefers-reduced-motion` guard. Document order in that chunk is
  unchanged (see the `globals.css` note above).
- **Not verifiable in the build environment (no WebGL):** the ring rendering,
  the timer firing, and whether a pulse reads as calm or as a flash. All of
  this was subsequently confirmed in a real browser on the deployed build —
  see `docs/TESTING.md`. The pulse and the selection ring read as distinct on
  the same quake even in the dense Indonesia cluster.

### Phase 4
- `npm test` → **89 passed** (6 csv + 7 stats + 23 columns + 28 upload + 25
  geo). `npm run typecheck` → clean. `npm run build` → compiled, 3 static
  pages, no warnings. The build prerendering at all is itself the evidence
  that importing Mapbox Draw at module scope survives SSR.
- **Phases 1 and 2 are provably untouched.** `git diff --numstat` reports
  `164 0` for `lib/mapbox.ts` and `27 0` for `app/globals.css` — every Phase 4
  line is appended below what was there. `components/MapView.tsx` is `184 2`,
  and both deletions are the `wireInteractions` signature growing a second
  parameter. `app/layout.tsx` is `9 4`, and all four deletions are a reworded
  comment above the imports.
- **The count was run headlessly over the real 619-row sample**, through the
  real `parseQuakeCsv`. Regions, drawn as bounding boxes:

  | Region | Box | Inside |
  |---|---|---|
  | Indonesia | 95…142 E, -11…8 N | 260 of 619 |
  | Japan / Kuril | 128…150 E, 28…48 N | 39 of 619 |
  | Chile / Peru | -76…-66, -45…-16 | 20 of 619 |
  | Alaska | -170…-140, 50…66 | 9 of 619 |
  | Tonga / Fiji | 176…190, -26…-14 | 39 of 619 |
  | Tonga / Fiji, written the other way | -184…-170, -26…-14 | 39 of 619 |
  | Whole world | -180…180, -90…90 | 619 of 619 |
  | Mid-Atlantic | -40…-20, 20…35 | 1 of 619 |

  The two Tonga rows are the date-line fix demonstrated on real data, not in
  the abstract: the same 39 quakes whichever copy of the world the box is
  drawn on (D27). The whole-world row is the sanity check that nothing is
  silently dropped.
- **Performance.** A recount is 0.09–0.76 ms depending on how much of the
  world the box covers. A hundred worst-case recounts — the whole world plus
  both longitude shifts, all 619 points — take **17.7 ms in total**, so a
  recount is comfortably inside a frame and there was never a reason to reach
  for a spatial index.

### The Phase 4 follow-up (per-frame counting)
- `npm test` → **89 passed**, unchanged; `lib/geo.ts` and `tests/geo.test.ts`
  are byte-identical, since the follow-up only changed when the function is
  called. `npm run typecheck` → clean. `npm run build` → clean, and
  `draw.render` is present in the built client chunk.
- **Draw's own event plumbing was read rather than assumed**, and three facts
  from it are what the design rests on:
  - `store.render()` wraps its work in a `requestAnimationFrame` and
    deduplicates, so `draw.render` fires **at most once per frame**. There was
    nothing left for us to throttle.
  - `store.render()` is called from `mode_handler.delegate`, i.e. only when a
    Draw mode actually handles an event — **not** on map pan or zoom. And both
    settled modes return `skipRender` from `onMouseMove`, so merely hovering
    over the map fires nothing. The event is therefore a change signal, not a
    ticker.
  - `Polygon.prototype.getCoordinates` returns `coords.concat([coords[0]])` —
    **every ring is closed on the way out**, half-drawn or not. This is why
    the guard cannot be geometric and must be the mode (D28).
- **No feedback loop.** The per-frame handler writes to `quakes-selected`, our
  own source; Draw's render event is driven by Draw's own store, which that
  write does not touch.
- Backspace/Delete are inert on the shape: Draw gates its trash keybinding on
  `options.controls.trash`, which `displayControlsDefault: false` leaves off.
  The digit-key mode shortcuts are gated the same way. "Clear" is the only way
  to remove a shape.
- **Not measurable in the build environment (no WebGL):** the actual
  smoothness of a drag — the cost of `setData` on the ring source and of the
  React render, the two things the identity check exists to avoid on unchanged
  frames. Confirmed smooth in a real browser on the deployed build, including a
  slow drag across the dense Indonesia cluster (see `docs/TESTING.md`). The
  turf recount was already known to be cheap.
- **Phase 4 reaches the client bundle**, not just the source tree. The built
  CSS chunk carries `mapbox-gl-draw_ctrl-draw-btn` and `mode-direct_select`
  (so Draw's sheet, including its cursor rules, is in), the minified
  `data-panel__button[aria-pressed=true]` rule and
  `.mapboxgl-ctrl-group.mapboxgl-ctrl:empty`. Read in document order the
  chunk goes mapbox-gl.css (offset 2318) → mapbox-gl-draw.css (40991) →
  globals.css (45514) → our `:empty` rule (52019), so the D10 ordering still
  holds with a third sheet in it. The client JS chunk carries "Draw area",
  "Draw a polygon to filter", "inside selection", `quakes-selected`,
  `draw_polygon`, `draw.modechange`, `displayControlsDefault` and
  `gl-draw-polygon-fill`.
- **Turf tree-shakes.** No `voronoi`, `tesselate`, `@turf/clusters` or
  `bezierSpline` anywhere in the built chunks.
- Turf's own behaviour was probed directly rather than assumed, and every
  contract in D28 comes from what it actually did: boundary points and
  vertices return `true`; an empty ring, a two-point ring and an unclosed ring
  all **throw**; a `Feature` wrapper, a `MultiPolygon` and a hole all behave;
  and a polygon spanning 170…190 returns `false` for a point at -175 and
  `true` for the same point written as 185.

### Phase 3 and the follow-up
- `npm test` → **64 passed** (6 csv + 7 stats + 23 columns + 28 upload).
  `npm run typecheck` → clean. `npm run build` → compiled, 3 static pages, no
  warnings.
- The Phase 1/2 code was provably untouched: 0 deletions in `lib/mapbox.ts`
  (47 additions, all appended) and 0 deletions in `app/globals.css`, and the 6
  Phase 1 parser tests pass unedited.
- Phase 3 and the follow-up reach the client bundle, not just the source tree.
  The built CSS chunk carries `legend__toggle`, `data-panel__notice--error`,
  `map-overlay`, `select__trigger`, `select__option`, `visually-hidden` and the
  `@media (max-width:46rem)` rule, alongside the existing `mode-toggle__option`
  rules; `mapper__select` is gone, so no dead CSS for the control that was
  replaced. The client JS chunk carries "Upload CSV", "Reset to sample",
  "Map columns", "Choose a column", "please upload a .csv", `combobox`,
  `aria-activedescendant`, `fitBounds` and `quakes-heatmap`.
- The upload path was exercised headlessly over the real 619-row sample:
  - `readCsvHeaders` finds all 22 columns; `detectMapping` returns the full
    USGS mapping, so **re-uploading a USGS file takes the no-questions path**.
  - `parseQuakeCsv(sample, detected)` is byte-identical to
    `parseQuakeCsv(sample)` — the mapping refactor changed nothing for the
    default case.
  - `computeStats` over it still returns `count: 619`, `maxMag: 7.8` at "64 km
    NNW of Ende, Indonesia", depth `0`–`645.026`, `skippedRows: 0`. So the
    stats bar should read **619 / M 7.8 / 0–645 km**.
  - The same file with `latitude`→`Y`, `longitude`→`X`, `mag`→`Magnitude`,
    `place`→`Site`: `detectMapping` correctly returns `null` (the mapping UI
    would open), `guessMapping` pre-fills `Y`, `X`, `Magnitude`, `depth` and
    `time` and leaves `place` blank, and parsing with `place: "Site"` added
    yields **619 features, 0 skipped, geometry identical to the sample's**.
  - Pointing magnitude at the text column instead: **0 features, 619 skipped**,
    first message `Row 2 skipped — Site is not a number (got "78 km ENE of
    Mutsu, Japan").` That is the input that should trigger the keep-previous-
    data refusal in the UI.
- A plausible "regional upload" bound: the 11 Chilean quakes in the sample span
  `[-71.94, -36.74]` to `[-67.57, -18.87]` — about 4° by 18°. That is the case
  `fitToFeatures` exists for; at the default zoom it is a smudge near the edge.
- **Every notice the upload path can produce was printed and inspected**, using
  a real zip built for the purpose and decoded exactly as `File.text()` would
  decode it (189 bytes in, 21% replacement characters, NUL present). The
  reproduction ran the same sequence of guards `handleFile` runs:
  - `quakes.zip` → stopped by the type guard: "Couldn't read quakes.zip —
    please upload a .csv." (48 chars)
  - the same zip **renamed** `quakes.csv` → past the type guard, stopped by the
    binary check, same message. This is the case an extension check alone
    misses.
  - `map.png`, an empty `.csv`, a 40 MB `.csv` → one clean line each, naming
    the limit where there is one.
  - a 400-character file name → clamped to 42 with an ellipsis, whole message
    80 chars.
  - a CSV whose bad cell is 300 replacement characters → caught as binary
    rather than quoted back.
  - a genuine CSV with every row invalid → "No usable points in broken.csv.
    Row 2 skipped — latitude is not a number (got "north"); …(+1 more) The map
    still shows the previous data." — the row-skip behaviour D18 describes,
    kept intact, with the quoted cell capped at 120 characters.
  - a genuine CSV with one bad row of two → loads, "Loaded 1 point · 1 row
    skipped".
  Across every case: **no notice contained a replacement character, a control
  character, or more than 220 characters.**
- Not verified here: anything needing a browser. There is no WebGL in this
  environment, so everything below is still unobserved.

## Investigated and NOT a bug: the circle layer in Heatmap mode
Two hard-edged orange discs near Indonesia and the Philippines were reported in
Phase 2 as the circle layer failing to hide. It was not. `MapView` adds exactly
two layers and one source and creates no markers; the toggle sets `visibility`
on both layers unconditionally, so a leak would show all 619 circles, not two.
The discs sat exactly where the densest clusters are, and modelling the shader
reproduced them from the heatmap alone: density 5.5 over Indonesia against a
ramp that clips at 1, with the falloff from 0.9 to 0.15 spanning 2px. The cause
was the 7.8px radius at the default zoom; D15's retune widens that falloff to
28px. The toggle logic was correct and was left alone (D12 still holds).

## Correction on the record, from Phase 1
An early Phase 1 write-up claimed the page loaded `mapbox-gl.css` before
`globals.css`. It did not — the check that "confirmed" it had sorted two hashed
filenames alphabetically instead of reading them in document order, so Mapbox's
`background:#fff` beat our equally-specific rule and the popup rendered as pale
text on white. Both the ordering and the specificity were fixed in the Phase 1
follow-up (D10/D11); in the current build Mapbox's
`.mapboxgl-popup-content{background:#fff}` sits earlier in the same chunk than
our more-specific `.mapboxgl-popup .mapboxgl-popup-content`, read in document
order. No `!important` anywhere.

## Does not exist yet
**The roadmap is complete.** What is listed here is what was never in it.

- **No control over the refresh interval**, and no way to turn auto-refresh off
  while live data is showing. 60 seconds matches the feed's own cache, and
  uploading a file is the only way to stop it. A pause toggle would be a fifth
  thing in the data panel.
- **No history.** The map shows the current state of the feed; a quake that
  rolls off the month window disappears with no announcement, and there is no
  record that it was ever there. `findNewQuakes` deliberately ignores
  departures.
- **The pulse is not queued.** A refresh that lands while a previous cohort is
  still fading replaces it, so a ring can be cut short in the rare case of two
  arrivals inside four seconds. Deliberate — it is what stops pulses
  accumulating (D34) — but it is a real behaviour, not an oversight.
- **No magnitude in the pulse.** Every arrival gets the same ring, whether it
  is M4.5 or M8. D34 argues for that; a size- or duration-scaled pulse would be
  the obvious next iteration if it ever reads as too flat.
- **No sound, no notification, no title-bar count** for an arrival. The map is
  the whole of the signal.
- No polygon beyond one at a time, and no way to combine or subtract shapes.
  One shape, one count (D28).
- The selection filters nothing but the count and the rings. The stats bar
  still describes the whole loaded set, not the selection — "max magnitude
  inside this box" would be a natural next step and `insideFeatures` already
  hands `computeStats` exactly what it would need.
- No way to export or copy what is inside a selection.
- The polygon is not persisted and is not in the URL, so it is gone on reload
  like everything else here.
- No drag-and-drop onto the map, and no URL/remote-CSV loading — upload is the
  file picker only.
- No persistence: an uploaded file lives in the browser tab and is gone on
  reload. Nothing is sent anywhere; the CSV never leaves the machine.
- No responsive breakpoints. The overlays are positioned for a desktop
  viewport (the narrow-width behaviour is documented in `docs/TESTING.md`).
