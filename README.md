# ModuBOX Case Configurator

ModuBOX Case Configurator is a browser-based planning tool for the [ModuBOX Wood Case v2](https://www.alch.shop/modubox/p/wood-case-v2). It turns your chosen case configuration into a practical build plan with:

- Wood panel dimensions and a cut list
- Parametric drill-hole geometry with adjustable diametral clearance
- Required printed parts and hardware
- A wood-sheet layout
- Cut-only DXF exports for laser/CAD software

An interactive 3D preview helps you understand the finished case before building it.

You can also use a solid transparent lid (e.g. acrylic, polycarbonate) and a thin lip to fit label.

## DXF exports

**DXF — Full** downloads one cut-only DXF per unique physical sheet layout plus a
manifest. Repeated identical layouts are grouped with configuration-rich names,
such as `sheet-01-6W-5D-4H-6mm-xN.dxf`. Full laser packing uses the calculator's
case count, sheet size, nesting gap, and rotation setting, but ignores
**Cut-through cuts only**, which is reserved for saw/guillotine layouts. The nesting
gap must be at least 0.10 mm; that minimum is a validation floor, not a universal
safe value for every machine and CAM setup.

**DXF — All separate** uses names such as `front-6W-5D-4H-6mm-xN.dxf`,
`back-6W-5D-4H-6mm-xN.dxf`, `sides-6W-5D-4H-6mm-x2N.dxf`,
`lid-6W-5D-4H-6mm-xN.dxf`, and `bottom-6W-5D-4H-6mm-xN.dxf`, plus a
manifest.

DXFs use the broadly compatible AutoCAD R12 (`AC1009`) ASCII format, including
legacy `POLYLINE` outlines accepted by CorelDRAW. Coordinates are authored in
millimeters in an outside-face, lower-left coordinate frame. R12 does not reliably
carry modern insertion-unit metadata, so choose **millimeters** if your importer
asks for units. True hole circles are on `CUT_HOLES_FIRST`, and closed nominal
panel outlines are on `CUT_OUTLINES_LAST`. Every physical DXF contains cut
geometry only, with all holes serialized before outlines. The hole control adjusts
each feature's base diameter once; the exporter applies no beam-kerf compensation
to holes or outlines. Configure actual laser kerf in CAM.

The project exists to make customizing and planning a ModuBOX case simpler, clearer, and less error-prone. Everything runs locally in the browser as a static site, so you can use the configurator without uploading measurements or installing specialized software.

The ModuBOX system was created by [Alexandre Chappel](https://www.youtube.com/@achappel) and is sold at [alch.shop](https://www.alch.shop).

## Source files and purchasing

This website is a planning tool only. Its generated parametric DXFs are not official
ModuBOX CAD or fabrication source files. It does **not** sell, resell, distribute,
share, or provide downloads of:

- ModuBOX source or CAD files
- STL or 3MF files
- Any other official fabrication source files

You can obtain the official files required for a build only by purchasing the applicable file package directly from [ALCH](https://www.alch.shop), such as [ModuBOX Wood Case v2](https://www.alch.shop/modubox/p/wood-case-v2). This project does not replace that purchase or grant access to any files included with it.

Open the configurator on [GitHub Pages](https://mahenzon.github.io/ModuBOX/).
