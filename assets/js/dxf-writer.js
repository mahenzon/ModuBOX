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
  const DXF_ACAD_VERSION = "AC1009";
  // R12 is effectively unitless; the manifest identifies these raw coordinates as millimeters.
  const DXF_COORDINATE_UNITS = "mm";

  function formatNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error("DXF values must be finite numbers");
    }
    const rounded = Math.round(numericValue * 1000000) / 1000000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  function addPair(lines, code, value) {
    lines.push(String(code), String(value));
  }

  function addLayer(lines, name, color) {
    addPair(lines, 0, "LAYER");
    addPair(lines, 2, name);
    addPair(lines, 70, 0);
    addPair(lines, 62, color);
    addPair(lines, 6, "CONTINUOUS");
  }

  function addCircle(lines, hole) {
    addPair(lines, 0, "CIRCLE");
    addPair(lines, 8, HOLES_LAYER);
    addPair(lines, 10, formatNumber(hole.xMm));
    addPair(lines, 20, formatNumber(hole.yMm));
    addPair(lines, 30, 0);
    addPair(lines, 40, formatNumber(hole.diameterMm / 2));
  }

  function addOutline(lines, points) {
    addPair(lines, 0, "POLYLINE");
    addPair(lines, 8, OUTLINES_LAYER);
    addPair(lines, 66, 1);
    addPair(lines, 70, 1);
    addPair(lines, 10, 0);
    addPair(lines, 20, 0);
    addPair(lines, 30, 0);
    points.forEach((point) => {
      addPair(lines, 0, "VERTEX");
      addPair(lines, 8, OUTLINES_LAYER);
      addPair(lines, 10, formatNumber(point.xMm));
      addPair(lines, 20, formatNumber(point.yMm));
      addPair(lines, 30, 0);
    });
    addPair(lines, 0, "SEQEND");
    addPair(lines, 8, OUTLINES_LAYER);
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

  function addHeader(lines, extents) {
    addPair(lines, 0, "SECTION");
    addPair(lines, 2, "HEADER");
    addPair(lines, 9, "$ACADVER");
    addPair(lines, 1, DXF_ACAD_VERSION);
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
    addPair(lines, 70, 1);
    addPair(lines, 0, "LTYPE");
    addPair(lines, 2, "CONTINUOUS");
    addPair(lines, 70, 0);
    addPair(lines, 3, "Solid line");
    addPair(lines, 72, 65);
    addPair(lines, 73, 0);
    addPair(lines, 40, 0);
    addPair(lines, 0, "ENDTAB");
    addPair(lines, 0, "TABLE");
    addPair(lines, 2, "LAYER");
    addPair(lines, 70, 3);
    addLayer(lines, "0", 7);
    addLayer(lines, HOLES_LAYER, 3);
    addLayer(lines, OUTLINES_LAYER, 1);
    addPair(lines, 0, "ENDTAB");
    addPair(lines, 0, "ENDSEC");
  }

  function validatePanels(panels) {
    if (!Array.isArray(panels) || !panels.length) {
      throw new Error("At least one cut panel is required for DXF export");
    }
    panels.forEach((panel, panelIndex) => {
      if (!panel || !Array.isArray(panel.outline) || panel.outline.length < 3) {
        throw new Error("Every cut panel requires a closed outline");
      }
      if (!Array.isArray(panel.holes)) throw new Error("Every cut panel requires a hole list");
      panel.outline.forEach((point, pointIndex) => {
        if (!point || !Number.isFinite(point.xMm) || !Number.isFinite(point.yMm)) {
          throw new Error(`Panel ${panelIndex + 1} outline point ${pointIndex + 1} is invalid`);
        }
      });
      panel.holes.forEach((hole, holeIndex) => {
        if (
          !hole
          || !Number.isFinite(hole.xMm)
          || !Number.isFinite(hole.yMm)
          || !Number.isFinite(hole.diameterMm)
          || hole.diameterMm <= 0
        ) {
          throw new Error(`Panel ${panelIndex + 1} hole ${holeIndex + 1} is invalid`);
        }
      });
    });
  }

  function createCutDxf(panels) {
    validatePanels(panels);
    const lines = [];
    addHeader(lines, getExtents(panels));
    addTables(lines);
    addPair(lines, 0, "SECTION");
    addPair(lines, 2, "ENTITIES");
    panels.flatMap((panel) => panel.holes).forEach((hole) => {
      addCircle(lines, hole);
    });
    panels.forEach((panel) => {
      addOutline(lines, panel.outline);
    });
    addPair(lines, 0, "ENDSEC");
    addPair(lines, 0, "EOF");
    return `${lines.join("\r\n")}\r\n`;
  }

  return {
    HOLES_LAYER,
    OUTLINES_LAYER,
    DXF_MIME_TYPE,
    DXF_ACAD_VERSION,
    DXF_COORDINATE_UNITS,
    formatNumber,
    createCutDxf,
  };
});
