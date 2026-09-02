# TODO (ordered)

- [x] Phase 0 — Scaffold, deps, docs, blank page (verified: build + typecheck + dev clean)
- [x] Phase 0b — Deploy pipeline proven (Vercel green: https://seismic-atlas-five.vercel.app/)
- [x] Phase 1 — Map + preloaded CSV plotted (magnitude/depth styling, popups)
      (verified: 6 Vitest tests + typecheck + build clean; 619/619 sample rows parse)
- [x] Phase 1 fix — popup was pale-on-white; CSS import order and override
      specificity both corrected (DECISIONS D10/D11)
- [x] Phase 2 — Heatmap toggle + stats bar
      (verified: 13 Vitest tests + typecheck + build clean; heatmap and
      toggle CSS confirmed present in the built bundle. The rendered
      heatmap itself is unverified - see STATE.md "Needs a human eyeball")
- [x] Phase 2 fix - heatmap read as blue dots plus two hard-edged discs; all
      heatmap paint values refitted against a model of Mapbox's shader
      (DECISIONS D15, superseding D13). The reported "circle layer not
      hiding" was investigated and is not a bug - the discs were the heatmap
      itself saturating at a 7.8px radius.
- [x] Phase 3 — CSV upload (validation + column mapping) + legend
      (verified: 36 Vitest tests + typecheck + build clean; the upload path was
      run headlessly over the real sample and over a renamed-column copy of it,
      and the new controls are confirmed present in the built CSS and JS
      chunks. Nothing that needs a browser has been seen - see STATE.md)
- [x] Phase 3 fix - three bugs from browser testing: a .zip was read and its
      decoded bytes echoed into the error notice; the native select option list
      rendered light and unreadable on Windows Chrome; and the two overlay
      stacks overlapped when the mapping panel was open. Fixed with a two-stage
      file guard plus clamping of every file-derived string (D22), a hand-rolled
      dark listbox (D23), and one overlay grid whose columns cannot overlap,
      with a narrow-width rule (D24). Verified: 64 Vitest tests + typecheck +
      build clean, and every notice the upload path can produce was printed and
      inspected against a real zip - none carried binary or ran long.
- [x] Phase 4 — Polygon-draw filter with live count-inside
      (verified: 89 Vitest tests + typecheck + build clean, 25 of them over the
      new pure `lib/geo.ts`. The count was run headlessly over the real 619-row
      sample — Indonesia 260, Japan/Kuril 39, Chile 20, Alaska 9, whole world
      619 — and the date-line case checked both ways round: the Tonga cluster
      counts 39 whether the box is drawn as 176..190 or as -184..-170 (D27).
      A recount is ~0.2 ms, worst case 0.18 ms amortised over 100 runs. The new
      controls, the draw theme and Draw's cursor CSS are all confirmed present
      in the built chunks. Nothing that needs a browser has been seen — see
      STATE.md)
- [x] Phase 4 follow-up - the count now updates per frame while a vertex or the
      whole shape is dragged, not only on release. `draw.render` wired
      alongside the three edge events, guarded on Draw's mode. The guard has to
      be the mode and cannot be geometric: Draw closes every ring on the way
      out of `getCoordinates`, so a half-drawn shape is indistinguishable from
      a finished one by inspection - D28 is revised, and records that the
      original entry got that reason wrong. `lib/geo.ts` and its 25 tests are
      byte-identical; only the call site moved. Un-throttled by design (Draw
      already deduplicates its render event to one per animation frame, and the
      settled modes skip the render on a plain mouse move), with the ring
      `setData` and the panel `setState` skipped on frames where the inside set
      did not change. Verified: 89 tests + typecheck + build clean. **Whether
      the drag actually feels smooth is unmeasurable here and is the one thing
      still to eyeball** - STATE.md step 3 says what to watch and which knob to
      turn first if it stutters.
- [x] Phase 5 — Live refresh + arrival pulse (stretch)
      (verified: 130 Vitest tests + typecheck + build clean, 41 of them over the
      new pure `lib/live.ts`. **This environment turned out to have network
      access**, so the central claims were checked against the real USGS feed
      rather than fixtures: it answers 200 with `Access-Control-Allow-Origin: *`;
      the adapter kept 631 of 631 features with 0 skips in 2.7 ms; and the
      identity key matched **606 of those 631 live events to sample-CSV
      features exactly**, with 25 arrivals since the snapshot and 13 events
      rolled off the month window (D32). Two back-to-back fetches produced
      **zero** spurious deltas, which is the failure that would have mattered
      most. A diff costs 0.35 ms and runs once a minute. The pulse curve was
      sampled rather than guessed — 5px at 0.90α, 30px at 0α, four seconds,
      most of the travel in the first one. `lib/mapbox.ts` is `89 0` and
      `app/globals.css` is `36 0`, so Phases 1/2/4 are provably untouched; the
      eight deletions across `MapView` and `DataPanel` are doc-comment
      rewordings and four `setDataSource` → `applyDataSource` renames. New
      strings confirmed present in both the CSS and JS chunks. **Nothing that
      needs a browser has been seen** — see STATE.md)

## Manual steps (human, not Claude Code)
- [x] Create Mapbox account, get public token
- [x] git init + push to GitHub
- [x] Import to Vercel, set NEXT_PUBLIC_MAPBOX_TOKEN in env settings
- [x] Restrict Mapbox token to the Vercel domain before sharing the URL

## Carried past Phase 5 — the roadmap is done, these are not
- **Eyeball the map in a browser.** Still never machine-verified, and there is
  now more of it again: a refresh control, a status line that ticks, a timer, a
  fifth layer and an animation loop, on top of Phase 4's draw tool and Phase
  3's controls, legend and second data path. STATE.md lists what to click, in
  order, and what each step should show. The heatmap prediction from Phase 2 is
  still unchecked too - it lists the expected colour per region and which stops
  to nudge.
- **Refresh `public/sample-quakes.csv` before showing the demo.** It matters
  more now than it did: the snapshot is what the page opens on, and the live
  feed replaces it a minute later, so a stale snapshot makes that first
  transition a visible jump in the count. Today the snapshot reads 619 events
  and the live feed reads 631, of which 606 are the same events (D32). It is a
  point-in-time copy of a rolling one-month feed - re-download it from
  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.csv and
  note that the headless region counts in STATE.md go stale with it.
- **Corner budget, still the binding constraint** and now fully spent. The
  right-hand stack holds four things (toggle, selection panel, data panel, and
  the mapper when it is open) and the left holds two. Phase 5 honoured the
  guardrail - the refresh control extended the data panel rather than claiming
  a fifth slot (D31). Anything new has to extend a panel too, or something has
  to leave. The bottom corners are still Mapbox's logo and attribution.
- **Two constants still mirror `QUAKE_CIRCLE_LAYER`'s paint rather than
  deriving from it**, by choice (D20, D25): `MAGNITUDE_LEGEND_STOPS` and the
  selection ring's radii, which are the circle radii plus 2.5px. Phase 5
  deliberately stayed out of this - the pulse ring's radius is a flat number,
  not a magnitude interpolation, precisely so it did not become a third thing
  to keep in sync (D34). Anything that *does* touch `circle-radius` still has
  to move both.
- **The custom Select (D23) is still the one piece of UI carrying keyboard
  behaviour that no test covers**, by choice (D9). Reuse
  `components/Select.tsx` rather than reaching for a native one - the native
  option list is unreadable on this dark UI on Windows Chrome.
- **The pulse and the selection ring both draw around a quake's circle**, and
  whether they read as two different things has still never been seen. The
  ring is neutral white and static; the pulse is amber and moving, which should
  be enough. STATE.md's Phase 5 step 4 says how to get both on screen at once.
- **The `time` string is now load-bearing.** It was cosmetic through Phase 4 -
  popup text, nothing more. It is now half of a quake's identity (D32), so a
  change to how `parseQuakeCsv` or `parseQuakeGeojson` writes it would silently
  break the diff and pulse the whole map. The test that pins this is
  "produces a feature identical to the CSV parser's for the same event".
- **The live feed is a third-party dependency with no key and no SLA.** If USGS
  changes the feed's shape, `parseQuakeGeojson` degrades to "the feed did not
  return a GeoJSON FeatureCollection" and the map keeps the last data it had.
  Worth knowing before a demo; worth re-running the checks in STATE.md's
  Phase 5 "Verified" block if the feed ever looks wrong.

## Done in Phase 5, previously carried
- [x] The live-refresh control extended the data panel rather than claiming a
      fifth slot in the right-hand stack (D31), which is exactly what the
      Phase 4 carry-forward asked for.
- [x] The pulse animation was kept out of `circle-radius`, so
      `MAGNITUDE_LEGEND_STOPS` and the selection ring's radii did **not** have
      to move with it. The pulse ring's radius is a flat 5→30px, deliberately
      not magnitude-scaled (D34).
- [x] No new dropdown, so `components/Select.tsx` was not needed and no native
      `<select>` was reached for.

## Done in Phase 4, previously carried
- [x] Draw controls and the count joined the existing right-hand stack as one
      panel rather than claiming a third corner, and Draw's own button bar was
      suppressed (D26).

## Done in Phase 3, previously carried
- [x] Legend for the size (magnitude) and colour (depth) encodings, switching
      with the mode so the two meanings of colour are stated rather than
      merely mutually exclusive (D20).

## Project config notes
- ESLint intentionally omitted (portfolio demo; revisit if desired)
- Vitest runs in the node environment only — see DECISIONS D9
- agentRules: false in next.config.ts — AGENTS.md/CLAUDE.md disabled + removed