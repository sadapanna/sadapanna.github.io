# Sadapanna Geometry

An ultra-simple dynamic geometry canvas for *feeling* geometry: construct with a
few tools, then drag anything — every dependent object (midpoints, bisectors,
intersections, circles, angles) updates live.

## Run it

Open `index.html` directly in a browser (works from disk, fully offline), or host
the folder anywhere static (e.g. under sadapanna.github.io). When served over
http(s), a service worker caches everything so it keeps working offline after the
first load.

## How it's designed (from research on GeoGebra, Desmos, Sketchometry, Euclidea…)

- **5 tools only** (Move, Point, Line, Circle, Shape). All constructions —
  midpoint, divide-into-n, perpendicular bisector, perpendicular/parallel through
  a point, intersection, angle, angle bisector, circle through 3 points — appear
  as **context actions** when you select the relevant objects with Move
  (shift-click to multi-select).
- **Named snap previews**: before you click, the app shows *what* you'd attach to
  ("Midpoint", "1/3 point", "Intersection of …"), so points are never silently
  free-floating or silently glued.
- **n-section detents**: hovering along a segment snaps to 1/2, 1/3, 2/3, 1/4 … —
  or select a segment and use "÷n Divide".
- **Visible dependencies**: hover any object to glow its parents.
- **Shift-drag from a point** rubber-bands a size, then a small menu picks the
  shape: circle or a regular n-gon (△ ◻ ⬠ ⬡ or type n) whose vertices are live
  dependent points. **Shift-drag on empty canvas** rectangle-selects; context
  actions work on mixed selections (e.g. 4+ points → "Shape from points").
  The on-screen **⇧ Shift** button (bottom-left) is a sticky Shift — one tap
  and every click/drag behaves shifted, which also makes all of this work on touch.
- **Angle snapping**: drawing a line snaps to 0°/45°/90° and to ⊥ / ∥ of any
  line on screen — the tag names it ("⊥ to TU") and that line glows. Finishing
  on a ⊥/∥ snap creates a **linked** relation (the endpoint rides a hidden
  guide line), so it stays perpendicular/parallel when anything moves.
- **🔗 Unlink**: select any derived object (linked ⊥/∥, midpoint, intersection,
  glider, derived circle…) to break its dependency — it keeps its current
  geometry and becomes independent. A selected point on a line offers **⊥ here**
  directly. Dragging a free point snaps to grid crossings; circle radii snap to
  half-unit values (labeled "r = 2.5") while creating.
- **Graphs**: the ƒ Graph tool plots y = f(x) (`x^2/4`, `sin(x)*2`, …) on
  numbered axes. Points snap onto the curve, and graphs intersect with lines
  and other graphs — so a portion of a graph can be turned into a shape.
- **📏 measurements**: toggleable live sizes — segment lengths and circle radii
  in grid units, updating while you drag.
- **Movable, resizable toolbar**: drag the ⠿ grip anywhere; drag the right-edge
  handle to narrow it and the tools re-wrap into rows (double-click resets).
- **Esc** cancels a half-finished construction (and rolls back its temp points).
- **Undo/redo** is per click (each placed point is one step), never pan/zoom.
- Files auto-save to localStorage (☰ panel), plus JSON export/import. Deleting
  the file you have open also clears the canvas.
- First run opens a live **circumcircle demo** (the classic: drag a vertex,
  watch the ⊥ bisectors, center and circle follow); **?** opens a short guide.

## The classic demo

Point tool: tap 3 points → Move: select all 3 → "Triangle" → click a side →
"⊥ bisector" (twice, for two sides) → select both bisectors → "Intersect" →
select the new center + a vertex → "Circle" — now drag any vertex: the
bisectors, center, and circumcircle follow, butter smooth.

## Code

- `engine.js` — pure math + construction DAG (free vs derived objects,
  topological recompute, validity flags for degenerate cases, branch-continuity
  for intersections).
- `app.js` — canvas rendering, snapping, tools, selection/context actions,
  undo, files.
- `storage.js` — localStorage persistence. `sw.js` — offline cache.
