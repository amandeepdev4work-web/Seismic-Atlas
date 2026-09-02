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

## D25 — The drawn selection is painted in neutral chrome, and the ring follows Points mode while the count follows the data
Two questions, one answer. Both colours on this map already mean something: warm-to-cool means depth in Points mode and ember-to-white means density in Heatmap mode (D15/D20). Mapbox Draw's default theme is `#3bb2d0` blue and `#fbb03b` orange, and that orange is within a shade of both the circle layer's shallow-depth stop and the heatmap's mid-ramp. A selection outline in it would read as data.

So the selection is drawn in near-white — `#f2f6fa` for the polygon outline, its fill at 6% opacity, its vertex handles, and the ring around each selected quake. **Nothing on this map encodes a value in neutral white, which is precisely why the selection can use it without claiming to mean anything.** It is chrome drawn over data, and it looks like it. Draw's filters are left exactly as they came — they are how Draw addresses its own feature/vertex/midpoint bookkeeping and are not ours to reinterpret; only the paint differs.

The point highlight is a **separate source and a separate layer**, `quakes-selected` / `quakes-selected-ring`, added above the circle layer and fed only with the features the count found inside. That is what makes it safe: the Phase 1 circle layer and the Phase 2 heatmap are not touched, not re-painted at runtime, and not filtered — `lib/mapbox.ts` takes 164 added lines and zero deletions. With no polygon drawn the ring source is empty and the layer draws nothing, so the feature costs the default view a source and a hidden layer and no pixels.

It is a **ring, not a re-fill**. The quake underneath keeps its depth colour, so "this one is in the selection" is added to what the point already said rather than written over it. The radii mirror the circle layer's with a constant 2.5px added, restated rather than derived for exactly the reasons D20 gave for the legend swatches — and with exactly the same obligation to move them if the circle layer's stops ever move.

**The ring is hidden in Heatmap mode; the count is not.** That asymmetry is the decision. The count is a fact about the loaded data — 87 of 619 of these events are inside this shape — and it is equally true whichever layer is drawing them, so it keeps working and keeps updating in Heatmap mode. A ring around one quake is a different kind of claim, and a heatmap deliberately has no individual quakes to make it about: rings scattered over a density field would assert a precision the layer underneath is built to smooth away, and would fight it visually besides. The toggle already carries the switch (D12), so this cost one branch in the effect that was already flipping two layers' visibility. The polygon outline itself stays visible in both modes — it is the shape the number refers to, and hiding it would leave a count with nothing on screen to explain it.

## D26 — Draw's own control bar is suppressed, and the tool joins the right-hand stack as one panel
`displayControlsDefault: false`. Mapbox Draw ships a button bar, and taking it would have been free — but it is a light-themed control group that installs itself in a map corner, and this layout has no corner left to spend: the two top corners are the overlay grid's columns and the two bottom ones belong to Mapbox's logo and attribution. It would also have been the third visual language on screen, after the overlay panels and the popup.

So the draw controls are ours, and they are **one panel in the existing right-hand stack** (`components/SelectionPanel.tsx`), under the mode toggle, reusing `.data-panel__button` — the pill language the data panel and the mapper already share. A third absolutely positioned box would have reintroduced precisely the overlap the grid in D24 was adopted to make impossible.

**The button and the count are in the same panel**, which is the part worth arguing. The obvious alternative was to put the count in the stats bar on the left, next to Events / Max mag / Depth, where it reads well as another aggregate. It was rejected because the count is the *answer to the button*: separating them means drawing a shape on the right and looking left to find out what happened. "Draw area" holds a pressed state keyed off `aria-pressed`, tinted rather than merely brighter, because while it is on, a click on the map places a corner instead of doing what it normally does — that is a mode, and it should not look like a button that has merely been hovered.

Two smaller calls fall out of it:

- **Suppressing the buttons does not suppress their container.** Draw appends an empty `.mapboxgl-ctrl-group` regardless, and mapbox-gl.css gives that a white background and a shadow — a pale smudge in a corner. One rule hides it, and `:empty` is the whole condition, so a control group that actually has buttons in it is left alone.
- **Draw's stylesheet is still imported**, even though the bar it mostly styles is gone, because it also carries the cursor rules — crosshair while placing corners, a grab hand over a vertex — which are most of what makes drawing feel like drawing.

