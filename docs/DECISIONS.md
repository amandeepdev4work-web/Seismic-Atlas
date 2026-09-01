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
