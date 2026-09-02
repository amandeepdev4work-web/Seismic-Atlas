# Architectural Decisions

## D1 — Points render as a Mapbox GL GeoJSON source + layer, not React markers
Reason: GPU-rendered circle/heatmap layers handle tens of thousands of points smoothly; per-point React markers create DOM nodes and jank at scale. This choice also makes the heatmap toggle nearly free (it's just a second layer type on the same source).

## D2 — GeoJSON FeatureCollection is the single internal data format
Reason: CSV (sample or uploaded) is parsed into GeoJSON immediately. Everything downstream — rendering, heatmap, polygon-count — consumes one
format. No special-casing.

## D3 — Mapbox map instance lives in a ref, never in React state
Reason: it's a large mutable object; putting it in state triggers re-render loops. React owns the UI/panels declaratively; the map is commanded imperatively via map.getSource(id).setData(...).

## D4 — Validation is strict on geometry, forgiving on cosmetics
Reason: `latitude`, `longitude` and `mag` decide *where* a point sits and *how big* it is — a bad value there is either a crash or a lie, so the row is skipped and the reason recorded. `depth`, `place` and `time` only decide how a point looks or reads, so a bad value falls back (`0`, `"Unknown location"`, `""`) rather than discarding an otherwise valid earthquake. Dropping a real M7 because its `place` string was empty would be the worse failure.

## D5 — Out-of-range coordinates count as invalid, not just non-numeric
Reason: a latitude of `120` parses as a number but is not a place. Mapbox silently misplaces or drops such points, which is harder to debug than a skip with a message. The range check lives in `parseQuakeCsv` so the Phase 3 upload flow inherits it for free.

## D6 — `parseQuakeCsv` reports errors, it does not throw
Reason: one malformed row in a 600-row file should cost that row, not the map. Returning `{ features, errors, skippedRows }` lets the caller decide — Phase 1 logs skips to the console and shows the count in the overlay; Phase 3's upload UI will show the messages to the user, using the same function unchanged.

## D7 — Mercator, not the v3 globe
Reason: Mapbox GL v3 can render a globe, and it demos well, but half the points curve away over the horizon. This is a scatter plot of a spherical dataset; a flat projection centred on the Pacific shows the whole Ring of Fire in the first frame. Restraint over spectacle, per the design principle.

## D8 — Popup content is built as an escaped HTML string
Reason: `place` comes from a data file, and Phase 3 will let users upload their own. `setHTML` with unescaped input would be an injection hole in a portfolio piece, so every interpolated value goes through `escapeHtml` first.

## D9 — Vitest runs in the `node` environment with no React testing setup
Reason: the only thing worth unit-testing right now is a pure function. jsdom, `@vitejs/plugin-react` and Testing Library would all be installed to test nothing, and testing the map component means mocking WebGL — expensive, brittle, and it proves less than opening the page. Map behaviour is verified by looking at it.


## D10 — All CSS is imported from `app/layout.tsx`, and popup overrides also win on specificity
Reason: Next emits stylesheets in import order, but "import order" spans the whole module graph — with `globals.css` in the layout and `mapbox-gl.css` in the page, ours shipped *first* and Mapbox's `.mapboxgl-popup-content{background:#fff}` overrode it at equal specificity, which is what made the popup unreadable. Both imports now sit in the layout, vendor first, so the order is stated in one place. Belt and braces: every popup override is also written one class more specific than the Mapbox rule it replaces (`.mapboxgl-popup .mapboxgl-popup-content` beats `.mapboxgl-popup-content`), so a future re-chunk cannot silently undo the styling. No `!important` — specificity is checkable, `!important` just moves the argument.

## D11 — Popup colours are their own `--popup-*` tokens, not the map chrome's
Reason: the overlay sits on the map and can be semi-transparent; the popup sits on top of data and must stay legible over any circle colour, so it is opaque `#12141a`. Separate tokens let the two move independently. Values are picked for contrast against that background rather than by eye — the label (`#97a5b3`) is the weakest at 7.3:1, comfortably past WCAG AA, and the tip reuses `--popup-bg` exactly so no seam shows where it meets the panel.

## D12 — The toggle flips `visibility` on two co-existing layers; it never adds or removes them
Reason: both layers are added once on `load`, from the same source, and the toggle only sets `visibility` to `visible`/`none`. Adding and removing layers on each click would re-upload the geometry to the GPU and re-run layout every time, and would also mean the toggle's correctness depended on the map's current layer list rather than on one boolean. As a bonus this makes the "don't refetch on toggle" requirement structural rather than something to remember: there is no code path from the toggle to `fetch`, `parseQuakeCsv` or `setData`. Hidden layers are also excluded from Mapbox's hit-testing, so the Phase 1 popup and cursor handlers on the circle layer go quiet in heatmap mode without a single change to them.

## D13 — The heatmap reuses the circle layer's palette, reversed, and is tuned at world zoom
**Superseded by D15.** Both halves of this entry turned out to be wrong in
practice — the palette read as cold haze and the tuning produced blue dots
plus two hard-edged discs. Kept for the record; D15 explains why.

Reason: two chart modes in one tool should look like one tool. The density ramp runs from `#2a4d9b` — the circle layer's deepest-depth colour — up to `#ffd166`, its shallowest, so the heatmap is recognisably the same family rather than a stock red-to-yellow gradient bolted on. The reuse is a visual tie, not a semantic one: colour means depth in Points mode and density in Heatmap mode, which is legible only because the two are mutually exclusive and the toggle names the active mode. If they ever became simultaneously visible, this palette would have to fork.

Tuning is anchored to the default zoom of 1.4, not to a comfortable city zoom. `heatmap-radius` starts at 5px and only reaches 50px by zoom 9, because the Ring of Fire is a thin arc: a radius that flatters a single metro area merges the entire Pacific rim into one blob at zoom 1. `heatmap-intensity` moves the opposite way (0.6 → 3) since points overlap at world zoom and separate as you go in. The density-0 stop is fully transparent — a non-transparent one paints a flat wash over the whole basemap instead of a heatmap.

## D14 — Stats are computed once by a pure helper, and every aggregate is nullable
Reason: `computeStats` lives in `lib/stats.ts`, takes features and returns numbers — no map, no DOM, no fetch — so it is unit-testable the way `parseQuakeCsv` is, and Phase 3's upload flow can reuse it unchanged. It is called once, on the same features that were just handed to the source, and never again; toggling modes does not recompute it.

`maxMag`, `maxMagPlace`, `minDepth` and `maxDepth` are `T | null` rather than defaulting to `0`. An empty set has no maximum magnitude, and rendering that as `M 0.0` would state something false about the data — the same reasoning as D4, applied to aggregates instead of rows. `count` is the only field that is always meaningful. Non-finite inputs are skipped rather than propagated, since a single `NaN` would otherwise win or lose every comparison and blank the entire bar.

## D15 — The heatmap is fitted against a model of Mapbox's shader, and supersedes D13's tuning
D13's second paragraph was wrong, and wrong in a way worth recording rather than quietly editing. It reasoned that a small `heatmap-radius` (5px at z0) would keep the Ring of Fire an arc instead of a blob. Shipped, it produced the opposite of both goals: faint scattered blue dots across most of the arc, plus two hard-edged orange discs over Indonesia and the Philippines.

The missing fact is `GAUSS_COEF` in Mapbox's `heatmap.fragment.glsl`. Each point contributes

    weight * intensity * 0.39894 * exp(-4.5 * (dist / radius)^2)

and those contributions sum. Two consequences follow, and D13 accounted for neither:

1. **A point's peak contribution is ~40% of `weight * intensity`, not 100%.** With D13's weights and an intensity of 0.88 at the default zoom, the strongest isolated quake in the sample peaked at density 0.31 — stop 0.15–0.35 of that ramp, which was `#2a4d9b`→`#4a8fe7`. Deep blue. Every sparse quake on the map was rendering in the cold third of a ramp that was never meant to be reached alone.
2. **Density is dominated by how many points fall inside the radius, not by any one point's magnitude.** At 3.8px per degree of longitude (zoom 1.4), a 7.8px radius spans about two degrees, so the two densest arcs concentrated dozens of quakes into a handful of pixels: modelled density 5.5 over Indonesia and 1.9 over the Philippines against a ramp that clips at 1. A saturated core whose density falls from 0.9 to 0.15 across **2px** is not a glow, it is a disc with a hard edge. That, and not a leaking circle layer, was the reported bug — see the note in STATE.md.

So the paint values are now fitted rather than guessed. A model of the shader (Mercator projection at the real zoom, the real 619 points, the kernel above) was run against candidate stops, and the ramp's own stops were then placed on the *measured* density landmarks instead of round numbers. At zoom 1.4 the fitted values give: isolated M4.8 → 0.077, Alaska → 0.30, Chile → 0.55, Tonga → 0.80, Japan → 0.91, Philippines → 3.4, Indonesia → 11.8. The hottest core's 0.9→0.15 falloff now spans 28px rather than 2px.

Three principles fell out of the fitting and are the things to preserve if these numbers are ever revisited:

- **Radius is sized to the data's spacing, not to taste.** It has to be comparable to the gap between neighbouring quakes along a subduction arc, or they render as separate dots. That is ~22px at zoom 1.4.
- **Intensity below 1 at world zoom is correct, not a bug.** The dense arcs stack far past the ramp's top regardless; holding intensity down is the only thing keeping Chile, Tonga and Japan at *distinct* brightnesses rather than three identical white blobs. Raising it to 0.5 was tried and flattened them. It caps near 2 at high zoom, because past that a lone quake glows as brightly as a cluster.
- **Magnitude modulates, it must not dominate.** Weights are compressed to 0.5–1.0 across M4.5–M8.5. A wider spread lets one large event saturate the ramp unaided, which is how a single quake becomes a hard-edged disc.

D13's *palette* reasoning is also revised. The reversed depth ramp was a coherent idea that failed a plainer test: a heatmap whose low end is blue does not read as heat, it reads as haze, and the low end is most of the map. The ramp now runs transparent → dim ember → orange → amber → near-white. The transparent stop carries the same warm hue as the stop above it, so fading out never passes through grey. One thread of D13 survives on purpose: `#ffd166` sits at density 0.8 and is exactly the circle layer's shallow-depth colour, so the two modes still share a note without the heatmap pretending to encode depth.

## D16 — One parser, parameterised by a column mapping; there is no second parser
`parseQuakeCsv(csvText, mapping = USGS_MAPPING)` is the only code that turns CSV into features. The upload flow does not fork it, wrap it, or pre-normalise a file into USGS shape before handing it over — it passes a different `mapping` and gets the same `ParseResult`, with D4/D5's validation rules applied to whichever columns the mapping names. `lib/columns.ts` holds the mapping vocabulary (fields, labels, detection, guessing, validation) and knows nothing about GeoJSON; `lib/csv.ts` holds the parsing and knows nothing about dropdowns. The dependency runs one way, columns → csv, so neither can drag the other into a cycle.

Two consequences fell out of it, both deliberate:

- **Error messages name the column as the file spells it**, not as we think of it: "Row 14 skipped — Y 95 is outside the valid range of -90 to 90." Told "latitude is out of range", a user looking at a spreadsheet with no `latitude` column has to guess which of their columns we meant. With the USGS mapping the two spellings coincide, which is why the Phase 1 tests still pass untouched.
- **An incomplete mapping is reported once, not once per row.** A required field with no column selected is a fault in the mapping, so the parser returns zero features with a single message and `skippedRows: 0` — nothing was read, so nothing was skipped. Letting all 619 rows fail with the same message would report "619 rows skipped" for what is really one unset dropdown. `ParseResult.skippedRows` is documented as rows dropped rather than as `errors.length` because of this one case.

## D17 — Auto-detection is exact; alias guessing only ever pre-fills a form
Two different jobs, kept apart on purpose. `detectMapping` decides whether the app may proceed *without asking*, and so matches only the USGS names, case-insensitively — `LATITUDE` is the same column, `lat` is not. `guessMapping` fills in the dropdowns of a form a human is about to look at, and so matches a much looser alias list (`lat`, `y`, `lng`, `mw`, `depth_km`, …) after normalising away case and punctuation.

The asymmetry is the point: a wrong guess in the form costs one click to correct, whereas a wrong auto-detect silently plots the wrong column and says nothing. A file whose `y` column is a projected northing rather than a latitude should stop and ask. For the same reason `guessMapping` fills required fields first and never hands the same column to two fields, and leaves a field blank rather than reaching for a weak match — `Site` and `When` are not offered as `place` and `time`.

## D18 — A failed load keeps the previous data; the map is never blanked to prove a point
Zero valid points is a refusal, not a load. The features already on the map stay there, `setData` is not called, the stats bar is not recomputed, and the notice says what went wrong plus that the previous data is still shown. Blanking the map would destroy the thing the user was looking at in order to report a problem with a file they can simply pick again.

Partial failure goes the other way and is not an error at all: some rows skipped is the normal condition of real data (D4/D6), so it loads, and the count appears as a quiet notice — "Loaded 412 points · 8 rows skipped". The full messages go to the console, where a developer wants them; the panel gets the first one plus a count, because a corner overlay listing 600 messages is not a UI.

## D19 — The source and both layers are created on `load`, before any data exists
Phase 1 added the source inside the fetch's success path, which was fine when the sample was the only data there would ever be. It is not fine now: if `/sample-quakes.csv` 404s there is no source, and an upload has nothing to `setData` on — a broken sample would silently take the upload feature with it. So `map.on("load")` now adds the source (empty) and both layers immediately, and `layersReady` becomes true there rather than when the fetch resolves.

This also means every control that commands the map appears at the same moment and for the same reason, and that "there is exactly one source and exactly one pair of layers, created once" (D12) survives contact with a second data path.

## D20 — The legend mirrors the paint values as its own constants; it does not derive them
`DEPTH_LEGEND_STOPS`, `DENSITY_LEGEND_STOPS` and `MAGNITUDE_LEGEND_STOPS` restate colours the layers already contain. Deriving them instead would mean either building the layer specs out of shared constants — which fights Mapbox's expression-array types for no gain — or parsing an expression array back apart at render time to draw a gradient. The alternative is a duplication risk, so the constants live in `lib/mapbox.ts` directly beneath the layers they describe, with a "keep in sync" note, where a change to one has the other on screen.

The magnitude swatches are deliberately *not* the layer's radii: at M8.5 the layer draws a 48px disc, which is a poster in a 13rem panel. The legend keeps the ratios and scales them down, because what a reader takes from three dots is "bigger means stronger", not a measurement.

The legend also settles the ambiguity D13 introduced and D15 kept: colour means depth in Points mode and density in Heatmap mode. That was defensible because the modes are mutually exclusive, but it was never *stated* anywhere on screen. The legend now switches with the mode and says which meaning is live, so the toggle is no longer the only clue.

## D21 — Uploaded data re-frames the map; resetting to the sample restores the default view
An uploaded file can be anywhere — a survey of one Chilean province spans about 4° and would land as a smudge at the edge of the Pacific-centred default view. So a successful upload fits the map to the new features' bounds, capped by `maxZoom: 6` so a single point does not slam into street level. Bounds come from Mapbox's own `LngLatBounds.extend`, not `turf.bbox`: it is the same arithmetic, and this way the client bundle does not gain the turf meta-package for six lines of it. Turf earns its place in Phase 4, where the geometry is real.

Reset goes back to `MAP_INIT`'s centre and zoom rather than fitting the sample's bounds. The sample is global, so the two are nearly the same rectangle — but "reset" should return the view the app opens with, which D7 chose deliberately, not a rectangle that happens to resemble it. The sample's parsed features are cached in a ref at first load, so reset costs neither a fetch nor a reparse.
## D22 — A file is guarded twice, and nothing that came out of one is ever rendered verbatim
Browser testing found a `.zip` loading as far as the parser, which duly quoted the offending cell back at the user — so the error notice filled with decoded binary. Three things were wrong, and all three are fixed in `lib/upload.ts` rather than in the parser, whose row rules are not the problem and did not move.

**The extension is checked before the read, and the bytes are checked after it.** `checkUploadFile` rejects anything that is not `.csv` / `.tsv` / `.txt` before a single byte is read, so a 40 MB zip costs a glance at its name. But an extension is a claim: a zip renamed `quakes.csv` walks straight past it. `File.text()` will not help either — it never throws, it substitutes U+FFFD — so `looksBinary` inspects what came back, and treats a NUL byte, or more than 10% replacement and control characters in the first 4 KB, as binary. Both guards are needed: neither catches the other's case.

The 10% threshold was measured from both ends rather than picked. A Latin-1 CSV of Spanish place names decoded as UTF-8 lands at 2-5% replacement characters and **must still load** — a mangled `place` is cosmetic and never costs a row (D4). A real zip, decoded, sits above 20%; a PNG higher. Ten percent has clear air on both sides.

The extension also outranks the MIME type, which is the opposite of what looks correct. Chrome on Windows types a `.csv` as `application/vnd.ms-excel`; a MIME-first check would reject the exact files this app exists for. The browser's guess is consulted only when there is no extension at all.

**Every string that came from the file is clamped.** `safeMessage` strips control and replacement characters, collapses whitespace, and caps length with an ellipsis; `safeFileName` is the same with a shorter leash, and `summarizeErrors` puts parser messages through it before they reach a notice. `MapView.handleFile` clamps the name once and uses that value everywhere afterwards, so no later message can reach for `file.name`.

This is not an XSS fix — React escapes, and D8 already covers the one place we build HTML by hand. It is the same principle one level up: a file the user picked should never get to write arbitrary text into our UI, in our voice, at any length it likes. A 300-character file name would wreck a corner panel whatever its contents.

**What deliberately did not change:** a genuinely-CSV-but-invalid file behaves exactly as it did in Phase 3 — rows skipped and counted, the previous data left on the map, the reason shown (D18). The guards are for files that are not CSV at all, and the clamp only shortens what a real parse has to say.

## D23 — The mapping dropdowns are a hand-rolled listbox, because the native one cannot be made dark
Phase 3 used a native `<select>` on the stated grounds that it is keyboard- and screen-reader-correct for free, with `color-scheme: dark` to keep the popup dark. On Windows Chrome that second half is simply false: the open option list is drawn by the OS in a light popup that ignores `color-scheme`, and also ignores `background`/`color` set on the `<option>`s. Our near-white option text landed on a near-white popup, which is how it was reported.

Every fix that keeps the native popup is a bet on browser behaviour we cannot check from here, and the failure mode is unreadable text rather than something cosmetic. So the popup is ours: `components/Select.tsx`, the ARIA 1.2 select-only combobox pattern — a real `<button role="combobox">`, a `role="listbox"`, and focus that never leaves the button while `aria-activedescendant` names the active option.

The cost is honest: keyboard behaviour that came free now has to be written and maintained — arrows with wrapping, Home/End, Enter/Space, Escape, Tab-closes, outside-click, scroll-into-view, and type-ahead that cycles on a repeated letter and narrows on a longer string. That is the part most likely to rot, and it is the part D9 will not cover, because testing it means the jsdom setup D9 declined. It is on the eyeball list with the specific keys to press instead.

Two details are structural rather than stylistic. The list renders **in normal flow**, not as an absolutely positioned overlay, because the mapping panel scrolls inside itself and would clip a popup drawn over it — opening a dropdown pushes the fields below it down, which in a 15rem panel reads fine. And the keyboard highlight and the hover highlight are the same class, so what the eye follows and what `aria-activedescendant` points at cannot drift apart, for the same reason the mode toggle keys its pressed style off `aria-pressed` (Phase 2).

`color-scheme: dark` stays on `:root`. It was never doing this job well, but it still gets scrollbars and other native chrome right.

## D24 — The overlays are one grid with a column per edge, not two absolutely positioned stacks
Phase 3 put the panels in two stacks, `position: absolute` at `top/left` and `top/right`. Two absolutely positioned boxes have no relationship to each other, so nothing prevented them meeting in the middle — and with the tall mapping panel open, they did.

They are now two columns of a single grid laid over the map: `grid-template-columns: minmax(0, 17rem) minmax(0, 16rem)` with `justify-content: space-between`. Grid columns cannot overlap one another at any viewport width, which turns "do the panels collide?" from a question about arithmetic into a question the layout cannot answer wrongly. Below the width where both columns fit, they shrink (that is the `minmax(0, …)`) rather than collide; below 46rem a media query drops them into one column.

Three supporting rules matter as much as the grid:

- **Only the mapping panel may shrink.** Stack children get `flex: none`, so a cramped column does not squash the toggle or the data panel; `.mapper` overrides that with `flex: 0 1 auto` and its own `max-height` plus internal scroll. A tall panel gives way inside itself, never by pushing sideways.
- **The mapper's height lives in CSS, not in its inline styles.** Inline styles beat a stylesheet, so with `maxHeight` inline the narrow-viewport override could not win. The rest of the panel's chrome stays inline, per the convention the other panels follow.
- **The grid is `pointer-events: none` and each panel opts back in**, exactly as the two stacks did, so the map stays draggable in the gaps between panels.

The narrow layout is explicitly not a mobile design. It stacks the columns, tightens the padding, and hides the legend *while the mapping panel is open* — `MapView` adds a `map-overlay--mapping` class for exactly that one rule. Of everything on screen at phone width, a legend explaining a map you can barely see is the most expendable, and the alternative was the Load button ending up below the fold.