And **popups go quiet while a shape is being drawn**. Draw does not stop a layer-specific click handler from firing, so a click that landed on a quake would place a vertex *and* open a popup, over the shape being drawn. Nothing about the popup changed — content, escaping and styling are all Phase 1's (D8/D11) — only the moment it opens: one guard on a ref that mirrors the drawing flag, since the handler is wired once on `load` and cannot see later renders. Deliberately narrow: popups still work while a *finished* polygon is on the map, because inspecting the points inside a selection is a reasonable thing to want.

## D27 — A point is matched against every copy of the world the shape covers
A web map repeats the world sideways, and Mapbox Draw records what the user actually clicked — its own constants allow longitudes from -270 to 270. The quakes, meanwhile, are stored as the feed gives them, inside ±180. So a box drawn across the date line arrives as 170…190 while the quakes it visibly encloses sit at -175, and comparing those numbers to each other counts none of them. This is not a curiosity in this app: the default view is centred on the Pacific at zoom 1.4, which puts the date line in the middle of the first frame, so a shape around Tonga or Kamchatka is one of the *likelier* things a user will draw.

The fix is not to cut the polygon at the seam — that is real work, it changes the geometry the user drew, and turf's helpers for it bring their own edge cases. Instead each point is offered at every longitude that names the same place: `+360` when the shape reaches past 180, `-360` when it reaches past -180, and the loop stops at the first copy that lands inside so a shape wide enough to contain both cannot double-count. A shape inside one world — the overwhelming majority — gets one test per point and pays nothing.

It is verified on the real feed rather than only in the abstract: the Tonga/Fiji cluster counts **39 of 619** whether the box is drawn as 176…190 or as -184…-170. Same 39 quakes, two ways of writing where they are.

The cost is a bounding box computed per recount, which pays for itself immediately — it is also the cheap reject that keeps a global feed's worth of points from each taking a ray cast. A hundred worst-case recounts (whole world, both shifts, all 619 points) take 17.7 ms in total, so a recount is well under a frame and there was never a reason to reach for a spatial index.

## D28 — `lib/geo.ts` is the tested core, and its answers to the awkward cases are contracts
`countPointsInPolygon(features, polygon)` takes features and a shape and returns `{ inside, insideFeatures }`. No map, no DOM, no globals — the same rule `parseQuakeCsv` and `computeStats` follow, and the reason this is the part with 25 tests while the drawing itself is left to a browser (D9). The drawing UI is not unit-tested and will not be: testing it means mocking WebGL and Draw's own event plumbing, which proves less than dragging a vertex.

Three behaviours are decided here rather than inherited, and the tests exist to pin them:

- **A point on the boundary counts as inside.** That is turf's default, and it is the right default to keep: a quake sitting exactly on a line the user just drew around it is one they meant to enclose, and whichever way it goes, "on the line is in" is at least a rule a user can predict. Vertices count too.
- **Nothing throws.** Turf throws on most malformed rings — an empty ring, a two-point ring, a ring whose last position does not repeat its first — and a half-drawn shape is the *ordinary* state of a drawing tool, not an error. So a missing, empty or degenerate polygon is screened out and answered with zero, and a ring that is merely unclosed is closed rather than refused, since GeoJSON requires the repeat and a caller who left it off meant the closed shape. A feature with a non-numeric coordinate is skipped, not fatal — the same forgiveness D4 shows a bad `place`.
- **`insideFeatures` holds the very same objects, in input order**, because the ring layer needs the features and not copies of them.

**What "live" means** is a decision too, and it moved in the Phase 4 follow-up. Both versions are below, because the reason it moved is a fact about Draw that is easy to get wrong and that I got wrong the first time.

