# Current State

_Last updated: Phase 3 follow-up — upload guard, custom dropdown, overlay grid_

Phases 1, 2 and 3 are built and machine-verified as far as this environment
allows: `npm test` (64 passing), `npm run typecheck` and `npm run build` are
all clean, and the production build ships the new controls in both the CSS and
the JS chunks.

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
- `lib/mapbox.ts` — unchanged through `QUAKE_HEATMAP_LAYER`; see the Phase 2
  notes below. Phase 3 **appended** `MapMode` (`"points" | "heatmap"`, moved
  out of `MapView` so the legend can take it as a prop) and three legend
  constants that mirror the layers' paint values: `DEPTH_LEGEND_STOPS`,
  `DENSITY_LEGEND_STOPS`, `MAGNITUDE_LEGEND_STOPS`. They restate rather than
  derive, deliberately (D20), and sit directly beneath the layers they
  describe with a keep-in-sync note.
- `lib/stats.ts` — unchanged. `computeStats(features): QuakeStats`, pure,
  single pass, every aggregate nullable (D14). Phase 3 reuses it verbatim: it
  is recomputed once per successful load, sample or upload, on the same
  features handed to the source.
- `lib/branding.ts` — unchanged; `APP_NAME` is still the single source of truth
  for the product name.

#### The Phase 2 heatmap paint values, for reference
Unchanged in Phase 3 and reproduced here because the eyeball checklist below
still refers to them. Weight is compressed to 0.5 at M4.5 → 1.0 at M8.5.
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
- `components/DataPanel.tsx` — **new.** Upload button, "Reset to sample"
  (shown only when uploaded data is displayed), the current source label, and
  the dismissible notice. The picker is a hidden `<input type="file">` driven
  by a real button — no `<form>`, since the file never leaves the browser. The
  input's value is cleared on every pick so re-selecting the same file fires
  again.
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
- `app/layout.tsx` — root layout and the single entry point for CSS:
  `mapbox-gl/dist/mapbox-gl.css` then `./globals.css`, in that order (D10).
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
- The upload UI, the dropdowns and the map are deliberately untested (D9).
  Note what that means after the follow-up: `checkUploadFile`, `looksBinary`
  and the clamps are covered because they are pure functions, but `Select`'s
  keyboard handling is not — it is DOM behaviour, and testing it would mean the
  jsdom setup D9 declined. It is on the eyeball list instead, with the specific
  keys to press.

## Dependencies
**Unchanged.** Phase 3 added no runtime and no dev dependencies — `git diff`
touches neither `package.json` nor `package-lock.json`. Runtime is still
`next`, `react`, `react-dom`, `mapbox-gl`, `papaparse`, `@turf/turf`,
`@mapbox/mapbox-gl-draw`; dev still adds `vitest` and `@types/geojson`.
`@turf/turf` and `@mapbox/mapbox-gl-draw` remain installed and unused, for
Phase 4.

