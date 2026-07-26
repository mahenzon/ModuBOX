(function (root, factory) {
  let panelGeometry = root.WOODCASE_PANEL_GEOMETRY;
  let laserPlan = root.WOODCASE_LASER_PLAN;
  let dxfWriter = root.WOODCASE_DXF_WRITER;
  let dxfArchive = root.WOODCASE_DXF_ARCHIVE;
  let sha256 = root.WOODCASE_SHA256;
  if (typeof module === "object" && module.exports) {
    panelGeometry = require("./panel-geometry.js");
    laserPlan = require("./laser-plan.js");
    dxfWriter = require("./dxf-writer.js");
    dxfArchive = require("./dxf-archive.js");
    sha256 = require("./sha256.js");
    module.exports = factory(panelGeometry, laserPlan, dxfWriter, dxfArchive, sha256);
  } else {
    root.WOODCASE_DXF_EXPORT = factory(
      panelGeometry,
      laserPlan,
      dxfWriter,
      dxfArchive,
      sha256,
    );
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (panelGeometry, laserPlan, dxfWriter, dxfArchive, sha256) {
    "use strict";

    if (!panelGeometry || !laserPlan || !dxfWriter || !dxfArchive || !sha256) {
      throw new Error("Phase 2 DXF dependencies are required");
    }

    const trustedLayouts = new WeakMap();

    function normalizeCaseSetCount(value) {
      const result = Number(value === undefined ? 1 : value);
      if (!Number.isInteger(result) || result < 1 || result > 6) {
        throw new Error("Case sets must be a whole number from 1 to 6");
      }
      return result;
    }

    function configDimensionStem(config) {
      const values = [
        config && config.widthBoxes,
        config && config.depthBoxes,
        config && config.heightLevel,
        config && config.materialThicknessMm,
      ];
      if (!values.every(Number.isFinite)) {
        throw new Error("DXF filenames require complete W, D, H, and material thickness");
      }
      return `${config.widthBoxes}W-${config.depthBoxes}D-${config.heightLevel}H-${config.materialThicknessMm}mm`;
    }

    function configFilenameStem(bom) {
      return `woodcase-${configDimensionStem(bom.configuration || {})}`;
    }

    function geometryManifestFields(geometry) {
      return {
        ruleVersion: geometry.ruleVersion,
        configuration: geometry.configuration,
        clearanceDiameterMm: geometry.clearanceDiameterMm,
        dxfFormat: {
          release: "AutoCAD R12", acadVersion: dxfWriter.DXF_ACAD_VERSION, encoding: "ASCII",
          unitMetadataEncoded: false, importUnits: dxfWriter.DXF_COORDINATE_UNITS,
          outlineEncoding: "POLYLINE/VERTEX/SEQEND",
        },
        clearancePolicy: {
          type: "shared-diametral-adjustment",
          defaultMm: panelGeometry.DEFAULT_CLEARANCE_DIAMETER_MM,
          minimumMm: panelGeometry.MIN_CLEARANCE_DIAMETER_MM,
          maximumMm: panelGeometry.MAX_CLEARANCE_DIAMETER_MM,
        },
        baseHoleDiametersMm: Object.fromEntries(
          Object.entries(panelGeometry.HOLE_FAMILIES)
            .map(([key, value]) => [key, value.baseDiameterMm]),
        ),
        viewFace: "outside",
        localCoordinateFrame: {
          origin: "lower-left",
          xPositive: "right",
          yPositive: "up",
          units: "mm",
        },
        allowNestingMirror: false,
        kerfCompensationOwner: "CAM",
        exporterKerfOffsetMm: 0,
        outlineKerfCompensationMm: 0,
        holeKerfCompensationMm: 0,
        entityOrder: [
          `${dxfWriter.HOLES_LAYER}: true CIRCLE holes`,
          `${dxfWriter.OUTLINES_LAYER}: closed POLYLINE/VERTEX/SEQEND panel outlines`,
        ],
        cutterFilesContain: "cut geometry only",
        hashAlgorithm: "SHA-256",
        fingerprintCanonicalization: "sorted-key plain-data serialization",
        panelGeometrySha256: contentFingerprint(panelGeometryRecord(geometry)),
      };
    }

    function holeAuditRecord(hole, localHole) {
      const record = {
        id: hole.id,
        family: hole.family,
        centerMm: [hole.xMm, hole.yMm],
        baseDiameterMm: hole.baseDiameterMm,
        exportedDiameterMm: hole.diameterMm,
        sourceRuleId: hole.ruleId,
        clearancePolicy: hole.clearancePolicy,
        provenance: hole.provenance,
        confidence: hole.confidence,
        rawSourcePresent: hole.rawSourcePresent,
      };
      if (localHole) record.localCenterMm = [localHole.xMm, localHole.yMm];
      if (hole.productionOverride) record.productionOverride = hole.productionOverride;
      if (hole.sourcePlacement) record.sourcePlacement = hole.sourcePlacement;
      if (hole.repeatedPlacementTransform) {
        record.repeatedPlacementTransform = hole.repeatedPlacementTransform;
      }
      return record;
    }

    function panelAuditRecord(part) {
      return {
        role: part.role,
        exportRole: part.exportRole,
        nominalPanelSizeMm: [part.widthMm, part.heightMm],
        semanticEdges: part.semanticEdges,
        outlineMm: part.outline.map((point) => [point.xMm, point.yMm]),
        holes: part.holes.map((hole) => holeAuditRecord(hole)),
      };
    }

    function panelGeometryRecord(geometry) {
      return {
        ruleVersion: geometry.ruleVersion,
        configuration: geometry.configuration,
        clearanceDiameterMm: geometry.clearanceDiameterMm,
        semanticPanels: geometry.parts.map(panelAuditRecord),
      };
    }

    function cutEntityCounts(panels) {
      const circles = panels.reduce((sum, panel) => sum + panel.holes.length, 0);
      const closedOutlines = panels.length;
      return { circles, closedOutlines, total: circles + closedOutlines };
    }

    function panelCutSignature(part) {
      return panelGeometry.getPartCutSignature(part);
    }

    function requireCanonicalGeometry(bom, geometry) {
      if (!geometry || !Array.isArray(geometry.parts)) {
        throw new Error("Canonical panel geometry is required for Separate DXF export");
      }
      const canonical = panelGeometry.createPanelGeometry(bom, {
        clearanceDiameterMm: geometry.clearanceDiameterMm,
      });
      if (contentFingerprint(geometry) !== contentFingerprint(canonical)) {
        throw new Error("Separate DXF geometry does not match this bill of materials");
      }
      return geometry;
    }

    function createSeparateDxfFiles(bom, caseSetCountInput, geometryInput) {
      const caseSetCount = normalizeCaseSetCount(caseSetCountInput);
      const geometry = geometryInput
        ? requireCanonicalGeometry(bom, geometryInput)
        : panelGeometry.createPanelGeometry(bom);
      const byRole = new Map(geometry.parts.map((part) => [part.role, part]));
      const leftSide = byRole.get("left-side");
      const rightSide = byRole.get("right-side");
      if (panelCutSignature(leftSide) !== panelCutSignature(rightSide)) {
        throw new Error("Left and right side cut geometry differs and cannot share one DXF");
      }
      const specifications = [
        ["front", "front", caseSetCount, ["front"]],
        ["back", "back", caseSetCount, ["back"]],
        ["sides", "left-side", caseSetCount * 2, ["left-side", "right-side"]],
        ["lid", "lid", caseSetCount, ["lid"]],
        ["bottom", "bottom", caseSetCount, ["bottom"]],
      ];
      return specifications.map(([name, role, quantity, representedRoles]) => {
        const part = byRole.get(role);
        return {
          filename: `${name}-${configDimensionStem(geometry.configuration)}-x${quantity}.dxf`,
          content: dxfWriter.createCutDxf([part]),
          quantity,
          representedRoles,
          part,
        };
      });
    }

    function createSeparateManifest(bom, caseSetCount, geometry, files) {
      requireCanonicalGeometry(bom, geometry);
      const byRole = new Map(geometry.parts.map((part) => [part.role, part]));
      return {
        schemaVersion: 2,
        exportType: "separate-semantic-panels",
        ...geometryManifestFields(geometry),
        caseSetCount,
        semanticPanels: geometry.parts.map(panelAuditRecord),
        files: files.map((file) => ({
          filename: file.filename,
          sha256: sha256.sha256Hex(file.content),
          quantity: file.quantity,
          entityCounts: cutEntityCounts([file.part]),
          dxfGeometryRepresentativeRole: file.part.role,
          representedPanels: file.representedRoles
            .map((role) => panelAuditRecord(byRole.get(role))),
        })),
      };
    }

    function createSeparateDxfExport(bom, caseSetCountInput, geometryOrClearance) {
      const caseSetCount = normalizeCaseSetCount(caseSetCountInput);
      const geometry = geometryOrClearance && Array.isArray(geometryOrClearance.parts)
        ? geometryOrClearance
        : panelGeometry.createPanelGeometry(bom, {
            clearanceDiameterMm: geometryOrClearance,
          });
      const dxfFiles = createSeparateDxfFiles(bom, caseSetCount, geometry);
      const manifest = createSeparateManifest(bom, caseSetCount, geometry, dxfFiles);
      const manifestFile = {
        filename: "manifest.json",
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      };
      const files = [...dxfFiles, manifestFile];
      return {
        filename: `${configFilenameStem(bom)}-${caseSetCount}set${caseSetCount === 1 ? "" : "s"}-separate-dxf.zip`,
        mimeType: dxfArchive.ZIP_MIME_TYPE,
        content: dxfArchive.createStoredZip(files),
        files,
        geometry,
        manifest,
      };
    }

    function groupSheetLayouts(sheetGeometry) {
      const groups = [];
      const bySignature = new Map();
      sheetGeometry.sheets.forEach((sheet) => {
        const signature = panelGeometry.getSheetCutSignature(sheet);
        let group = bySignature.get(signature);
        if (!group) {
          group = {
            ordinal: groups.length + 1,
            signature,
            representative: sheet,
            physicalSheets: [],
          };
          bySignature.set(signature, group);
          groups.push(group);
        }
        group.physicalSheets.push(sheet);
      });
      groups.forEach((group) => {
        group.quantity = group.physicalSheets.length;
        group.filename = `sheet-${String(group.ordinal).padStart(2, "0")}-${configDimensionStem(sheetGeometry.configuration)}-x${group.quantity}.dxf`;
      });
      return groups;
    }

    function canonicalSerialize(value, seenInput) {
      if (value === null) return "null";
      if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Cannot fingerprint non-finite numbers");
        return Object.is(value, -0) ? "0" : String(value);
      }
      if (typeof value !== "object") {
        throw new Error(`Cannot fingerprint ${typeof value} values`);
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
        throw new Error("Cannot fingerprint non-plain objects");
      }
      const seen = seenInput || new Set();
      if (seen.has(value)) throw new Error("Cannot fingerprint cyclic data");
      seen.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.some((key) => typeof key === "symbol")) {
        throw new Error("Cannot fingerprint symbol properties");
      }
      let serialized;
      if (Array.isArray(value)) {
        const keys = ownKeys.filter((key) => key !== "length");
        if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
          throw new Error("Cannot fingerprint sparse or decorated arrays");
        }
        serialized = `[${keys.map((key) => {
          const descriptor = descriptors[key];
          if (!("value" in descriptor)) throw new Error("Cannot fingerprint accessors");
          return canonicalSerialize(descriptor.value, seen);
        }).join(",")}]`;
      } else {
        serialized = `{${ownKeys.sort().map((key) => {
          const descriptor = descriptors[key];
          if (!("value" in descriptor)) throw new Error("Cannot fingerprint accessors");
          return `${JSON.stringify(key)}:${canonicalSerialize(descriptor.value, seen)}`;
        }).join(",")}}`;
      }
      seen.delete(value);
      return serialized;
    }

    function contentFingerprint(value) {
      return sha256.sha256Hex(canonicalSerialize(value));
    }

    function rememberLayout(bom, layout) {
      trustedLayouts.set(layout, {
        bomSha256: contentFingerprint(bom),
        layoutSha256: contentFingerprint(layout),
      });
      return layout;
    }

    function looksLikeLayout(value) {
      return Boolean(
        value
        && typeof value === "object"
        && ("plan" in value || "geometry" in value || "groups" in value),
      );
    }

    function requireTrustedLayout(bom, layout) {
      const trust = trustedLayouts.get(layout);
      if (!trust) {
        throw new Error("Full DXF layout must be created by createFullDxfLayout");
      }
      if (trust.bomSha256 !== contentFingerprint(bom)) {
        throw new Error("Full DXF layout does not belong to this bill of materials");
      }
      if (trust.layoutSha256 !== contentFingerprint(layout)) {
        throw new Error("Full DXF layout changed after preview; recalculate it before export");
      }
      return layout;
    }

    function createFullDxfLayout(bom, optionsInput, clearanceInput) {
      const plan = laserPlan.calculateLaserPlan(bom, optionsInput);
      if (!plan.success) {
        throw new Error(plan.warnings[0] || "The selected sheet settings cannot fit the parts");
      }
      const sheetGeometry = panelGeometry.buildLaserSheetGeometries(
        bom,
        plan,
        { clearanceDiameterMm: clearanceInput },
      );
      return rememberLayout(bom, {
        plan,
        geometry: sheetGeometry,
        groups: groupSheetLayouts(sheetGeometry),
      });
    }

    function panelInstanceRecord(panel) {
      const localById = new Map(panel.sourcePart.holes.map((hole) => [hole.id, hole]));
      return {
        instanceId: panel.instanceId,
        mark: panel.mark,
        role: panel.role,
        nominalPanelSizeMm: [panel.sourcePart.widthMm, panel.sourcePart.heightMm],
        semanticEdges: panel.sourcePart.semanticEdges,
        rotationDeg: panel.rotationDeg,
        mirrored: panel.mirrored,
        transform: {
          matrix: panel.transform.matrix.map((row) => [...row]),
          translationMm: [...panel.transform.translationMm],
        },
        outlineMm: panel.outline.map((point) => [point.xMm, point.yMm]),
        holes: panel.holes.map((hole) =>
          holeAuditRecord(hole, localById.get(hole.id))),
      };
    }

    function packedPlanRecord(layout) {
      return {
        packingRoute: layout.plan.packingRoute,
        caseSetCount: layout.plan.caseSetCount,
        stockSizeMm: [layout.plan.sheetLengthMm, layout.plan.sheetWidthMm],
        nestingGapMm: layout.plan.nestingGapMm,
        allowRotation: layout.plan.allowRotation,
        physicalSheets: layout.geometry.sheets.map((sheet) => ({
          physicalSheetIndex: sheet.physicalSheetIndex,
          panels: sheet.panels.map(panelInstanceRecord),
        })),
      };
    }

    function createFullManifest(bom, layout, dxfFiles) {
      const fileByName = new Map(dxfFiles.map((file) => [file.filename, file]));
      const groupBySheet = new Map();
      layout.groups.forEach((group) => {
        const normalizedLayoutSha256 = sha256.sha256Hex(group.signature);
        group.physicalSheets.forEach((sheet) => {
          groupBySheet.set(sheet.physicalSheetIndex, {
            filename: group.filename,
            ordinal: group.ordinal,
            normalizedLayoutSha256,
          });
        });
      });
      return {
        schemaVersion: 2,
        exportType: "full-laser-physical-sheets",
        ...geometryManifestFields(layout.geometry),
        caseSetCount: layout.plan.caseSetCount,
        stockSizeMm: [layout.plan.sheetLengthMm, layout.plan.sheetWidthMm],
        nestingGapMm: layout.plan.nestingGapMm,
        allowRotation: layout.plan.allowRotation,
        packingRoute: "laser-compact",
        cutThroughOptionIgnored: true,
        packedPlanSha256: contentFingerprint(packedPlanRecord(layout)),
        files: layout.groups.map((group) => {
          const file = fileByName.get(group.filename);
          return {
            ordinal: group.ordinal,
            filename: group.filename,
            sha256: sha256.sha256Hex(file.content),
            normalizedLayoutSha256: sha256.sha256Hex(group.signature),
            quantity: group.quantity,
            entityCounts: cutEntityCounts(group.representative.panels),
            stockSizeMm: [
              group.representative.stockLengthMm,
              group.representative.stockWidthMm,
            ],
            physicalSheetInstances: group.physicalSheets
              .map((sheet) => sheet.physicalSheetIndex),
          };
        }),
        physicalSheets: layout.geometry.sheets.map((sheet) => {
          const group = groupBySheet.get(sheet.physicalSheetIndex);
          return {
            physicalSheetIndex: sheet.physicalSheetIndex,
            layoutOrdinal: group.ordinal,
            layoutFile: group.filename,
            normalizedLayoutSha256: group.normalizedLayoutSha256,
            panels: sheet.panels.map(panelInstanceRecord),
          };
        }),
      };
    }

    function createFullDxfExport(bom, layoutOrOptions, clearanceInput) {
      let layout;
      if (trustedLayouts.has(layoutOrOptions)) {
        layout = requireTrustedLayout(bom, layoutOrOptions);
      } else if (looksLikeLayout(layoutOrOptions)) {
        throw new Error("Full DXF layout must be created by createFullDxfLayout");
      } else {
        layout = createFullDxfLayout(bom, layoutOrOptions, clearanceInput);
      }
      const dxfFiles = layout.groups.map((group) => ({
        filename: group.filename,
        content: dxfWriter.createCutDxf(group.representative.panels),
        quantity: group.quantity,
        physicalSheetInstances: group.physicalSheets
          .map((sheet) => sheet.physicalSheetIndex),
      }));
      const manifest = createFullManifest(bom, layout, dxfFiles);
      const files = [
        ...dxfFiles,
        { filename: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      ];
      return {
        filename: `${configFilenameStem(bom)}-${layout.plan.caseSetCount}set${layout.plan.caseSetCount === 1 ? "" : "s"}-full-dxf.zip`,
        mimeType: dxfArchive.ZIP_MIME_TYPE,
        content: dxfArchive.createStoredZip(files),
        files,
        layout,
        manifest,
      };
    }

    return {
      ...dxfWriter,
      ...dxfArchive,
      ...sha256,
      ...laserPlan,
      normalizeCaseSetCount,
      configFilenameStem,
      panelCutSignature,
      createSeparateDxfFiles,
      createSeparateManifest,
      createSeparateDxfExport,
      groupSheetLayouts,
      createFullDxfLayout,
      createFullManifest,
      createFullDxfExport,
    };
  },
);
