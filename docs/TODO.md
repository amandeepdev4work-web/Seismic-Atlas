# TODO (ordered)

- [x] Phase 0 — Scaffold, deps, docs, blank page (verified: build + typecheck + dev clean)
- [x] Phase 0b — Deploy pipeline proven (Vercel green: https://seismic-atlas-five.vercel.app/)
- [x] Phase 1 — Map + preloaded CSV plotted (magnitude/depth styling, popups)
      (verified: 6 Vitest tests + typecheck + build clean; 619/619 sample rows parse)
- [x] Phase 1 fix — popup was pale-on-white; CSS import order and override
      specificity both corrected (DECISIONS D10/D11)
- [ ] Phase 2 — Heatmap toggle + stats bar
- [ ] Phase 3 — CSV upload (validation + column mapping)
- [ ] Phase 4 — Polygon-draw filter with live count-inside
- [ ] Phase 5 — Live refresh + magnitude pulse (stretch)

## Manual steps (human, not Claude Code)
- [x] Create Mapbox account, get public token
- [x] git init + push to GitHub
- [x] Import to Vercel, set NEXT_PUBLIC_MAPBOX_TOKEN in env settings
- [x] Restrict Mapbox token to the Vercel domain before sharing the URL

## Carried into Phase 2
- Add a legend for the size (magnitude) and colour (depth) encodings
- Eyeball the map in a browser — WebGL rendering was never machine-verified
- Refresh `public/sample-quakes.csv` before showing the demo; it is a
  point-in-time snapshot of a rolling one-month feed

## Project config notes
- ESLint intentionally omitted (portfolio demo; revisit if desired)
- Vitest runs in the node environment only — see DECISIONS D9
- agentRules: false in next.config.ts — AGENTS.md/CLAUDE.md disabled + removed