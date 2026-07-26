(function (root, factory) {
  const dxfWriter = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = dxfWriter;
  } else {
    root.WOODCASE_DXF_WRITER = dxfWriter;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOLES_LAYER = "CUT_HOLES_FIRST";
  const OUTLINES_LAYER = "CUT_OUTLINES_LAST";
  const DXF_MIME_TYPE = "application/dxf";

  function formatNumber(value) {
    const rounded = Math.round(Number(value) * 1000000) / 1000000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function addPair(lines, code, value) {
    lines.push(String(code), String(value));
  }

  function addLayer(lines, name, color, handle) {
    addPair(lines, 0, "LAYER");
    addPair(lines, 5, handle);
    addPair(lines, 330, "3");
    addPair(lines, 100, "AcDbSymbolTableRecord");
    addPair(lines, 100, "AcDbLayerTableRecord");
    addPair(lines, 2, name);
    addPair(lines, 70, 0);
    addPair(lines, 62, color);
    addPair(lines, 6, "CONTINUOUS");
    addPair(lines, 290, 1);
  }

  function formatHandle(value) {
    return Number(value).toString(16).toUpperCase();
  }

  function addCircle(lines, hole, handle) {
    addPair(lines, 0, "CIRCLE");
    addPair(lines, 5, handle);
    addPair(lines, 100, "AcDbEntity");
    addPair(lines, 8, HOLES_LAYER);
    addPair(lines, 100, "AcDbCircle");
    addPair(lines, 10, formatNumber(hole.xMm));
    addPair(lines, 20, formatNumber(hole.yMm));
    addPair(lines, 30, 0);
    addPair(lines, 40, formatNumber(hole.diameterMm / 2));
  }

  function addOutline(lines, points, handle) {
    addPair(lines, 0, "LWPOLYLINE");
    addPair(lines, 5, handle);
    addPair(lines, 100, "AcDbEntity");
    addPair(lines, 8, OUTLINES_LAYER);
    addPair(lines, 100, "AcDbPolyline");
    addPair(lines, 90, points.length);
    addPair(lines, 70, 1);
    points.forEach((point) => {
      addPair(lines, 10, formatNumber(point.xMm));
      addPair(lines, 20, formatNumber(point.yMm));
    });
  }

  function getExtents(panels) {
    const points = panels.flatMap((panel) => [
      ...panel.outline,
      ...panel.holes.flatMap((hole) => {
        const radius = hole.diameterMm / 2;
        return [
          { xMm: hole.xMm - radius, yMm: hole.yMm - radius },
          { xMm: hole.xMm + radius, yMm: hole.yMm + radius },
        ];
      }),
    ]);
    return points.reduce((result, point) => ({
      minX: Math.min(result.minX, point.xMm),
      minY: Math.min(result.minY, point.yMm),
      maxX: Math.max(result.maxX, point.xMm),
      maxY: Math.max(result.maxY, point.yMm),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  }

  function addHeader(lines, extents, handseed) {
    addPair(lines, 0, "SECTION");
    addPair(lines, 2, "HEADER");
    addPair(lines, 9, "$ACADVER");
    addPair(lines, 1, "AC1015");
    addPair(lines, 9, "$INSUNITS");
    addPair(lines, 70, 4);
    addPair(lines, 9, "$MEASUREMENT");
    addPair(lines, 70, 1);
    addPair(lines, 9, "$HANDSEED");
    addPair(lines, 5, handseed);
    addPair(lines, 9, "$EXTMIN");
    addPair(lines, 10, formatNumber(extents.minX));
    addPair(lines, 20, formatNumber(extents.minY));
    addPair(lines, 30, 0);
    addPair(lines, 9, "$EXTMAX");
    addPair(lines, 10, formatNumber(extents.maxX));
    addPair(lines, 20, formatNumber(extents.maxY));
    addPair(lines, 30, 0);
    addPair(lines, 0, "ENDSEC");
  }

  function addTables(lines) {
    addPair(lines, 0, "SECTION");
    addPair(lines, 2, "TABLES");
    addPair(lines, 0, "TABLE");
    addPair(lines, 2, "LTYPE");
    addPair(lines, 5, "1");
    addPair(lines, 330, "0");
    addPair(lines, 100, "AcDbSymbolTable");
    addPair(lines, 70, 1);
    addPair(lines, 0, "LTYPE");
    addPair(lines, 5, "2");
    addPair(lines, 330, "1");
    addPair(lines, 100, "AcDbSymbolTableRecord");
    addPair(lines, 100, "AcDbLinetypeTableRecord");
    addPair(lines, 2, "CONTINUOUS");
    addPair(lines, 70, 0);
    addPair(lines, 3, "Solid line");
    addPair(lines, 72, 65);
    addPair(lines, 73, 0);
    addPair(lines, 40, 0);
    addPair(lines, 0, "ENDTAB");
    addPair(lines, 0, "TABLE");
    addPair(lines, 2, "LAYER");
    addPair(lines, 5, "3");
    addPair(lines, 330, "0");
    addPair(lines, 100, "AcDbSymbolTable");
    addPair(lines, 70, 3);
    addLayer(lines, "0", 7, "4");
    addLayer(lines, HOLES_LAYER, 3, "5");
    addLayer(lines, OUTLINES_LAYER, 1, "6");
    addPair(lines, 0, "ENDTAB");
    addPair(lines, 0, "ENDSEC");
  }

  function createCutDxf(panels) {
    if (!Array.isArray(panels) || !panels.length) {
      throw new Error("At least one cut panel is required for DXF export");
    }
    panels.forEach((panel) => {
      if (!Array.isArray(panel.outline) || panel.outline.length < 3) {
        throw new Error("Every cut panel requires a closed outline");
      }
      if (!Array.isArray(panel.holes)) throw new Error("Every cut panel requires a hole list");
    });
    const entityCount = panels.reduce((sum, panel) => sum + panel.holes.length + 1, 0);
    let nextHandle = 7;
    const lines = [];
    addHeader(lines, getExtents(panels), formatHandle(nextHandle + entityCount));
    addTables(lines);
    addPair(lines, 0, "SECTION");
    addPair(lines, 2, "ENTITIES");
    panels.flatMap((panel) => panel.holes).forEach((hole) => {
      addCircle(lines, hole, formatHandle(nextHandle));
      nextHandle += 1;
    });
    panels.forEach((panel) => {
      addOutline(lines, panel.outline, formatHandle(nextHandle));
      nextHandle += 1;
    });
    addPair(lines, 0, "ENDSEC");
    addPair(lines, 0, "EOF");
    return `${lines.join("\r\n")}\r\n`;
  }

  return {
    HOLES_LAYER,
    OUTLINES_LAYER,
    DXF_MIME_TYPE,
    formatNumber,
    formatHandle,
    createCutDxf,
  };
});
