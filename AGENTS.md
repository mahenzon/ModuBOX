# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project purpose

ModuBOX Case Configurator is a dependency-free static web application for planning a ModuBOX Wood Case v2 build. It calculates panel dimensions, wood cuts, printed-part and hardware requirements, sheet layouts, and exportable bills of materials. It also provides detailed Three.js and schematic SVG previews.

This repository contains only the configurator. Never add, reproduce, distribute, or link to unauthorized ModuBOX CAD, STL, 3MF, design-source, or fabrication files. Official file packages remain available only from ALCH. Keep that distinction clear in public copy.

## Run and verify

- No install or build step exists.
- Run the full automated suite with `node --test tests/preview.test.js`.
- For manual browser testing, open `index.html` directly or run `python3 -m http.server 8000` from the repository root.
- Keep direct `file://` use working; a local server must not become mandatory.
- After JavaScript, HTML, CSS, catalog, or geometry changes, run the full test file.
- For visible UI changes, also check desktop and narrow mobile layouts, print/PDF output, controls, the open/closed model, drag/orbit behavior, and exports.
- No linter, formatter, package manager, or build command is configured. Do not introduce one unless requested.

## Architecture

- `index.html` owns semantic page structure, workflow order, local stylesheet links, and classic-script load order.
- `assets/js/catalog.js` is the source of truth for supported parameters, formulas, part rules, filenames, hardware, and notes. Browser global: `WOODCASE_CATALOG`.
- `assets/js/core.js` validates configuration, evaluates catalog rules, builds the BOM, formats values, and produces CSV, JSON, and Markdown exports. Browser global: `WOODCASE_CORE`.
- `assets/js/panel-geometry.js` is the sole authority for nominal panel contours, semantic sides, drill-hole centers, per-family base diameters, and diametral clearance. Browser global: `WOODCASE_PANEL_GEOMETRY`.
- `assets/js/preview.js` renders dimensioned 2D views and the schematic SVG fallback model from canonical panel geometry. Browser global: `WOODCASE_PREVIEW`.
- `assets/js/sheet-planner.js` expands wood pieces and calculates compact or cut-through sheet layouts. Browser global: `WOODCASE_SHEET_PLANNER`.
- `assets/js/laser-plan.js` validates the 0.10 mm laser nesting-gap floor and always routes Full DXF work through compact packing. Browser global: `WOODCASE_LASER_PLAN`.
- `assets/js/renderers.js` converts application data into accessible controls, summaries, BOM tables, dimension panels, and sheet-plan markup. Browser global: `WOODCASE_RENDERERS`.
- `assets/js/dxf-writer.js`, `assets/js/dxf-archive.js`, `assets/js/sha256.js`, and `assets/js/dxf-export.js` serialize cut-only AutoCAD R12 (`AC1009`) ASCII DXFs with legacy `POLYLINE` outlines, package deterministic stored ZIPs, hash exported files, group physical sheet layouts, and produce manifests.
- `assets/js/laser-preview.js` renders Full laser layouts from the exact geometry later serialized to DXF.
- `assets/js/drill-markers3d.js` maps canonical holes to generic 3D drill markers without assigning unverified hardware identity.
- `assets/js/app.js` owns browser state, local preferences, DOM events, preview orchestration, downloads, and startup. It combines public module APIs under `WOODCASE_APP`.
- `assets/js/model3d.js` owns the detailed Three.js assembly, geometry, materials, camera interaction, lid animation, and fastener verification. Browser global: `WOODCASE_3D`.
- `assets/vendor/three.min.js` is vendored third-party code. Do not hand-edit it, reformat it, or remove `assets/vendor/THREE-LICENSE.txt`.
- `tests/preview.test.js` is the single Node test entry point and exercises both CommonJS APIs and browser-style classic scripts.

## Browser composition

Preserve this exact dependency order in `index.html`:

1. `assets/js/catalog.js`
2. `assets/js/drill-markers3d.js`
3. `assets/vendor/three.min.js`
4. `assets/js/model3d.js`
5. `assets/js/core.js`
6. `assets/js/panel-geometry.js`
7. `assets/js/preview.js`
8. `assets/js/sheet-planner.js`
9. `assets/js/laser-plan.js`
10. `assets/js/renderers.js`
11. `assets/js/dxf-writer.js`
12. `assets/js/dxf-archive.js`
13. `assets/js/sha256.js`
14. `assets/js/dxf-export.js`
15. `assets/js/laser-preview.js`
16. `assets/js/app.js`

Application files use classic scripts and UMD-style wrappers so they work as browser globals and through Node `require()`. Preserve both paths. Do not convert them to ES modules, add a bundler, use network imports, or depend on a CDN without an explicit request.

