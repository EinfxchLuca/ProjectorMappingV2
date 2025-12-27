# Projector Mapping — Static Web App

This project is a static, client-side projector mapping tool built with HTML/CSS/JS. It aims to be deployable as a static site (no backend) and provides basic mapping features: shapes, vertex dragging, corner-pin warping (via triangle subdivision), image/video assignment, layers, properties and export/import.

Open `index.html` in a browser (or deploy to static hosting like Render/GitHub Pages).

Features implemented in this scaffold:
- Canvas mapping area with dark UI
- Create shapes (rect/triangle/polygon) and drag vertices
- Drag & drop images/videos onto shapes
- Play/pause video globally
- Layers list with visibility and reorder
- Properties: opacity, rotation, scale
- Export/Import shape metadata (JSON)
- Fullscreen / Beamer mode with cursor hide

This is a starting, single-file implementation. See inline comments in `app.js` for important implementation details.
