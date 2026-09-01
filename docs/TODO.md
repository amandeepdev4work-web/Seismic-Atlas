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
- [ ] Phase 3 — CSV upload (validation + column mapping)
- [ ] Phase 4 — Polygon-draw filter with live count-inside
- [ ] Phase 5 — Live refresh + magnitude pulse (stretch)

## Manual steps (human, not Claude Code)
- [x] Create Mapbox account, get public token
- [x] git init + push to GitHub
- [x] Import to Vercel, set NEXT_PUBLIC_MAPBOX_TOKEN in env settings
- [x] Restrict Mapbox token to the Vercel domain before sharing the URL

## Carried into Phase 3
- Eyeball the map in a browser. Still never machine-verified. The heatmap is
  now fitted against a shader model rather than guessed, which narrows the
  risk but does not remove it - modelled is not seen. STATE.md lists the
  predicted colour of each region, so the render can be checked against a
  specific expectation rather than a vibe, plus which stops to nudge.
- Add a legend for the size (magnitude) and colour (depth) encodings. Was on
  the Phase 2 wish list, not in the Phase 2 brief, so it was not built.
  Colour now carries two meanings across the toggle (D13), which makes the
  legend more useful than it was.
- Refresh `public/sample-quakes.csv` before showing the demo; it is a
  point-in-time snapshot of a rolling one-month feed. The current snapshot
  reads 619 events, max M7.8 near Ende, Indonesia, depths 0-645 km.

## Project config notes
- ESLint intentionally omitted (portfolio demo; revisit if desired)
- Vitest runs in the node environment only — see DECISIONS D9
- agentRules: false in next.config.ts — AGENTS.md/CLAUDE.md disabled + removed