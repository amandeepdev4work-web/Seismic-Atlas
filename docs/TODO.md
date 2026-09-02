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
- [ ] Phase 5 — Live refresh + magnitude pulse (stretch)

## Manual steps (human, not Claude Code)
- [x] Create Mapbox account, get public token
- [x] git init + push to GitHub
- [x] Import to Vercel, set NEXT_PUBLIC_MAPBOX_TOKEN in env settings
- [x] Restrict Mapbox token to the Vercel domain before sharing the URL

## Carried into Phase 5
- Eyeball the map in a browser. Still never machine-verified, and there is now
  more of it again: a draw tool, a selection panel, a ring layer and a custom
  Draw theme on top of Phase 3's controls, legend and second data path.
  STATE.md lists what to click, in order, and what each step should show. The
  heatmap prediction from Phase 2 is still unchecked too - it lists the
  expected colour per region and which stops to nudge.
- Refresh `public/sample-quakes.csv` before showing the demo; it is a
  point-in-time snapshot of a rolling one-month feed. The current snapshot
  reads 619 events, max M7.8 near Ende, Indonesia, depths 0-645 km. Note the
  headless region counts in STATE.md go stale with it.
- Corner budget, still the binding constraint. The right-hand stack now holds
  four things (toggle, selection panel, data panel, and the mapper when it is
  open) and the left holds two. Phase 5's live-refresh control should extend an
  existing panel rather than add a fifth - the data panel already names where
  the data came from, which is where "and it refreshed 40 seconds ago" belongs.
  The bottom corners are still Mapbox's logo and attribution.
- Two constants now mirror `QUAKE_CIRCLE_LAYER`'s paint rather than deriving
  from it, by choice (D20, D25): `MAGNITUDE_LEGEND_STOPS` and the selection
  ring's radii, which are the circle radii plus 2.5px. If Phase 5's pulse
  animation touches `circle-radius`, both have to move with it.
- The custom Select (D23) is still the one piece of UI carrying keyboard
  behaviour that no test covers, by choice (D9). If Phase 5 adds another
  dropdown, reuse `components/Select.tsx` rather than reaching for a native one
  - the native option list is unreadable on this dark UI on Windows Chrome.
- A pulse animation (Phase 5) and the selection ring both draw around a quake's
  circle. Check they do not read as the same thing; the ring is neutral white
  and static, so a warm or moving pulse should stay distinguishable, but this
  has never been seen either.

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