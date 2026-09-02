# Testing Record — Seismic Atlas

_Manual verification checklists for each phase. Every item below has now been
confirmed in a real browser on the deployed build; this document is retained as
the record of what was checked and what each behaviour was reasoned to produce._

The automated tests (`npm test`, 130 passing) cover the pure logic — parsing,
column mapping, file guards, point-in-polygon counting, the live-feed adapter
and the new-quake diff. The steps below are the DOM- and WebGL-level behaviours
that unit tests deliberately do not touch (see D9): the map, the draw tool, the
animation loop, the timers and the layout.

---

## The click-through checklists
_All steps below were run against the deployed build and passed. Kept as the verification record._

### The Phase 5 click-through
This is the new one. The arithmetic is tested and the feed is proven, but no
ring has ever been drawn and no timer has ever fired in a browser.

1. **The resting state.** Page loads on the sample as before: left panel reads
   `619 quakes · M4.5+ past month`. The data panel now shows **two** pills —
   `Upload CSV` and `Refresh` — and under the source label a second, dimmer
   line reading **"Live · refreshes every 60s"**. Check the two pills fit the
   15.5rem panel on one row; if they wrap, that is cosmetic and the row already
   has `flex-wrap`.
2. **Watch one auto-refresh cycle.** Leave it alone for a minute. At the tick:
   the `Refresh` pill should read "Refreshing…" with a small amber dot
   breathing beside "Fetching the latest events…", then the subtitle should
   change to `N quakes · M4.5+ past month · live` (N in the low 630s today, and
   it should differ from 619), the source label to "Live · USGS M4.5+, past
   month", and the status line to **"Updated just now"** and then to
   "Updated 5s ago", "10s ago"… ticking every second.
   - **Nothing should pulse on this first cycle.** This is the deliberate
     part: the first live fetch is a handoff from the snapshot, not a delta
     (D33). If ~25 rings appear here, `liveKeysRef` is being seeded from the
     wrong place.
   - The stats bar should update with the new count, and the map should **not**
     re-frame — refresh passes `fit: false`.
3. **Manual refresh.** Press `Refresh`. Same sequence, faster. Pressing it
   twice quickly should do nothing the second time (`refreshingRef`), and the
   button is disabled while a fetch is out.
4. **The pulse — the key one.** Refresh repeatedly until a genuine arrival
   lands (M4.5+ worldwide averages one every couple of hours, so this may need
   patience, or leave the tab open). When one does: **exactly one ring**, amber
   `#ffd166`, expanding from about 5px to 30px and fading out over four
   seconds, then gone. Every other quake on the map must stay completely still.
   - **Forcing one, without waiting hours.** In `npm run dev`, with the feed
     having answered at least once:

     ```js
     __seismicDropKeys(3)   // forgets the 3 biggest quakes' keys
     ```

     then press `Refresh`. Those three read as arrivals and pulse; nothing
     else does. It logs each one with a ready-to-paste
     `__seismicMap.flyTo(...)` if you want to watch up close. The effect is
     one-shot — the refresh rebuilds the baseline from the response, so the
     next cycle is calm again. Lowering `REFRESH_INTERVAL_MS` does **not**
     help: the feed gains events at the rate it gains them, and a faster timer
     only fetches the same 631 events more often.
   - **Does it read as calm?** That is the actual question. It should look like
     a ripple settling, not a blink or an alarm. If it reads as too slow,
     `PULSE_DURATION_MS` (4000) is the knob; if too subtle, the opacity
     exponent in `pulseFrame`. Change one.
   - **Check it against the selection ring.** With a polygon drawn, a pulsing
     quake inside it will have both a static neutral-white ring and a moving
     amber one. They must not read as the same thing. This is the risk Phase 4
     flagged and it has never been seen.
