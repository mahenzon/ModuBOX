(function (root, factory) {
  let core = root.WOODCASE_CORE;
  if (typeof module === "object" && module.exports) {
    core = require("./core.js");
    module.exports = factory(core);
  } else {
    root.WOODCASE_PANEL_GEOMETRY = factory(core);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("WOODCASE_CORE is required");
  const { buildBom } = core;

  const RULE_VERSION = "woodcase-v2-phase2-2026-07-26-r3";
  const DEFAULT_CLEARANCE_DIAMETER_MM = 0.1;
  const MIN_CLEARANCE_DIAMETER_MM = -1;
  const MAX_CLEARANCE_DIAMETER_MM = 1;
  const HOLE_FAMILIES = Object.freeze({
    frontBack: Object.freeze({ baseDiameterMm: 3 }),
    side: Object.freeze({ baseDiameterMm: 3 }),
    lidFront: Object.freeze({ baseDiameterMm: 3.5 }),
    lidHinge: Object.freeze({ baseDiameterMm: 3.5 }),
    bottom: Object.freeze({ baseDiameterMm: 3 }),
  });

  function roundMm(value) {
    return Math.round(Number(value) * 1000000) / 1000000;
  }

  function normalizeClearanceDiameterMm(value) {
    const result = Number(
      value === undefined || value === null || value === ""
        ? DEFAULT_CLEARANCE_DIAMETER_MM
        : value,
    );
    if (
      !Number.isFinite(result)
      || result < MIN_CLEARANCE_DIAMETER_MM
      || result > MAX_CLEARANCE_DIAMETER_MM
    ) {
      throw new Error("Hole diameter adjustment must be from -1.0 mm to +1.0 mm");
    }
    return roundMm(result);
  }

  function reflectX(widthMm, point) {
    return { xMm: roundMm(widthMm - point.xMm), yMm: roundMm(point.yMm) };
  }

  function reflectionMetadata(spanMm, sourcePlacement) {
    return {
      sourcePlacement,
      repeatedPlacementTransform: { type: "x-reflection", axisSpanMm: spanMm },
    };
  }

  function createHoleFactory(clearanceDiameterMm) {
    return function createHole(id, family, ruleId, xMm, yMm, metadata) {
      const baseDiameterMm = HOLE_FAMILIES[family].baseDiameterMm;
      const diameterMm = roundMm(baseDiameterMm + clearanceDiameterMm);
      if (!(diameterMm > 0)) throw new Error(`Hole ${id} must have a positive diameter`);
      return {
        id,
        family,
        ruleId,
        xMm: roundMm(xMm),
        yMm: roundMm(yMm),
        baseDiameterMm,
        diameterMm,
        clearancePolicy: "shared-diametral",
        provenance: "measured-stl",
        confidence: "confirmed",
        rawSourcePresent: true,
        ...(metadata || {}),
      };
    };
  }

  function createPart(role, exportRole, label, widthMm, heightMm, thicknessMm, holes, edges) {
    return {
      role,
      exportRole,
      label,
      quantityPerCase: 1,
      widthMm,
      heightMm,
      thicknessMm,
      viewFace: "outside",
      coordinateFrame: "lower-left-x-right-y-up",
      allowNestingMirror: false,
      semanticEdges: edges || {},
      outline: [
        { xMm: 0, yMm: 0 },
        { xMm: widthMm, yMm: 0 },
        { xMm: widthMm, yMm: heightMm },
        { xMm: 0, yMm: heightMm },
      ],
      holes,
    };
  }

  function createFrontBackHoles(config, dimensions, clearanceDiameterMm, includeHandle, role) {
    const makeHole = createHoleFactory(clearanceDiameterMm);
    const L = dimensions.frontBackLengthMm;
    const F = dimensions.frontBackHeightMm;
    const normalizedLower = config.heightLevel === 2 && config.widthBoxes <= 6;
    const holes = [];
    const addReflected = (key, ruleId, xMm, yMm, metadata) => {
      const reflected = reflectX(L, { xMm, yMm });
      holes.push(
        makeHole(`${role}:${key}:left`, "frontBack", ruleId, xMm, yMm, {
          ...(metadata || {}), sourcePlacement: "source-side",
        }),
        makeHole(`${role}:${key}:right`, "frontBack", ruleId, reflected.xMm, reflected.yMm, {
          ...(metadata || {}),
          ...reflectionMetadata(L, "opposite-side-face-down-reflection"),
        }),
      );
    };
    addReflected(
      "edge-lower",
      normalizedLower ? "front-back-2h-w5-w6-normalization" : "front-back-edge-pair",
      12,
      0.15 * F,
      normalizedLower
        ? {
            provenance: "approved-production-rule",
            rawSourcePresent: false,
            productionOverride: "add-missing-local-circle-at-12-6",
          }
        : null,
    );
    addReflected("edge-upper", "front-back-edge-pair", 12, 0.85 * F);
    addReflected("upper-outer", "front-back-upper-pair", 57.5, F - 11.8);
    addReflected("upper-inner", "front-back-upper-pair", 79.5, F - 11.8);
    if (includeHandle && config.heightLevel >= 3) {
      const yMm = F - 44.4;
      const metadata = {
        provenance: "explicit-product-rule",
        rawSourcePresent: false,
        productionOverride: "user-confirmed-front-handle-hole-rule",
      };
      addReflected("handle-outer", "front-only-handle-pair", 64.3, yMm, metadata);
      addReflected("handle-inner", "front-only-handle-pair", 98, yMm, metadata);
    }
    return holes;
  }

  function createSideHoles(config, dimensions, clearanceDiameterMm, role, frontEdgeXMm) {
    const makeHole = createHoleFactory(clearanceDiameterMm);
    const S = dimensions.sideLengthMm;
    const sigma = frontEdgeXMm === 0 ? 1 : -1;
    const backEdgeXMm = S - frontEdgeXMm;
    const sourceY = config.materialThicknessMm + 12;
    const sourceXs = [
      3.95 * config.heightLevel + 0.6,
      16.55 * config.heightLevel + 3.4,
    ];
    return sourceXs.flatMap((sourceX, index) => {
      const frontX = frontEdgeXMm + sigma * sourceY;
      const backX = backEdgeXMm - sigma * sourceY;
      return [
        makeHole(
          `${role}:front:${index + 1}`,
          "side",
          "side-front-placement",
          frontX,
          sourceX,
          { sourcePlacement: "front-edge" },
        ),
        makeHole(
          `${role}:back:${index + 1}`,
          "side",
          "side-back-x-reflection",
          backX,
          sourceX,
          reflectionMetadata(S, "back-edge-face-down-reflection"),
        ),
      ];
    });
  }

  function createLidHoles(config, dimensions, clearanceDiameterMm) {
    const makeHole = createHoleFactory(clearanceDiameterMm);
    const L = dimensions.lidWidthMm;
    const D = dimensions.lidHeightMm;
    const thirdX = config.widthBoxes === 5 ? 125 : L / 2 - 34;
    const holes = [];
    const addReflected = (key, family, ruleId, xMm, yMm) => {
      const reflected = reflectX(L, { xMm, yMm });
      holes.push(
        makeHole(`lid:${key}:left`, family, ruleId, xMm, yMm, {
          sourcePlacement: "source-side",
        }),
        makeHole(`lid:${key}:right`, family, ruleId, reflected.xMm, reflected.yMm, {
          ...reflectionMetadata(L, "opposite-side-face-down-reflection"),
        }),
      );
    };
    addReflected("lock-outer", "lidFront", "lid-front-lock", 51.5, 11.1);
    addReflected("lock-inner", "lidFront", "lid-front-lock", 73.5, 11.1);
    addReflected(
      "lock-third",
      "lidFront",
      config.widthBoxes === 5 ? "lid-front-lock-5w" : "lid-front-lock-6w-8w",
      thirdX,
      11.1,
    );
    addReflected("hinge-outer", "lidHinge", "lid-back-hinge", 56.5, D - 15.8617);
    addReflected("hinge-inner", "lidHinge", "lid-back-hinge", 78.5, D - 15.8617);
    return holes;
  }

  function createBottomHoles(config, dimensions, clearanceDiameterMm) {
    const makeHole = createHoleFactory(clearanceDiameterMm);
    const offsetMm = config.materialThicknessMm + 10;
    const widthMm = dimensions.bottomWidthMm;
    const heightMm = dimensions.bottomHeightMm;
    return [
      ["front-left", offsetMm, offsetMm],
      ["front-right", widthMm - offsetMm, offsetMm],
      ["back-left", offsetMm, heightMm - offsetMm],
      ["back-right", widthMm - offsetMm, heightMm - offsetMm],
    ].map(([key, xMm, yMm]) => makeHole(
      `bottom:${key}`,
      "bottom",
      "bottom-four-corners-t-plus-10",
      xMm,
      yMm,
      {
        provenance: "explicit-product-rule",
        rawSourcePresent: false,
        productionOverride: "user-confirmed-bottom-hole-rule",
      },
    ));
  }

  function createPanelGeometry(bomOrConfig, optionsInput) {
    const bom = bomOrConfig && bomOrConfig.configuration ? bomOrConfig : buildBom(bomOrConfig);
    const config = bom.configuration;
    const d = bom.dimensions;
    const t = config.materialThicknessMm;
    const clearanceInput = optionsInput && typeof optionsInput === "object"
      ? optionsInput.clearanceDiameterMm
      : optionsInput;
    const clearanceDiameterMm = normalizeClearanceDiameterMm(clearanceInput);
    const parts = [
      createPart(
        "front", "front", "Front", d.frontBackLengthMm, d.frontBackHeightMm, t,
        createFrontBackHoles(config, d, clearanceDiameterMm, true, "front"),
        { bottomYMm: 0 },
      ),
      createPart(
        "back", "back", "Back", d.frontBackLengthMm, d.frontBackHeightMm, t,
        createFrontBackHoles(config, d, clearanceDiameterMm, false, "back"),
        { bottomYMm: 0 },
      ),
      createPart(
        "left-side", "sides", "Left side", d.sideLengthMm, d.sideHeightMm, t,
        createSideHoles(config, d, clearanceDiameterMm, "left-side", d.sideLengthMm),
        { frontEdgeXMm: d.sideLengthMm, backEdgeXMm: 0, bottomYMm: 0 },
      ),
      createPart(
        "right-side", "sides", "Right side", d.sideLengthMm, d.sideHeightMm, t,
        createSideHoles(config, d, clearanceDiameterMm, "right-side", 0),
        { frontEdgeXMm: 0, backEdgeXMm: d.sideLengthMm, bottomYMm: 0 },
      ),
      createPart(
        "lid", "lid", "Lid", d.lidWidthMm, d.lidHeightMm, t,
        createLidHoles(config, d, clearanceDiameterMm),
        { frontEdgeYMm: 0, backEdgeYMm: d.lidHeightMm },
      ),
      createPart(
        "bottom", "bottom", "Bottom", d.bottomWidthMm, d.bottomHeightMm, t,
        createBottomHoles(config, d, clearanceDiameterMm),
        { frontEdgeYMm: 0, backEdgeYMm: d.bottomHeightMm },
      ),
    ];
    return {
      schemaVersion: 1,
      ruleVersion: RULE_VERSION,
      configuration: { ...config },
      clearanceDiameterMm,
      viewFace: "outside",
      allowNestingMirror: false,
      parts,
      holeCount: parts.reduce((sum, part) => sum + part.holes.length, 0),
    };
  }

  function resolvePlacementRole(placement) {
    const partId = placement.partId || String(placement.id || "").replace(/-\d+-[a-z]+$/, "");
    if (partId === "front-back") return Number(placement.partCopy) === 2 ? "back" : "front";
    if (partId === "side") return Number(placement.partCopy) === 2 ? "right-side" : "left-side";
    if (partId === "lid") return "lid";
    if (partId === "bottom") return "bottom";
    throw new Error(`Unknown wood-panel placement ${placement.id || partId}`);
  }

  function placePanel(part, placement, sheetWidthMm) {
    const rotated = Boolean(placement.rotated);
    const originX = Number(placement.x);
    const originY = sheetWidthMm - Number(placement.y) - Number(placement.height);
    const transform = (point) => rotated
      ? {
          xMm: roundMm(originX + part.heightMm - point.yMm),
          yMm: roundMm(originY + point.xMm),
        }
      : {
          xMm: roundMm(originX + point.xMm),
          yMm: roundMm(originY + point.yMm),
        };
    const placementTransform = rotated
      ? {
          matrix: [[0, -1], [1, 0]],
          translationMm: [roundMm(originX + part.heightMm), roundMm(originY)],
        }
      : {
          matrix: [[1, 0], [0, 1]],
          translationMm: [roundMm(originX), roundMm(originY)],
        };
    return {
      role: part.role,
      exportRole: part.exportRole,
      instanceId: placement.id,
      mark: placement.mark,
      sourcePart: part,
      rotationDeg: rotated ? 90 : 0,
      mirrored: false,
      transform: placementTransform,
      outline: part.outline.map(transform),
      holes: part.holes.map((hole) => ({ ...hole, ...transform(hole) })),
    };
  }

  function buildLaserSheetGeometries(bom, plan, optionsInput) {
    if (!plan || !plan.success || !Array.isArray(plan.sheets)) {
      throw new Error("A successful compact laser sheet plan is required");
    }
    const geometry = createPanelGeometry(bom, optionsInput);
    const byRole = new Map(geometry.parts.map((part) => [part.role, part]));
    return {
      ...geometry,
      sheets: plan.sheets.map((sheet) => ({
        physicalSheetIndex: sheet.index,
        stockLengthMm: plan.sheetLengthMm,
        stockWidthMm: plan.sheetWidthMm,
        panels: sheet.placements.map((placement) => {
          const part = byRole.get(resolvePlacementRole(placement));
          return placePanel(part, placement, plan.sheetWidthMm);
        }),
      })),
    };
  }

  function canonicalPolygon(points) {
    const values = points.map((point) => `${roundMm(point.xMm)},${roundMm(point.yMm)}`);
    const variants = [];
    for (const sequence of [values, [...values].reverse()]) {
      for (let index = 0; index < sequence.length; index += 1) {
        variants.push([...sequence.slice(index), ...sequence.slice(0, index)].join(";"));
      }
    }
    return variants.sort()[0];
  }

  function getPartCutSignature(part) {
    const holes = part.holes.map((hole) =>
      `${roundMm(hole.xMm)},${roundMm(hole.yMm)},${roundMm(hole.diameterMm)}`).sort();
    return JSON.stringify({ holes, outline: canonicalPolygon(part.outline) });
  }

  function getSheetCutSignature(sheet) {
    const holes = sheet.panels
      .flatMap((panel) => panel.holes.map((hole) =>
        `${roundMm(hole.xMm)},${roundMm(hole.yMm)},${roundMm(hole.diameterMm)}`))
      .sort();
    const outlines = sheet.panels.map((panel) => canonicalPolygon(panel.outline)).sort();
    const placements = sheet.panels
      .map((panel) => {
        const matrix = panel.transform && panel.transform.matrix;
        const translation = panel.transform && panel.transform.translationMm;
        if (!panel.sourcePart || panel.mirrored || !Array.isArray(matrix)
          || matrix.length !== 2 || !matrix.every((row) => Array.isArray(row) && row.length === 2)
          || !Array.isArray(translation) || translation.length !== 2) {
          throw new Error("Every nested panel requires a rigid, non-mirrored placement transform");
        }
        const [a, b, c, d] = [...matrix[0], ...matrix[1]];
        if (![a, b, c, d, ...translation].every(Number.isFinite)
          || Math.abs(a * a + c * c - 1) > 1e-9 || Math.abs(b * b + d * d - 1) > 1e-9
          || Math.abs(a * b + c * d) > 1e-9 || Math.abs(a * d - b * c - 1) > 1e-9) {
          throw new Error("Nested panel transforms may rotate and translate only");
        }
        return JSON.stringify({
          localCut: getPartCutSignature(panel.sourcePart), matrix, translationMm: translation,
        });
      })
      .sort();
    return JSON.stringify({
      stock: [roundMm(sheet.stockLengthMm), roundMm(sheet.stockWidthMm)],
      placements,
      holes,
      outlines,
    });
  }

  return {
    RULE_VERSION,
    DEFAULT_CLEARANCE_DIAMETER_MM,
    MIN_CLEARANCE_DIAMETER_MM,
    MAX_CLEARANCE_DIAMETER_MM,
    HOLE_FAMILIES,
    roundMm,
    normalizeClearanceDiameterMm,
    reflectX,
    createPanelGeometry,
    resolvePlacementRole,
    placePanel,
    buildLaserSheetGeometries,
    getPartCutSignature,
    getSheetCutSignature,
  };
});