## Scripts
- `npm run dev` — dev server (Turbopack) on http://localhost:3000
- `npm test` — Vitest, single run
- `npm run test:watch` — Vitest in watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` / `npm run start` — production build and serve

## Verified
Everything in this section was actually run, in this environment, at the end
of the Phase 3 follow-up.

- `npm test` → **64 passed** (6 csv + 7 stats + 23 columns + 28 upload).
  `npm run typecheck` → clean. `npm run build` → compiled, 3 static pages, no
  warnings.
- The Phase 1/2 code is provably untouched: 0 deletions in `lib/mapbox.ts`
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

## Needs a human eyeball
Nothing below was machine-verified. The code typechecks, builds, and its output
is in the shipped bundle, but it has never been rendered.

### The Phase 3 click-through
1. **Sample.** Page loads, left panel reads `619 quakes · M4.5+ past month`
   and the stats bar reads 619 / M 7.8 / 0–645 km. Right side shows the mode
   toggle above a data panel saying "Sample · USGS M4.5+, past month", with no
   "Reset to sample" button (there is nothing to reset from).
2. **Upload, USGS-shaped.** Pick `public/sample-quakes.csv` itself. It should
   load with no mapping UI at all, the subtitle should switch to
   `619 quakes · sample-quakes.csv`, a notice should read "Loaded 619 points",
   "Reset to sample" should appear, and the map should ease to fit the data.
3. **Bad file.** A CSV with no usable coordinates (or the sample with its
   `mag` column renamed and then mapped to `place`). Expect a warm-toned
   notice, the previous points **still on the map**, and the stats bar
   unchanged.
4. **Column mapping.** A CSV whose columns are named anything else. The mapper
   panel should open below the data panel, pre-filled where it can be, with
   "Load" disabled until latitude/longitude/magnitude are all set.
   - **The dropdown is the thing to look at**, since it is what the follow-up
     replaced. Open one: the list must be dark with light text, and legible.
     Check the selected row shows a tick and the row under the pointer
     highlights.
     - Keyboard, all from the closed button: Down/Up opens and moves, Home/End
       jump, Enter or Space picks, Escape closes without picking, Tab closes
       and moves on, and typing "l" repeatedly cycles through columns starting
       with L. None of that is unit-tested (D9) — it is DOM behaviour, and this
       is the check.
   - Opening a dropdown low in the panel should scroll it into view inside the
     panel, not push the panel over the map.
5. **Bad file types.** Drop in a `.zip`, then a `.png`, then a `.csv` that is
   really a renamed zip. Each should give one short line ("Couldn't read … —
   please upload a .csv."), the map should keep its points, and **no binary
   should appear anywhere in the panel**. The console is where the real error
   goes.
6. **Reset.** Returns to the sample, eases back to the opening Pacific view,
   the "Reset to sample" button disappears again.
7. **Both modes on uploaded data.** Toggle to Heatmap while an upload is
   displayed; it should just work — same source, no refetch, no flicker. Then
   toggle back and click a point: the popup should show the uploaded file's
   place string, escaped.
8. **The legend.** Bottom of the left stack. It should switch content with the
   mode, collapse and expand, and stay small enough not to dominate.

### Layout, after the follow-up
The overlap is fixed structurally rather than by tuning numbers — two columns
of one grid cannot overlap each other at any width — but the arithmetic below
has still never been rendered.

- **The overlap case itself.** Open the mapper on a desktop window and confirm
  the columns stay apart. The grid is `minmax(0, 17rem)` and `minmax(0, 16rem)`
  with `space-between`, so the two columns plus padding and gap need 36rem
  (576px) and shrink rather than collide below that.
- **The tall mapper.** With all six dropdowns and one open, the panel should
  scroll inside itself and stop at 26rem, never running past the bottom of the
  map. Only the mapper is allowed to shrink; the toggle and data panel keep
  their size (`flex: none` on stack children, overridden for `.mapper`).
- **Narrow viewports.** Under 46rem (736px) the grid becomes one column: title
  and stats, legend, toggle, data panel, mapper. While the mapper is open the
  legend is hidden — that is the `map-overlay--mapping` class doing its job,
  and it is worth confirming it comes back when the mapper closes. This is a
  not-broken layout, not a designed one.
- **A long file name** in the subtitle and the source label. Now clamped to 42
  characters by `safeFileName` as well as `word-break`, unverified.
- **The stats bar's longest `place`** wrapping inside the panel instead of
  stretching it — still the Phase 2 open question.

### Carried from Phase 2, still unseen
- **The retuned heatmap.** At zoom 1.4 the model predicts: sparse ocean quakes
  as a dim ember barely above the basemap, Alaska deep orange, Chile orange,
  Tonga and Japan bright amber, Indonesia and the Philippines near-white cores
  — the Sunda arc core about 18px across, glow fading by 46px. If it reads
  cold, raise `heatmap-intensity`'s z0/z1.5 stops (0.3 / 0.36) together; if the
  arcs melt into one mass, lower `heatmap-radius`'s z0/z2 stops (18 / 24).
  Change one at a time — they pull against each other.
- Whether the model's density figures match what the GPU actually draws.
- That the toggle visibly swaps the layers with no frame showing both or
  neither.
- That popups and the pointer cursor go quiet in Heatmap mode and return in
  Points mode.
- Behaviour above zoom 6, which the Phase 2 fitting only spot-checked.

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
- No polygon draw / point-in-polygon count (Phase 4); `@turf/turf` and
  `@mapbox/mapbox-gl-draw` are installed but still unused.
- No live refresh or pulse animation (Phase 5).
- No drag-and-drop onto the map, and no URL/remote-CSV loading — upload is the
  file picker only.
- No persistence: an uploaded file lives in the browser tab and is gone on
  reload. Nothing is sent anywhere; the CSV never leaves the machine.
- No responsive breakpoints. The overlays are positioned for a desktop
  viewport (see the layout risks above).