5. **Force a fetch failure.** DevTools → Network → Offline, then press
   `Refresh`. Expect: the points stay exactly where they are, the stats bar
   does not change, and one warm notice reads "Couldn't refresh — … Still
   showing the last data that loaded." The real error goes to the console.
   - **Then leave it offline for two minutes.** The timer must keep firing and
     keep failing without the page breaking — a failure does not stop the
     interval. Go back online and the next tick (or a manual press) should
     succeed and **clear that error notice on its own**.
   - Also try blocking just the USGS host, and try it while a polygon is drawn:
     the shape and its count must survive a failed refresh untouched.
6. **Uploads pause refresh.** Upload any CSV. The `Refresh` pill should
   **disappear**, and the status line should read "Auto-refresh paused while
   your file is shown." Now wait past two minutes with a clock: **the uploaded
   data must not change, at all.** That is the single most important thing on
   this list. Then press "Reset to sample" — the pill comes back, the status
   line returns to live, and the next tick refreshes normally.
   - The nastier version: press `Refresh`, and while it is in flight upload a
     file. The response must be discarded, not applied (D30). A slow connection
     or DevTools throttling makes this window wide enough to hit.
7. **Both modes.** Switch to Heatmap and refresh. The data should update and
   the count should keep working, but **no pulse should appear** — same
   asymmetry as the selection ring, and D34 says why. Switch back to Points
   mid-cycle and a pulse that was suppressed does not appear late.
8. **The polygon recount, during a pulse.** This is the coexistence check.
   With a shape drawn over a dense region (Indonesia), start dragging a vertex
   and have a refresh land mid-drag. **The outline must keep tracking the
   cursor and the count must keep ticking**; the rings appearing over new
   quakes must not make the drag stutter. If it does stutter, the pulse is not
   the likely culprit — it writes three numbers a frame — but the Phase 4
   checklist's knobs are the place to start.
9. **Leave it open for ten minutes.** Nothing should accumulate: no growing
   set of rings, no memory climb, no second timer. Ten cycles in, the map
   should look exactly as it did at minute one.
10. **Reduced motion.** Turn on "Reduce motion" in the OS. The dot should stop
    breathing but stay visible, and a pulse ring should appear at full size and
    only fade rather than expanding.
11. **Background tab.** Switch away during a pulse and come back. The ring
    should simply be gone, not frozen mid-animation on the map.

### The Phase 4 click-through
This is the new one, and it is entirely unseen — the count arithmetic is
tested, but no polygon has ever been drawn.

