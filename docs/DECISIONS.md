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
