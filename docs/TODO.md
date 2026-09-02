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
- [ ] Phase 4 — Polygon-draw filter with live count-inside
- [ ] Phase 5 — Live refresh + magnitude pulse (stretch)

## Manual steps (human, not Claude Code)
- [x] Create Mapbox account, get public token
- [x] git init + push to GitHub
- [x] Import to Vercel, set NEXT_PUBLIC_MAPBOX_TOKEN in env settings
- [x] Restrict Mapbox token to the Vercel domain before sharing the URL

## Carried into Phase 4
- Eyeball the map in a browser. Still never machine-verified, and there is now
  more of it: three new controls, a legend, and a whole second data path.
  STATE.md lists what to click, in order, and what each step should show. The
  heatmap prediction from Phase 2 is still unchecked too - it lists the
  expected colour per region and which stops to nudge.
- Refresh `public/sample-quakes.csv` before showing the demo; it is a
  point-in-time snapshot of a rolling one-month feed. The current snapshot
  reads 619 events, max M7.8 near Ende, Indonesia, depths 0-645 km.
- Corner budget. Phase 3 filled the top-right (toggle, data panel, and the
  mapping panel when it is open) and extended the top-left (info, stats,
  legend). Phase 4 adds draw controls and a count - they should join an
  existing stack rather than claim a third corner, and the bottom corners
  belong to Mapbox's logo and attribution. The overlay is now a two-column
  grid (D24), so a new panel goes into one of the two stacks; adding a third
  absolutely positioned box would reintroduce exactly the overlap that grid
  was adopted to make impossible.
- The custom Select (D23) is the one piece of UI carrying keyboard behaviour
  that no test covers, by choice (D9). If Phase 4 adds another dropdown, reuse
  `components/Select.tsx` rather than reaching for a native one - the native
  option list is unreadable on this dark UI on Windows Chrome.

## Done in Phase 3, previously carried
- [x] Legend for the size (magnitude) and colour (depth) encodings, switching
      with the mode so the two meanings of colour are stated rather than
      merely mutually exclusive (D20).

## Project config notes
- ESLint intentionally omitted (portfolio demo; revisit if desired)
- Vitest runs in the node environment only — see DECISIONS D9
- agentRules: false in next.config.ts — AGENTS.md/CLAUDE.md disabled + removed