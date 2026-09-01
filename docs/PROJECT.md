# Seismic Atlas — Project North Star

## What this is
Name: Seismic Atlas.
An interactive geospatial demo for an Upwork portfolio piece. A live map
of recent earthquakes that a prospective client can look at and immediately
understand: "this person can build real geospatial tools."

## Stack
- Next.js (App Router) + TypeScript
- Mapbox GL JS
- papaparse (CSV), @turf/turf (geo math), @mapbox/mapbox-gl-draw (polygon UI)
- Deployed on Vercel

## Data source
USGS Earthquake Hazards Program, M4.5+ past-month feed. Free, no API key.
- CSV:     https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.csv
- GeoJSON: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson
Fields of interest: time, latitude, longitude, depth, mag, place.
CSV feed is cached ~5 min, GeoJSON ~1 min — genuinely near-live.

## Feature roadmap
- Phase 0: Scaffold + docs + blank deploy
- Phase 1: Map + preloaded sample CSV plotted as points (magnitude-scaled,
  depth-colored, click popups)
- Phase 2: Heatmap toggle + stats bar
- Phase 3: CSV upload with validation + column mapping
- Phase 4: Polygon-draw filter with live count of points inside
- Phase 5 (stretch): Live-refresh mode + magnitude pulse animation

## Design principle
Clean data-viz, not disaster theatrics. Magnitude → radius, depth → color,
recent → brief pulse. Restraint is the portfolio signal.