Phase 4 recomputed on `draw.create`, `draw.update` and `draw.delete` only, which for a vertex drag means the moment the mouse is released. That was correct but it undersold the tool: the count ticking up as a corner is dragged is the thing actually worth watching, and it was invisible. So `draw.render` is wired as well, and the count now updates continuously while a vertex is dragged or the shape is moved.

Two things make that affordable, and neither is a throttle:

- **Draw already deduplicates its own render event to one per animation frame** — a `requestAnimationFrame` in its store — and the settled modes return `skipRender` from their mouse-move handlers, so hovering over the map fires nothing at all. `draw.render` therefore arrives at most once a frame and only when geometry or selection actually changed. There was nothing left to throttle, which is why it is left un-throttled.
- **The two writes are skipped when nothing changed.** The recount is a fraction of a millisecond, but `setData` on the ring source costs a worker round trip and a re-tile, and `setSelection` costs a React render — and most frames of a drag change neither, because a vertex crossing empty ocean encloses exactly the quakes it did last frame. Comparing the two sets is exact and free precisely because `insideFeatures` returns the *same objects in input order*, three bullets up. This is not throttling: every genuine change still lands on the frame it happened. It is declining to redo work with no effect.

**The guard is the mode, and it has to be.** The original version of this entry said `draw.render` was unusable while drawing because "there is no closed polygon to count against yet". The conclusion was right and the stated reason was wrong, which matters, because the wrong reason points at a geometric guard that cannot work. Draw's `Polygon` model stores rings *unclosed* and closes them on the way out — `getCoordinates` concatenates the first position onto the end — so a half-drawn shape comes back as a perfectly well-formed closed ring. Counting corners does not rescue it either: two clicks into a polygon the ring already has three positions plus the repeat. What is wrong with counting at that moment is not that the geometry is malformed but that it is **provisional** — Draw keeps a trailing vertex glued to the cursor, so the number would be about wherever the mouse happens to be. Nothing in the geometry says so. Only the mode does, so `getMode() === "draw_polygon"` is the guard, and the panel keeps showing the corner-placing hint until the shape is a shape.

**The three edge events stay unguarded, deliberately.** `draw.create` is fired from the outgoing mode's `onStop`, which Draw runs *before* it updates the current mode name — so at that instant `getMode()` still says `draw_polygon`. A mode-guarded create handler would silently drop the single most important count, the one that appears the moment a polygon is finished. The render event is the refinement between the edges; the edges are the truth.

The guard is not load-bearing for safety, only for meaning: `drawnPolygon` still returns null when there is no polygon, and `countPointsInPolygon` still refuses to throw on a degenerate ring. It is there so the panel does not show a number that is about the mouse pointer. And none of this touched `lib/geo.ts` or its 25 tests — the whole change is *when* the function is called.

**One polygon at a time**, enforced at the one place a shape can start: "Draw area" calls `deleteAll` before it changes mode, so a new shape replaces the old rather than accumulating. That is why the code that reads the shape back can take the first polygon it finds instead of reconciling a set — and `deleteAll` is a programmatic change, which Draw deliberately fires no event for, so "Clear" updates the panel itself rather than waiting to be told.

## D29 — A polygon outlives the data drawn under it; the count is recomputed, never cleared
Upload a file or reset to the sample while a shape is on the map, and the shape stays and the count is recomputed against the new features. It would have been tidier to delete it, and the alternative is genuinely defensible — because an upload also re-frames the map (D21), a polygon drawn over Japan can end up off-screen when the new data is Chilean, leaving a truthful "0 of 42 inside selection" that reads like a broken feature.

It was still rejected, for the reason D18 gives for not blanking the map to report a bad file: the user drew that shape, and destroying their work to reach a state that is easier to describe is the worse failure. A polygon is a question about a region, not a property of a dataset — "how many events are in this box" is a perfectly good question to ask of a second file, and asking it is one of the more interesting things this tool can do. A count of zero is the honest answer when the answer is zero, and "Clear" is one click away, whereas a shape deleted on the user's behalf costs them the whole drawing.

So the recount hangs off `showFeatures`, the single path through which anything reaches the source (D19), which means it covers upload, reset and any future data path for free rather than being remembered at three call sites.