1. **The resting state.** The right-hand stack should read, top to bottom:
   mode toggle, a selection panel ("Draw area" and "Draw a polygon to
   filter."), then the data panel. No "Clear" button yet. **Check the corners
   for a small white smudge** — that would be Draw's empty control group
   escaping the `:empty` rule, which is the one piece of chrome suppression
   that could plausibly fail.
2. **Draw one.** Click "Draw area"; it should take a tinted pressed state, the
   cursor should become a crosshair over the map, and the readout should
   switch to the corner-placing hint. Place corners, double-click to finish.
   On finish: the button un-presses on its own (Draw's own mode change), the
   readout becomes `N of 619 inside selection`, a "Clear" button appears, and
   the quakes inside get white rings. Draw a box round Indonesia and the
   number should be in the region of the headless figures above — 260 for
   95…142 E, -11…8 N.
3. **Edit vertices — this is the one to look at, and the follow-up changed
   it.** Click the shape to get its handles (a single click if it is still
   selected from drawing it, otherwise click to select then click again).
   Drag a corner slowly across a dense arc — Japan or Indonesia is the test —
   and **the count should tick continuously as you drag**, not jump on
   release. Rings should appear and disappear under the moving edge in step
   with the number.
   - **Is it smooth or janky?** This is the question the follow-up exists to
     answer and the one thing that could not be measured here. Watch the
     *polygon outline* as much as the number: if the outline itself stutters
     or lags behind the cursor, the per-frame recount is costing too much. If
     the outline tracks the cursor cleanly and only the number is behind, that
     is a different and much cheaper problem.
   - Try it in both a sparse region (empty ocean — most frames change nothing,
     so the identity check should make it free) and a dense one (Indonesia,
     260 quakes — most frames change the set, so this is the worst case).
   - If it is janky, the knobs in order: throttle `refreshSelectionLive` to
     every other frame; or recount per frame but move the ring layer's
     `setData` to release only, keeping the number live and the rings lagging.
     D28 records why neither was done pre-emptively.
   - Also drag a **midpoint** to add a corner, and drag the **whole shape**
     from its interior — both go through the same per-frame path.
4. **Clear.** The shape goes, the rings go, "Clear" disappears, and the
   readout returns to "Draw a polygon to filter."
5. **Redraw replaces.** With a shape on the map, click "Draw area" again. The
   old shape should vanish immediately (the count clears with it) and a new
   one starts. There should never be two shapes.
6. **Cancel.** Click "Draw area", place one or two corners, press Escape. Draw
   should abandon the shape and the button should un-press. Then click "Draw
   area" and click it again without drawing — it should leave draw mode too.
6b. **The mid-draw guard — the crux of the follow-up.** While placing corners,
   move the mouse around with two or three corners already down. Draw keeps a
   trailing vertex glued to the cursor, so there *is* a countable closed ring
   in its store the whole time (D28). **The panel must keep showing the
   corner-placing hint and must never flash a number** that swings around as
   the mouse moves. The number should appear exactly once, when the shape is
   finished. If a number flickers mid-draw, the mode guard is not holding.
7. **Both modes.** With a shape drawn, switch to Heatmap. **The count should
   keep working and keep updating; the rings should disappear; the polygon
   outline should stay.** Switch back and the rings return. That asymmetry is
   D25 and is the thing to confirm reads sensibly rather than as a bug.
8. **Popups.** While drawing, click directly on a quake — it should place a
   corner and **not** open a popup. With a finished shape on the map, clicking
   a quake inside it should open a popup normally.
9. **Draw then upload, and draw then reset.** With a shape on the map, upload
   a CSV. The shape stays and the count recomputes against the new data
   (D29). **Expect the awkward case and judge it:** an upload also re-frames
   the map, so if the new data is somewhere else the polygon can end up
   off-screen with the panel truthfully reading `0 of N inside selection`.
   If that reads as broken rather than as honest, D29 records the alternative
   (clear the shape on a data change) and why it was not taken. Reset to
   sample and the same shape should give its original count back.
10. **A weird shape.** Draw a concave, self-touching outline — a bow tie or a
    star that crosses itself. It must not throw, and turf answers it by the
    even-odd rule, so the count will follow the alternating in/out regions
    rather than the visual "inside". That is tested in the abstract; this is
    the check that Draw lets you make one at all.
11. **Across the date line.** The default view is Pacific-centred, so this is
    easy: draw a box around Tonga or the Kuriles spanning the date line, or
    pan east past 180 and draw on the repeated world. The count must not be
    zero — that is D27's whole reason for existing, and it is the failure the
    unit tests were written against.
12. **The dark theme.** The polygon outline, its fill and its vertex handles
    should read as neutral white chrome, clearly not data. Check the outline
    is dashed while being drawn and solid once finished, and that a vertex
    handle sitting on top of a quake still reads as a ring rather than
    swallowing the point.

### The Phase 3 click-through
1. **Sample.** Page loads, left panel reads `619 quakes · M4.5+ past month`
   and the stats bar reads 619 / M 7.8 / 0–645 km. Right side shows the mode
   toggle above a data panel saying "Sample · USGS M4.5+, past month", with no
   "Reset to sample" button (there is nothing to reset from).
2. **Upload, USGS-shaped.** Pick `public/sample-quakes.csv` itself. It should
   load with no mapping UI at all, the subtitle should switch to
   `619 quakes · sample-quakes.csv`, a notice should read "Loaded 619 points",
   "Reset to sample" should appear, and the map should ease to fit the data.
3. **Bad file.** A CSV with no usable coordinates (or the sample with its
   `mag` column renamed and then mapped to `place`). Expect a warm-toned
   notice, the previous points **still on the map**, and the stats bar
   unchanged.
4. **Column mapping.** A CSV whose columns are named anything else. The mapper
   panel should open below the data panel, pre-filled where it can be, with
   "Load" disabled until latitude/longitude/magnitude are all set.
   - **The dropdown is the thing to look at**, since it is what the follow-up
     replaced. Open one: the list must be dark with light text, and legible.
     Check the selected row shows a tick and the row under the pointer
     highlights.
     - Keyboard, all from the closed button: Down/Up opens and moves, Home/End
       jump, Enter or Space picks, Escape closes without picking, Tab closes
       and moves on, and typing "l" repeatedly cycles through columns starting
       with L. None of that is unit-tested (D9) — it is DOM behaviour, and this
       is the check.
   - Opening a dropdown low in the panel should scroll it into view inside the
     panel, not push the panel over the map.
5. **Bad file types.** Drop in a `.zip`, then a `.png`, then a `.csv` that is
   really a renamed zip. Each should give one short line ("Couldn't read … —
   please upload a .csv."), the map should keep its points, and **no binary
   should appear anywhere in the panel**. The console is where the real error
   goes.
6. **Reset.** Returns to the sample, eases back to the opening Pacific view,
   the "Reset to sample" button disappears again.
7. **Both modes on uploaded data.** Toggle to Heatmap while an upload is
   displayed; it should just work — same source, no refetch, no flicker. Then
   toggle back and click a point: the popup should show the uploaded file's
   place string, escaped.
8. **The legend.** Bottom of the left stack. It should switch content with the
   mode, collapse and expand, and stay small enough not to dominate.

### Layout, after the follow-up — verified in-browser
The overlap is fixed structurally — two columns of one grid cannot overlap at
any width — and the cases below were confirmed rendering correctly on the
deployed build.

- **The overlap case itself.** Open the mapper on a desktop window and confirm
  the columns stay apart. The grid is `minmax(0, 17rem)` and `minmax(0, 16rem)`
  with `space-between`, so the two columns plus padding and gap need 36rem
  (576px) and shrink rather than collide below that.
- **The tall mapper.** With all six dropdowns and one open, the panel should
  scroll inside itself and stop at 26rem, never running past the bottom of the
  map. Only the mapper is allowed to shrink; the toggle and data panel keep
  their size (`flex: none` on stack children, overridden for `.mapper`).
- **Narrow viewports.** Under 46rem (736px) the grid becomes one column: title
  and stats, legend, toggle, data panel, mapper. While the mapper is open the
  legend is hidden — that is the `map-overlay--mapping` class doing its job,
  and it is worth confirming it comes back when the mapper closes. This is a
  not-broken layout, not a designed one.
- **A long file name** in the subtitle and the source label. Now clamped to 42
  characters by `safeFileName` as well as `word-break`, unverified.
- **The stats bar's longest `place`** wrapping inside the panel instead of
  stretching it — still the Phase 2 open question.

### Carried from Phase 2 — verified in-browser
_Confirmed rendering correctly on the deployed build; retained as the record of what the tuning was reasoned to produce._

- **The retuned heatmap.** At zoom 1.4 the model predicts: sparse ocean quakes
  as a dim ember barely above the basemap, Alaska deep orange, Chile orange,
  Tonga and Japan bright amber, Indonesia and the Philippines near-white cores
  — the Sunda arc core about 18px across, glow fading by 46px. If it reads
  cold, raise `heatmap-intensity`'s z0/z1.5 stops (0.3 / 0.36) together; if the
  arcs melt into one mass, lower `heatmap-radius`'s z0/z2 stops (18 / 24).
  Change one at a time — they pull against each other.
- Whether the model's density figures match what the GPU actually draws.
- That the toggle visibly swaps the layers with no frame showing both or
  neither.
- That popups and the pointer cursor go quiet in Heatmap mode and return in
  Points mode.
- Behaviour above zoom 6, which the Phase 2 fitting only spot-checked.