Use relative asset paths. GitHub Pages serves the project from the `/ModuBOX/` repository subpath, and `.nojekyll` keeps it a plain static site.

## Domain invariants

- Read supported values and defaults from `catalog.parameters` and `catalog.buildOptions`; do not duplicate them in renderers or HTML.
- Route configuration through `normalizeConfig()` and derived calculations through `buildBom()` or the focused core helpers.
- Keep panel formulas, BOM rows, exports, 2D drawings, dimension callouts, sheet pieces, and the 3D model consistent.
- The usable ModuBOX grid is `55 × 55 mm` per cell and belongs on the inside bottom.
- A 2H case can use the fixed handle or no handle; 3H–6H use the hinged handle. Handle-dependent parts, drilling and hardware follow the selected option.
- Phase-2 drill geometry has six physical roles: front, back, left side, right side, lid, and bottom. All use the outside-face, lower-left, X-right, Y-up frame.
- Preserve each hole family's base diameter. Apply the shared clearance once as a diametral adjustment; do not apply exporter-side laser kerf.
- Full laser export ignores `Cut-through cuts only`, requires at least 0.10 mm nesting gap, and never mirrors completed panels.
- Cutter-ready DXFs contain true circles on `CUT_HOLES_FIRST`, followed by closed outlines on `CUT_OUTLINES_LAST`, with no annotations or stock boundaries.
- The lid rests on the front/back panels and fits between the sides. A transparent lid has independent thickness; it is flush with the side tops only when lid and body thickness match. Group sheet layouts by material and thickness.
- Dedicated screw corners use 20 wood screws including four underneath. Omit corner through-holes in that mode; other attachment holes and machine hardware remain. Keep measured geometry separate from inferred screw-length suggestions.
- Fastener manifests, rendered 3D fasteners, and BOM quantities must agree. `verifyFastenerAssembly()` intentionally fails on mismatches.
- Full orbit includes underside views. Normalize angles; do not reintroduce pitch clamps in either detailed or fallback previews.
- Compact sheet planning may rotate parts when enabled. Cut-through mode must remain guillotine-style, preserve kerf, group matching pieces where possible, and emit valid numbered edge-to-edge cuts.
- Keep saved-preference compatibility in mind. Current storage key is `modubox-wood-case-preferences-v1`, with payload `version: 1`.

## UI and content rules

- Keep workflow order: configure, review, plan materials, export.
- Preserve IDs referenced by `app.js`, `renderers.js`, and tests when changing `index.html`.
- Escape dynamic text with helpers from `core.js` before inserting generated HTML or SVG.
- Maintain keyboard labels, ARIA attributes, live regions, native disclosure behavior, and touch-friendly controls.
- Formula disclosures use hover/focus on fine pointers and native tap behavior on touch devices; preserve both paths.
- Keep responsive behavior in `assets/css/responsive.css`, including print rules. Avoid horizontal page overflow; individual tables and previews may scroll within their containers.
- Keep README language concise and direct. Address the reader as “you” where useful, retain author/product links, and retain the source-file and purchasing disclaimer.

## CSS ownership

- `base.css`: tokens, reset, typography, page shell, panels, and shared controls.
- `preview.css`: summary, model, dimensions, SVG previews, and visual part styles.
- `calculator.css`: export controls, sheet inputs, sheet layouts, and cut-plan presentation.
- `bom.css`: BOM tables and formula disclosures.
- `responsive.css`: breakpoints, mobile adjustments, and print output.

Place new styles in the file matching their responsibility. Reuse existing custom properties before adding new colors or spacing values.

## Code style and size limits

- Follow existing JavaScript: two-space indentation, double quotes, semicolons, trailing commas where valid, early validation, and small focused functions.
- Prefer catalog-driven rules and pure calculation helpers over DOM-dependent logic.
- Keep rendering functions deterministic where possible so Node tests can exercise them with lightweight document stubs.
- Add comments for non-obvious geometry or packing constraints, not for self-evident code.
- Tests enforce per-module maximum line counts; keep the small Phase-2 geometry, laser, writer, archive, and preview adapters within the limits recorded in `tests/preview.test.js`.
- Each CSS file must remain at or below 600 lines.
- Split code by responsibility before exceeding a limit; update script order and composition tests when adding a module.

## Change discipline

- Preserve unrelated user changes.
- Do not commit, push, or change remotes unless explicitly asked.
- Do not add generated exports, coverage output, dependencies, editor settings, or OS files.
- Update tests with behavior changes. Prefer assertions covering all supported configurations for formula or geometry changes.
- Before handoff, run the full test command and report any manual checks that were not performed.
