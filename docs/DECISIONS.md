# Architectural Decisions

## D1 — Points render as a Mapbox GL GeoJSON source + layer, not React markers
Reason: GPU-rendered circle/heatmap layers handle tens of thousands of points smoothly; per-point React markers create DOM nodes and jank at scale. This choice also makes the heatmap toggle nearly free (it's just a second layer type on the same source).

## D2 — GeoJSON FeatureCollection is the single internal data format
Reason: CSV (sample or uploaded) is parsed into GeoJSON immediately. Everything downstream — rendering, heatmap, polygon-count — consumes one
format. No special-casing.

## D3 — Mapbox map instance lives in a ref, never in React state
Reason: it's a large mutable object; putting it in state triggers re-render loops. React owns the UI/panels declaratively; the map is commanded imperatively via map.getSource(id).setData(...).