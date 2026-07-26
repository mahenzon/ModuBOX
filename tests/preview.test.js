const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = require(path.join(root, "assets/js/app.js"));
const dxfExport = require(path.join(root, "assets/js/dxf-export.js"));
const cssFiles = ["base.css", "preview.css", "calculator.css", "bom.css", "responsive.css"];
const readStyles = () => cssFiles
  .map((file) => fs.readFileSync(path.join(root, "assets/css", file), "utf8"))
  .join("\n");

test("all supported configurations produce valid dimensioned previews", () => {
  const { materialThicknessMm, widthBoxes, depthBoxes, heightLevel } = app.catalog.parameters;
  for (const t of materialThicknessMm.values) {
    for (const W of widthBoxes.values) {
      for (const D of depthBoxes.values) {
        for (const H of heightLevel.values) {
          const bom = app.buildBom({ materialThicknessMm: t, widthBoxes: W, depthBoxes: D, heightLevel: H });
          const html = app.renderPreviewSvg(bom.configuration, bom);
          assert(!html.includes("NaN"), `${t} mm / ${W}W / ${D}D / ${H}H contains NaN`);
          assert(html.includes(`${W} × ${D} cells`));
          assert(html.includes(`${W * 55} mm grid`));
          assert(html.includes(`${D * 55} mm`));
          assert(html.includes(`${bom.dimensions.bottomWidthMm} mm overall`));
          assert(html.includes(`${bom.dimensions.sideHeightMm} mm`));
          assert.equal(html.includes('data-feature="handle"'), H >= 3);
          assert.equal(html.includes('data-feature="no-handle"'), H === 2);
        }
      }
    }
  }
});

test("grid and exterior dimensions remain distinct", () => {
  const bom = app.buildBom({ materialThicknessMm: 12, widthBoxes: 8, depthBoxes: 7, heightLevel: 6 });
  assert.equal(bom.dimensions.bottomWidthMm, 464);
  assert.equal(bom.dimensions.bottomHeightMm, 409);
  assert.equal(bom.dimensions.sideHeightMm, 124);
  const html = app.renderPreviewSvg(bom.configuration, bom);
  assert(html.includes("440 mm grid"));
  assert(html.includes("464 mm overall"));
  assert(html.includes("385 mm"));
  assert(html.includes("409 mm overall"));
  assert(!html.includes("55 × 55 mm printed grid — inside bottom only"));
});

test("flat assembly views mirror final front hardware and keep the side clean", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 5, depthBoxes: 5, heightLevel: 4 });
  const html = app.renderPreviewSvg(bom.configuration, bom);
  const frontStart = html.indexOf('aria-label="Front assembly elevation"');
  const sideStart = html.indexOf('aria-label="Side assembly elevation"');
  const front = html.slice(frontStart, sideStart);
  const side = html.slice(sideStart);

  assert.equal((front.match(/data-feature="flat-top-lock"/g) || []).length, 2, "front shows two complete top locks");
  assert.equal((front.match(/data-feature="flat-handle-mount"/g) || []).length, 2, "front shows two handle mounts");
  assert.equal((front.match(/data-fastener="handle-mount"/g) || []).length, 4, "two visible handle screws per mount side");
  assert.equal((front.match(/data-fastener="lid-lock"/g) || []).length, 0, "top-facing lid screws stay hidden in front elevation");
  assert.match(front, /flat-chamfered-handle/);
  assert.match(front, /flat-lock-lid-base/);
  assert.match(front, /flat-lock-lip/);
  assert.match(front, /flat-lock-rail/);
  assert.match(front, /flat-slider-shell/);
  assert(!side.includes('data-feature="flat-top-lock"'), "front lock placeholders do not leak into side elevation");
  assert(!side.includes('width="44" height="13"'), "side elevation has no stray top rectangle");
});

test("open-case state moves the SVG fallback lid", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 7, depthBoxes: 6, heightLevel: 3 });
  const closed = app.renderModel3dSvg(bom.configuration, bom, { yaw: -0.62, pitch: -0.38, open: false });
  const open = app.renderModel3dSvg(bom.configuration, bom, { yaw: -0.62, pitch: -0.38, open: true });
  assert.notEqual(open, closed);
  assert(open.includes("Lid — open"));
  assert(closed.includes("Lid — closed"));
  assert(open.includes("model-grid-line"));
  assert(!closed.includes("model-grid-line"));
  const openLip = open.match(/<text x="([^"]+)" y="([^"]+)"[^>]+data-item="Lip"/);
  const closedLip = closed.match(/<text x="([^"]+)" y="([^"]+)"[^>]+data-item="Lip"/);
  assert(openLip && closedLip);
  assert.notDeepEqual(openLip.slice(1), closedLip.slice(1));
  assert(open.includes("Schematic fallback"));
  assert(!open.includes("model-marker"));
});

test("page wires accessible preview controls and local Three.js in load order", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert(!html.includes('id="showModelDimensions"'), "redundant dimensions toggle is removed");
  assert.match(html, /id="openCaseModel"[^>]*checked/);
  assert.match(html, /id="resetModelView"/);
  const scriptPaths = [
    "assets/js/catalog.js",
    "assets/js/drill-markers3d.js",
    "assets/vendor/three.min.js",
    "assets/js/model3d.js",
    "assets/js/core.js",
    "assets/js/panel-geometry.js",
    "assets/js/preview.js",
    "assets/js/sheet-planner.js",
    "assets/js/laser-plan.js",
    "assets/js/renderers.js",
    "assets/js/dxf-writer.js",
    "assets/js/dxf-archive.js",
    "assets/js/sha256.js",
    "assets/js/dxf-export.js",
    "assets/js/laser-preview.js",
    "assets/js/app.js",
  ];
  const scriptPositions = scriptPaths.map((scriptPath) => html.indexOf(`src="${scriptPath}"`));
  assert(scriptPositions.every((position) => position >= 0), "all local application scripts are loaded");
  assert.deepEqual([...scriptPositions].sort((a, b) => a - b), scriptPositions, "dependencies load before the app bootstrap");
  assert.match(html, /<details id="modelDimensions" class="model-dimensions" open>/);
  assert.match(html, /id="modelDimensionsContent"[^>]*aria-live="polite"/);
  for (const cssFile of cssFiles) {
    assert(html.includes(`href="assets/css/${cssFile}"`), `${cssFile} is loaded`);
  }
});

test("split classic scripts compose without modules or a web server", () => {
  const context = { console: { log() {}, warn() {}, error() {} } };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of [
    "catalog.js",
    "drill-markers3d.js",
    "core.js",
    "panel-geometry.js",
    "preview.js",
    "sheet-planner.js",
    "laser-plan.js",
    "renderers.js",
    "dxf-writer.js",
    "dxf-archive.js",
    "sha256.js",
    "dxf-export.js",
    "laser-preview.js",
    "app.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, "assets/js", file), "utf8"), context, { filename: file });
  }

  assert.equal(typeof context.WOODCASE_APP.buildBom, "function");
  assert.equal(typeof context.WOODCASE_APP.calculateWoodSheetPlan, "function");
  assert.equal(typeof context.WOODCASE_APP.renderPreviewSvg, "function");
  assert.equal(typeof context.WOODCASE_APP.initApp, "function");
});

test("source remains split into focused, bounded files", () => {
  assert.equal(fs.existsSync(path.join(root, "assets/app.js")), false);
  assert.equal(fs.existsSync(path.join(root, "assets/app.css")), false);

  const javascriptLimits = {
    "app.js": 430,
    "catalog.js": 400,
    "core.js": 550,
    "model3d.js": 850,
    "drill-markers3d.js": 120,
    "panel-geometry.js": 430,
    "preview.js": 400,
    "renderers.js": 400,
    "sheet-planner.js": 800,
    "laser-plan.js": 100,
    "laser-preview.js": 120,
    "dxf-writer.js": 220,
    "dxf-archive.js": 180,
    "sha256.js": 150,
    "dxf-export.js": 500,
  };
  for (const [file, maxLines] of Object.entries(javascriptLimits)) {
    const lines = fs.readFileSync(path.join(root, "assets/js", file), "utf8").split("\n").length;
    assert(lines <= maxLines, `${file} stays at or below ${maxLines} lines (found ${lines})`);
  }
  for (const file of cssFiles) {
    const lines = fs.readFileSync(path.join(root, "assets/css", file), "utf8").split("\n").length;
    assert(lines <= 600, `${file} stays at or below 600 lines (found ${lines})`);
  }
});

function parseDxfEntities(source) {
  const values = source.trim().split(/\r?\n/);
  const entities = [];
  let inEntities = false;
  let current = null;
  for (let index = 0; index < values.length; index += 2) {
    const code = Number(values[index]);
    const value = values[index + 1];
    if (code === 2 && value === "ENTITIES") {
      inEntities = true;
      continue;
    }
    if (!inEntities) continue;
    if (code === 0 && value === "ENDSEC") {
      if (current) entities.push(current);
      break;
    }
    if (code === 0) {
      if (current) entities.push(current);
      current = { type: value, values: new Map() };
    } else if (current) {
      const existing = current.values.get(code) || [];
      existing.push(value);
      current.values.set(code, existing);
    }
  }
  return entities;
}

function parseStoredZipEntries(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  const entries = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, "ZIP uses dependency-free stored entries");
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, bytes.subarray(dataStart, dataStart + size).toString("utf8"));
    offset = dataStart + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50, "ZIP contains a central directory");
  return entries;
}

function assertSheetPlanBoundsAndKerf(plan, context) {
  const epsilon = 1e-9;
  assert.equal(plan.success, true, `${context}: plan succeeds`);
  for (const sheet of plan.sheets) {
    for (const placement of sheet.placements) {
      assert(Number.isFinite(placement.x) && Number.isFinite(placement.y), `${context}: finite origin`);
      assert(
        Number.isFinite(placement.width) && placement.width > 0
          && Number.isFinite(placement.height) && placement.height > 0,
        `${context}: finite positive size`,
      );
      assert(placement.x >= -epsilon && placement.y >= -epsilon, `${context}: within sheet origin`);
      assert(
        placement.x + placement.width <= plan.sheetLengthMm + epsilon,
        `${context}: ${placement.mark} stays within sheet length`,
      );
      assert(
        placement.y + placement.height <= plan.sheetWidthMm + epsilon,
        `${context}: ${placement.mark} stays within sheet width`,
      );
    }
    for (let left = 0; left < sheet.placements.length; left += 1) {
      for (let right = left + 1; right < sheet.placements.length; right += 1) {
        const a = sheet.placements[left];
        const b = sheet.placements[right];
        const separated =
          a.x + a.width + plan.kerfMm <= b.x + epsilon
          || b.x + b.width + plan.kerfMm <= a.x + epsilon
          || a.y + a.height + plan.kerfMm <= b.y + epsilon
          || b.y + b.height + plan.kerfMm <= a.y + epsilon;
        assert(
          separated,
          `${context}: sheet ${sheet.index} ${a.mark} and ${b.mark} preserve ${plan.kerfMm} mm gap`,
        );
      }
    }
  }
}

function assertNoCoincidentPolylineEdges(rectangles, context) {
  const seen = new Set();
  rectangles.forEach((rectangle) => {
    const xs = rectangle.values.get(10).map(Number);
    const ys = rectangle.values.get(20).map(Number);
    const vertices = xs.map((x, index) => [x, ys[index]]);
    vertices.forEach((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      const ordered = start[0] < end[0] || (start[0] === end[0] && start[1] <= end[1])
        ? [start, end]
        : [end, start];
      const key = ordered.flat().join(",");
      assert(!seen.has(key), `${context}: coincident CUT edge ${key}`);
      seen.add(key);
    });
  });
}

function assertDxfHeaderAndLayers(content) {
  assert.match(content, /\r\n\$ACADVER\r\n1\r\nAC1015\r\n/);
  assert.match(content, /\r\n\$INSUNITS\r\n70\r\n4\r\n/);
  assert.match(content, /\r\n\$MEASUREMENT\r\n70\r\n1\r\n/);
  assert.match(content, /\r\n\$HANDSEED\r\n5\r\n[0-9A-F]+\r\n/);
  assert.match(content, /\r\n2\r\nLTYPE\r\n5\r\n1\r\n330\r\n0\r\n100\r\nAcDbSymbolTable\r\n/);
  assert.match(content, /\r\n2\r\nLAYER\r\n5\r\n3\r\n330\r\n0\r\n100\r\nAcDbSymbolTable\r\n/);
  assert.match(content, /\r\n2\r\nCUT_HOLES_FIRST\r\n70\r\n0\r\n62\r\n3\r\n6\r\nCONTINUOUS\r\n290\r\n1\r\n/);
  assert.match(content, /\r\n2\r\nCUT_OUTLINES_LAST\r\n70\r\n0\r\n62\r\n1\r\n6\r\nCONTINUOUS\r\n290\r\n1\r\n/);
  assert(!content.includes("ANNOTATION_DO_NOT_CUT"));
  const allHandles = [...content.matchAll(/\r\n5\r\n([0-9A-F]+)\r\n/g)]
    .map((match) => match[1]);
  assert.equal(new Set(allHandles).size, allHandles.length, "all document handles are unique");
}

function assertCutDxf(content, panels) {
  assertDxfHeaderAndLayers(content);
  const entities = parseDxfEntities(content);
  const holes = panels.flatMap((panel) => panel.holes);
  const handles = entities.map((entity) => entity.values.get(5)?.[0]);
  assert(handles.every(Boolean), "every R2000 entity has a handle");
  assert.equal(new Set(handles).size, handles.length, "R2000 entity handles are unique");
  assert.deepEqual(
    handles,
    entities.map((_entity, index) => (7 + index).toString(16).toUpperCase()),
    "entity handles are deterministic and sequential after table handles",
  );
  const handseed = content.match(/\r\n\$HANDSEED\r\n5\r\n([0-9A-F]+)\r\n/);
  assert(handseed);
  assert.equal(
    Number.parseInt(handseed[1], 16),
    7 + entities.length,
    "$HANDSEED points to the next unused handle",
  );
  const extents = panels.flatMap((panel) => [
    ...panel.outline,
    ...panel.holes.flatMap((hole) => [
      { xMm: hole.xMm - hole.diameterMm / 2, yMm: hole.yMm - hole.diameterMm / 2 },
      { xMm: hole.xMm + hole.diameterMm / 2, yMm: hole.yMm + hole.diameterMm / 2 },
    ]),
  ]).reduce((result, point) => ({
    minX: Math.min(result.minX, point.xMm),
    minY: Math.min(result.minY, point.yMm),
    maxX: Math.max(result.maxX, point.xMm),
    maxY: Math.max(result.maxY, point.yMm),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const extmin = content.match(/\r\n\$EXTMIN\r\n10\r\n([^\r]+)\r\n20\r\n([^\r]+)\r\n/);
  const extmax = content.match(/\r\n\$EXTMAX\r\n10\r\n([^\r]+)\r\n20\r\n([^\r]+)\r\n/);
  assert.deepEqual(extmin.slice(1).map(Number), [extents.minX, extents.minY]);
  assert.deepEqual(extmax.slice(1).map(Number), [extents.maxX, extents.maxY]);
  assert.deepEqual(
    entities.map((entity) => entity.type),
    [...holes.map(() => "CIRCLE"), ...panels.map(() => "LWPOLYLINE")],
    "all true circles are serialized before all closed outlines",
  );
  entities.slice(0, holes.length).forEach((circle, index) => {
    const hole = holes[index];
    assert.deepEqual(circle.values.get(8), ["CUT_HOLES_FIRST"]);
    assert.equal(Number(circle.values.get(10)[0]), hole.xMm);
    assert.equal(Number(circle.values.get(20)[0]), hole.yMm);
    assert.equal(Number(circle.values.get(40)[0]) * 2, hole.diameterMm);
  });
  entities.slice(holes.length).forEach((outline, index) => {
    const expected = panels[index].outline;
    assert.deepEqual(outline.values.get(8), ["CUT_OUTLINES_LAST"]);
    assert.deepEqual(outline.values.get(90), [String(expected.length)]);
    assert.deepEqual(outline.values.get(70), ["1"]);
    assert.deepEqual(outline.values.get(10).map(Number), expected.map((point) => point.xMm));
    assert.deepEqual(outline.values.get(20).map(Number), expected.map((point) => point.yMm));
  });
  assert(entities.every((entity) => ["CIRCLE", "LWPOLYLINE"].includes(entity.type)));
}

test("all 420 configurations share exact panel geometry across preview and separate DXF", () => {
  const { materialThicknessMm, widthBoxes, depthBoxes, heightLevel } = app.catalog.parameters;
  const expectedRoles = ["front", "back", "left-side", "right-side", "lid", "bottom"];
  let checked = 0;
  for (const t of materialThicknessMm.values) {
    for (const W of widthBoxes.values) {
      for (const D of depthBoxes.values) {
        for (const H of heightLevel.values) {
          const bom = app.buildBom({
            materialThicknessMm: t,
            widthBoxes: W,
            depthBoxes: D,
            heightLevel: H,
          });
          const geometry = app.createPanelGeometry(bom);
          assert.deepEqual(geometry.parts.map((part) => part.role), expectedRoles);
          assert.equal(geometry.holeCount, H === 2 ? 38 : 42);
          assert.deepEqual(
            geometry.parts.map((part) => part.holes.length),
            H === 2 ? [8, 8, 4, 4, 10, 4] : [12, 8, 4, 4, 10, 4],
          );
          assert.deepEqual(
            geometry.parts.map((part) => [part.widthMm, part.heightMm]),
            [
              [bom.dimensions.frontBackLengthMm, bom.dimensions.frontBackHeightMm],
              [bom.dimensions.frontBackLengthMm, bom.dimensions.frontBackHeightMm],
              [bom.dimensions.sideLengthMm, bom.dimensions.sideHeightMm],
              [bom.dimensions.sideLengthMm, bom.dimensions.sideHeightMm],
              [bom.dimensions.lidWidthMm, bom.dimensions.lidHeightMm],
              [bom.dimensions.bottomWidthMm, bom.dimensions.bottomHeightMm],
            ],
          );
          geometry.parts.forEach((part) => {
            assert.equal(new Set(part.holes.map((hole) => `${hole.xMm},${hole.yMm}`)).size, part.holes.length);
            part.holes.forEach((hole) => {
              assert.equal(hole.diameterMm, hole.baseDiameterMm + 0.1);
              assert.equal(hole.confidence, "confirmed");
              assert(hole.xMm - hole.diameterMm / 2 >= 0);
              assert(hole.yMm - hole.diameterMm / 2 >= 0);
              assert(hole.xMm + hole.diameterMm / 2 <= part.widthMm);
              assert(hole.yMm + hole.diameterMm / 2 <= part.heightMm);
            });
          });
          assert.equal(
            dxfExport.panelCutSignature(geometry.parts[2]),
            dxfExport.panelCutSignature(geometry.parts[3]),
          );
          const preview = app.renderPreviewSvg(bom.configuration, bom, geometry);
          assert.equal((preview.match(/class="panel-cut-hole"/g) || []).length, geometry.holeCount);
          const caseSetCount = checked % 6 + 1;
          const dimensionStem = `${W}W-${D}D-${H}H-${t}mm`;
          const files = dxfExport.createSeparateDxfFiles(bom, caseSetCount, geometry);
          assert.deepEqual(files.map((file) => file.filename), [
            `front-${dimensionStem}-x${caseSetCount}.dxf`,
            `back-${dimensionStem}-x${caseSetCount}.dxf`,
            `sides-${dimensionStem}-x${caseSetCount * 2}.dxf`,
            `lid-${dimensionStem}-x${caseSetCount}.dxf`,
            `bottom-${dimensionStem}-x${caseSetCount}.dxf`,
          ]);
          files.forEach((file) => assertCutDxf(file.content, [file.part]));
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 420);
});

test("clearance changes diameters only and preserves every feature base diameter", () => {
  const { materialThicknessMm, widthBoxes, depthBoxes, heightLevel } = app.catalog.parameters;
  for (const t of materialThicknessMm.values) {
    for (const W of widthBoxes.values) {
      for (const D of depthBoxes.values) {
        for (const H of heightLevel.values) {
          const bom = app.buildBom({ materialThicknessMm: t, widthBoxes: W, depthBoxes: D, heightLevel: H });
          const baseline = app.createPanelGeometry(bom, { clearanceDiameterMm: 0 });
          for (const clearance of [-1, 0.1, 1]) {
            const geometry = app.createPanelGeometry(bom, { clearanceDiameterMm: clearance });
            geometry.parts.forEach((part, partIndex) => {
              const original = baseline.parts[partIndex];
              assert.deepEqual(part.outline, original.outline);
              part.holes.forEach((hole, holeIndex) => {
                const source = original.holes[holeIndex];
                assert.deepEqual([hole.id, hole.xMm, hole.yMm], [source.id, source.xMm, source.yMm]);
                assert.equal(hole.baseDiameterMm, source.baseDiameterMm);
                assert.equal(hole.diameterMm, source.baseDiameterMm + clearance);
              });
            });
          }
          const bottom = baseline.parts.find((part) => part.role === "bottom");
          const offset = t + 10;
          assert.deepEqual(
            bottom.holes.map((hole) => [hole.xMm, hole.yMm]),
            [
              [offset, offset],
              [bottom.widthMm - offset, offset],
              [offset, bottom.heightMm - offset],
              [bottom.widthMm - offset, bottom.heightMm - offset],
            ],
          );
          const front = baseline.parts[0];
          const handleHoles = front.holes
            .filter((hole) => hole.ruleId === "front-only-handle-pair");
          const handleYMm = app.roundMm(front.heightMm - 44.4);
          assert.deepEqual(
            handleHoles
              .map((hole) => [hole.xMm, hole.yMm])
              .sort((a, b) => a[0] - b[0]),
            H === 2
              ? []
              : [
                  [64.3, handleYMm],
                  [98, handleYMm],
                  [front.widthMm - 98, handleYMm],
                  [front.widthMm - 64.3, handleYMm],
                ],
          );
          assert(handleHoles.every(
            (hole) => hole.productionOverride === "user-confirmed-front-handle-hole-rule",
          ));
          const back = baseline.parts[1];
          assert.equal(back.holes.some((hole) => hole.ruleId === "front-only-handle-pair"), false);
          if (H === 2 && W <= 6) {
            assert.equal(
              front.holes.filter((hole) => hole.productionOverride === "add-missing-local-circle-at-12-6").length,
              2,
            );
          }
        }
      }
    }
  }
});

test("all 420 Full laser layouts preserve canonical holes through rotation and translation", () => {
  const { materialThicknessMm, widthBoxes, depthBoxes, heightLevel } = app.catalog.parameters;
  let checked = 0;
  for (const t of materialThicknessMm.values) {
    for (const W of widthBoxes.values) {
      for (const D of depthBoxes.values) {
        for (const H of heightLevel.values) {
          const bom = app.buildBom({ materialThicknessMm: t, widthBoxes: W, depthBoxes: D, heightLevel: H });
          const layout = dxfExport.createFullDxfLayout(bom, {
            caseSetCount: 1,
            sheetLengthMm: 1000,
            sheetWidthMm: 500,
            kerfMm: 0.1,
            allowRotation: true,
            cutThroughOnly: checked % 2 === 0,
          }, 0.1);
          assert.equal(layout.plan.cutThroughOnly, false);
          layout.geometry.sheets.forEach((sheet, sheetIndex) => {
            const plannerSheet = layout.plan.sheets[sheetIndex];
            sheet.panels.forEach((panel, panelIndex) => {
              const placement = plannerSheet.placements[panelIndex];
              const source = panel.sourcePart;
              const originY = layout.plan.sheetWidthMm - placement.y - placement.height;
              assert.equal(panel.mirrored, false);
              assert.equal(panel.rotationDeg, placement.rotated ? 90 : 0);
              panel.holes.forEach((hole, holeIndex) => {
                const local = source.holes[holeIndex];
                const expectedX = placement.rotated
                  ? placement.x + source.heightMm - local.yMm
                  : placement.x + local.xMm;
                const expectedY = placement.rotated
                  ? originY + local.xMm
                  : originY + local.yMm;
                assert.equal(hole.xMm, app.roundMm(expectedX));
                assert.equal(hole.yMm, app.roundMm(expectedY));
                assert.equal(hole.diameterMm, local.diameterMm);
              });
            });
          });
          const html = app.renderFullLaserPreview(layout);
          const previewHoleCount = layout.groups.reduce(
            (sum, group) => sum + group.representative.panels
              .reduce((panelSum, panel) => panelSum + panel.holes.length, 0),
            0,
          );
          assert.equal((html.match(/class="laser-preview-hole"/g) || []).length, previewHoleCount);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 420);
});

test("Full laser export ignores cut-through mode and emits grouped cut-only sheet files", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 6, depthBoxes: 5, heightLevel: 3 });
  const options = {
    caseSetCount: 3,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    kerfMm: 2,
    allowRotation: true,
  };
  const compact = dxfExport.createFullDxfLayout(bom, { ...options, cutThroughOnly: false }, 0.1);
  const sawToggleOn = dxfExport.createFullDxfLayout(bom, { ...options, cutThroughOnly: true }, 0.1);
  assert.deepEqual(sawToggleOn, compact);
  assert.equal(compact.plan.cutThroughOnly, false);
  assert.equal(compact.plan.packingRoute, "laser-compact");
  assert.equal(compact.plan.nestingGapMm, 2);
  const previewA = app.renderFullLaserPreview(compact);
  const previewB = app.renderFullLaserPreview(sawToggleOn);
  assert.equal(previewA, previewB);

  const exported = dxfExport.createFullDxfExport(bom, compact);
  assert.equal(exported.filename, "woodcase-6W-5D-3H-9mm-3sets-full-dxf.zip");
  assert.equal(exported.mimeType, "application/zip");
  const entries = parseStoredZipEntries(exported.content);
  assert.deepEqual([...entries.keys()], [...compact.groups.map((group) => group.filename), "manifest.json"]);
  compact.groups.forEach((group) => {
    assert.match(group.filename, /^sheet-\d{2}-6W-5D-3H-9mm-x\d+\.dxf$/);
    assertCutDxf(entries.get(group.filename), group.representative.panels);
    const entities = parseDxfEntities(entries.get(group.filename));
    assertNoCoincidentPolylineEdges(
      entities.filter((entity) => entity.type === "LWPOLYLINE"),
      group.filename,
    );
  });
  const manifest = JSON.parse(entries.get("manifest.json"));
  assert.equal(manifest.cutThroughOptionIgnored, true);
  assert.equal(manifest.kerfCompensationOwner, "CAM");
  assert.equal(manifest.exporterKerfOffsetMm, 0);
  assert.equal(manifest.outlineKerfCompensationMm, 0);
  assert.equal(manifest.allowNestingMirror, false);
  assert.equal(manifest.physicalSheets.length, compact.plan.sheetCount);
  assert.equal(manifest.files.reduce((sum, file) => sum + file.quantity, 0), compact.plan.sheetCount);
  manifest.files.forEach((file) => {
    const group = compact.groups.find((entry) => entry.ordinal === file.ordinal);
    assert.equal(file.sha256, dxfExport.sha256Hex(entries.get(file.filename)));
    assert.equal(file.normalizedLayoutSha256, dxfExport.sha256Hex(group.signature));
    assert.deepEqual(file.stockSizeMm, [1000, 500]);
    const entities = parseDxfEntities(entries.get(file.filename));
    assert.deepEqual(file.entityCounts, {
      circles: entities.filter((entity) => entity.type === "CIRCLE").length,
      closedOutlines: entities.filter((entity) => entity.type === "LWPOLYLINE").length,
      total: entities.length,
    });
    assert.equal(file.quantity, file.physicalSheetInstances.length);
    assert.match(
      file.filename,
      new RegExp(`^sheet-${String(file.ordinal).padStart(2, "0")}-6W-5D-3H-9mm-x${file.quantity}\\.dxf$`),
    );
  });
  assert.match(manifest.panelGeometrySha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.packedPlanSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    new Set(manifest.files.map((file) => file.normalizedLayoutSha256)).size,
    manifest.files.length,
  );
  manifest.physicalSheets.forEach((sheet) => {
    const file = manifest.files.find((entry) => entry.filename === sheet.layoutFile);
    assert.equal(sheet.layoutOrdinal, file.ordinal);
    assert.equal(sheet.normalizedLayoutSha256, file.normalizedLayoutSha256);
    sheet.panels.forEach((panel) => {
      assert.equal(panel.mirrored, false);
      assert.deepEqual(
        panel.transform.matrix,
        panel.rotationDeg === 90 ? [[0, -1], [1, 0]] : [[1, 0], [0, 1]],
      );
      assert.equal(panel.transform.translationMm.length, 2);
      assert(panel.semanticEdges && typeof panel.semanticEdges === "object");
      panel.holes.forEach((hole) => {
        assert.equal(hole.exportedDiameterMm, hole.baseDiameterMm + 0.1);
        assert.equal(hole.confidence, "confirmed");
        assert.equal(hole.localCenterMm.length, 2);
        assert.match(hole.sourceRuleId, /\S/);
      });
    });
  });
  const fileSheetIds = manifest.files.flatMap((file) => file.physicalSheetInstances);
  assert.equal(new Set(fileSheetIds).size, manifest.physicalSheets.length);
  assert.deepEqual(
    [...fileSheetIds].sort((a, b) => a - b),
    manifest.physicalSheets.map((sheet) => sheet.physicalSheetIndex).sort((a, b) => a - b),
  );
});

test("duplicate physical sheet layouts group in deterministic first-seen order", () => {
  const bom = app.buildBom({ materialThicknessMm: 6, widthBoxes: 5, depthBoxes: 5, heightLevel: 2 });
  const layout = dxfExport.createFullDxfLayout(bom, {
    caseSetCount: 1,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    kerfMm: 0.1,
    allowRotation: true,
    cutThroughOnly: false,
  });
  const first = JSON.parse(JSON.stringify(layout.geometry.sheets[0]));
  const duplicate = JSON.parse(JSON.stringify(first));
  const distinct = JSON.parse(JSON.stringify(first));
  const sameCutsDifferentTransform = JSON.parse(JSON.stringify(first));
  first.physicalSheetIndex = 1;
  duplicate.physicalSheetIndex = 2;
  distinct.physicalSheetIndex = 3;
  sameCutsDifferentTransform.physicalSheetIndex = 4;
  distinct.panels[0].holes[0].xMm += 0.25;
  sameCutsDifferentTransform.panels[0].transform.translationMm[0] += 0.25;
  assert.throws(
    () => dxfExport.groupSheetLayouts({ sheets: [first] }),
    /require complete W, D, H, and material thickness/,
  );
  const groups = dxfExport.groupSheetLayouts({
    configuration: layout.geometry.configuration,
    sheets: [first, duplicate, distinct, sameCutsDifferentTransform],
  });
  assert.deepEqual(
    groups.map((group) => group.filename),
    [
      "sheet-01-5W-5D-2H-6mm-x2.dxf",
      "sheet-02-5W-5D-2H-6mm-x1.dxf",
      "sheet-03-5W-5D-2H-6mm-x1.dxf",
    ],
  );
  assert.deepEqual(
    groups.map((group) => group.physicalSheets.map((sheet) => sheet.physicalSheetIndex)),
    [[1, 2], [3], [4]],
  );
  const mirrored = JSON.parse(JSON.stringify(first));
  mirrored.panels[0].mirrored = true;
  assert.throws(
    () => dxfExport.groupSheetLayouts({ sheets: [mirrored] }),
    /rigid, non-mirrored placement transform/,
  );
  const sheared = JSON.parse(JSON.stringify(first));
  sheared.panels[0].transform.matrix = [[1, 0.25], [0, 1]];
  assert.throws(
    () => dxfExport.groupSheetLayouts({ sheets: [sheared] }),
    /may rotate and translate only/,
  );
});

test("Full laser gap floor is 0.10 mm while separate DXF stays independent", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 6, depthBoxes: 5, heightLevel: 3 });
  const options = {
    caseSetCount: 1,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    allowRotation: true,
    cutThroughOnly: true,
  };
  for (const kerfMm of [0, 0.099]) {
    assert.throws(
      () => dxfExport.createFullDxfLayout(bom, { ...options, kerfMm }),
      /requires a nesting gap of at least 0.1 mm/,
    );
  }
  assert.equal(dxfExport.createFullDxfLayout(bom, { ...options, kerfMm: 0.1 }).plan.success, true);
  const separate = dxfExport.createSeparateDxfExport(bom, 1);
  assert.equal(separate.files.length, 6);
  assert.match(separate.filename, /-1set-separate-dxf\.zip$/);
});

test("Full export accepts only intact layouts from the matching preview calculation", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 6, depthBoxes: 5, heightLevel: 3 });
  const options = {
    caseSetCount: 2,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    kerfMm: 0.1,
    allowRotation: true,
    cutThroughOnly: true,
  };
  const trusted = dxfExport.createFullDxfLayout(bom, options, 0.1);
  assert.equal(dxfExport.createFullDxfExport(bom, trusted).layout, trusted);

  const forged = JSON.parse(JSON.stringify(trusted));
  assert.throws(
    () => dxfExport.createFullDxfExport(bom, forged),
    /must be created by createFullDxfLayout/,
  );

  const wrongBom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 7, depthBoxes: 5, heightLevel: 3 });
  assert.throws(
    () => dxfExport.createFullDxfExport(wrongBom, trusted),
    /does not belong to this bill of materials/,
  );

  const changed = dxfExport.createFullDxfLayout(bom, options, 0.1);
  changed.plan.nestingGapMm = 0;
  assert.throws(
    () => dxfExport.createFullDxfExport(bom, changed),
    /changed after preview/,
  );

  const masked = dxfExport.createFullDxfLayout(bom, options, 0.1);
  const snapshot = JSON.parse(JSON.stringify(masked));
  masked.geometry.sheets[0].panels[0].holes[0].xMm += 123;
  masked.toJSON = () => snapshot;
  assert.throws(
    () => dxfExport.createFullDxfExport(bom, masked),
    /Cannot fingerprint function values/,
  );

  const poisoned = dxfExport.createFullDxfLayout(bom, options, 0.1);
  const originalX = poisoned.plan.sheets[0].placements[0].x;
  poisoned.plan.sheets[0].placements[0].x = 99999;
  assert.throws(
    () => dxfExport.createFullDxfExport(bom, poisoned),
    /changed after preview/,
  );
  const recalculated = dxfExport.createFullDxfLayout(bom, options, 0.1);
  assert.equal(
    recalculated.plan.sheets[0].placements[0].x,
    originalX,
    "mutating one preview layout cannot poison the planner cache",
  );

  assert.throws(
    () => dxfExport.createFullDxfLayout(bom, {
      ...options,
      kerfMm: 0,
      packingRoute: "laser-compact",
      sheets: trusted.plan.sheets,
    }),
    /requires a nesting gap of at least 0.1 mm/,
  );
  const direct = dxfExport.createFullDxfExport(bom, options, 0.1);
  assert.equal(direct.layout.plan.cutThroughOnly, false);
});

test("separate archive uses configuration-rich semantic filenames and an external manifest", () => {
  const bom = app.buildBom({ materialThicknessMm: 12, widthBoxes: 8, depthBoxes: 7, heightLevel: 6 });
  const exported = dxfExport.createSeparateDxfExport(bom, 3, 0.1);
  assert.equal(exported.filename, "woodcase-8W-7D-6H-12mm-3sets-separate-dxf.zip");
  const entries = parseStoredZipEntries(exported.content);
  assert.deepEqual([...entries.keys()], [
    "front-8W-7D-6H-12mm-x3.dxf",
    "back-8W-7D-6H-12mm-x3.dxf",
    "sides-8W-7D-6H-12mm-x6.dxf",
    "lid-8W-7D-6H-12mm-x3.dxf",
    "bottom-8W-7D-6H-12mm-x3.dxf",
    "manifest.json",
  ]);
  exported.files.filter((file) => file.filename.endsWith(".dxf")).forEach((file) => {
    assertCutDxf(entries.get(file.filename), [file.part]);
  });
  const manifest = JSON.parse(entries.get("manifest.json"));
  assert.deepEqual(manifest.files.map((file) => file.quantity), [3, 3, 6, 3, 3]);
  assert.equal(manifest.cutterFilesContain, "cut geometry only");
  assert.deepEqual(manifest.semanticPanels.map((panel) => panel.role), [
    "front", "back", "left-side", "right-side", "lid", "bottom",
  ]);
  manifest.files.forEach((file) => {
    assert.equal(file.sha256, dxfExport.sha256Hex(entries.get(file.filename)));
    assert(file.representedPanels.every((panel) => panel.semanticEdges));
    const entities = parseDxfEntities(entries.get(file.filename));
    assert.deepEqual(file.entityCounts, {
      circles: entities.filter((entity) => entity.type === "CIRCLE").length,
      closedOutlines: entities.filter((entity) => entity.type === "LWPOLYLINE").length,
      total: entities.length,
    });
  });
  assert.match(manifest.panelGeometrySha256, /^[0-9a-f]{64}$/);
  assert.equal(
    manifest.files.find((file) => file.filename === "sides-8W-7D-6H-12mm-x6.dxf")
      .representedPanels.length,
    2,
  );
});

test("manifest preserves measured families and approved production-rule provenance", () => {
  const bom = app.buildBom({ materialThicknessMm: 6, widthBoxes: 5, depthBoxes: 5, heightLevel: 2 });
  const exported = dxfExport.createSeparateDxfExport(bom, 1, 0.1);
  const front = exported.manifest.semanticPanels.find((panel) => panel.role === "front");
  const normalized = front.holes.filter(
    (hole) => hole.sourceRuleId === "front-back-2h-w5-w6-normalization",
  );
  assert.equal(normalized.length, 2);
  assert(normalized.every((hole) => hole.baseDiameterMm === 3));
  assert(normalized.every((hole) => hole.provenance === "approved-production-rule"));
  assert(normalized.every((hole) => hole.rawSourcePresent === false));
  assert(normalized.every(
    (hole) => hole.productionOverride === "add-missing-local-circle-at-12-6",
  ));
  assert.equal(
    normalized.filter((hole) => hole.repeatedPlacementTransform?.type === "x-reflection").length,
    1,
  );
  assert(front.holes.filter((hole) => hole.id.endsWith(":right")).every(
    (hole) => hole.sourcePlacement === "opposite-side-face-down-reflection"
      && hole.repeatedPlacementTransform.type === "x-reflection",
  ));

  const bottom = exported.manifest.semanticPanels.find((panel) => panel.role === "bottom");
  assert.deepEqual(bottom.holes.map((hole) => hole.centerMm), [
    [16, 16],
    [bottom.nominalPanelSizeMm[0] - 16, 16],
    [16, bottom.nominalPanelSizeMm[1] - 16],
    [bottom.nominalPanelSizeMm[0] - 16, bottom.nominalPanelSizeMm[1] - 16],
  ]);
  assert(bottom.holes.every((hole) => hole.baseDiameterMm === 3));
  assert(bottom.holes.every((hole) => hole.exportedDiameterMm === 3.1));
  assert(bottom.holes.every((hole) => hole.sourceRuleId === "bottom-four-corners-t-plus-10"));
  assert(bottom.holes.every((hole) => hole.provenance === "explicit-product-rule"));
  const lid = exported.manifest.semanticPanels.find((panel) => panel.role === "lid");
  assert(lid.holes.filter((hole) => hole.id.endsWith(":right")).every(
    (hole) => hole.sourcePlacement === "opposite-side-face-down-reflection"
      && hole.repeatedPlacementTransform.axisSpanMm === lid.nominalPanelSizeMm[0],
  ));
  const leftSide = exported.manifest.semanticPanels.find((panel) => panel.role === "left-side");
  assert(leftSide.holes.filter((hole) => hole.id.includes(":back:")).every(
    (hole) => hole.sourcePlacement === "back-edge-face-down-reflection"
      && hole.repeatedPlacementTransform.axisSpanMm === leftSide.nominalPanelSizeMm[0],
  ));
});

test("Separate export rejects cross-configuration or modified preview geometry", () => {
  const bom = app.buildBom({ materialThicknessMm: 6, widthBoxes: 5, depthBoxes: 5, heightLevel: 2 });
  const otherBom = app.buildBom({ materialThicknessMm: 7, widthBoxes: 5, depthBoxes: 5, heightLevel: 2 });
  const geometry = app.createPanelGeometry(bom, { clearanceDiameterMm: 0.1 });
  assert.throws(
    () => dxfExport.createSeparateDxfExport(otherBom, 1, geometry),
    /does not match this bill of materials/,
  );
  const modified = JSON.parse(JSON.stringify(geometry));
  modified.parts[0].holes[0].xMm += 0.25;
  assert.throws(
    () => dxfExport.createSeparateDxfExport(bom, 1, modified),
    /does not match this bill of materials/,
  );
  assert.equal(dxfExport.createSeparateDxfExport(bom, 1, geometry).geometry, geometry);
});

test("new browsers start with the 6 mm, 6W, 5D, 4H case configuration", () => {
  const expected = {
    materialThicknessMm: 6,
    widthBoxes: 6,
    depthBoxes: 5,
    heightLevel: 4,
  };
  assert.deepEqual(app.getDefaultConfig(), expected);
  assert.equal(app.loadPreferences({ getItem() { return null; } }), null);
  const controls = { innerHTML: "" };
  app.renderControls({
    getElementById(id) {
      assert.equal(id, "controls");
      return controls;
    },
  });
  for (const [key, value] of Object.entries(expected)) {
    assert.match(
      controls.innerHTML,
      new RegExp(`name="${key}"[^>]*value="${value}"[^>]*checked`),
    );
  }
});

test("saved version-1 preferences preserve configuration and default old DXF clearance", () => {
  const storage = {
    getItem() {
      return JSON.stringify({
        version: 1,
        config: { materialThicknessMm: 8, widthBoxes: 7, depthBoxes: 6, heightLevel: 4 },
        woodSheet: {
          caseSetCount: 2,
          sheetLengthMm: 1220,
          sheetWidthMm: 610,
          kerfMm: 2.5,
          allowRotation: false,
          cutThroughOnly: true,
        },
      });
    },
  };
  const preferences = app.loadPreferences(storage);
  assert.deepEqual(preferences.config, {
    materialThicknessMm: 8,
    widthBoxes: 7,
    depthBoxes: 6,
    heightLevel: 4,
  });
  assert.equal(preferences.woodSheet.sheetLengthMm, 1220);
  assert.equal(preferences.woodSheet.sheetWidthMm, 610);
  assert.equal(preferences.dxf.clearanceDiameterMm, 0.1);
});

test("clearance input treats a deliberate blank as invalid but a missing old control as default", () => {
  assert.throws(
    () => app.getHoleClearanceFromControls({
      getElementById() {
        return { value: "" };
      },
    }),
    /Hole diameter adjustment is required/,
  );
  assert.equal(app.getHoleClearanceFromControls({ getElementById() { return null; } }), 0.1);
});

test("stored ZIP output is deterministic, valid, and rejects unsafe names", () => {
  const files = [
    { filename: "alpha.txt", content: "abc" },
    { filename: "manifest.json", content: "{}\n" },
  ];
  const first = dxfExport.createStoredZip(files);
  const second = dxfExport.createStoredZip(files);
  assert.deepEqual(Buffer.from(first), Buffer.from(second));
  assert.deepEqual([...parseStoredZipEntries(first).keys()], ["alpha.txt", "manifest.json"]);
  assert.equal(dxfExport.crc32(dxfExport.encodeUtf8("abc")), 0x352441c2);
  assert.equal(
    dxfExport.sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.throws(
    () => dxfExport.createStoredZip([{ filename: "../escape.dxf", content: "" }]),
    /simple relative names/,
  );
  assert.throws(
    () => dxfExport.createStoredZip([
      { filename: "same.dxf", content: "" },
      { filename: "same.dxf", content: "" },
    ]),
    /Duplicate ZIP filename/,
  );
});

test("Cutting block shares layout settings and keeps saw and laser controls scoped", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
  const cuttingStart = html.indexOf('id="cutting-title"');
  const sharedStart = html.indexOf('class="cutting-settings"');
  const woodStart = html.indexOf('id="woodCuttingTool"');
  const dxfStart = html.indexOf('id="dxf-export-title"');
  const buildListStart = html.indexOf('id="step-export-title"');
  assert(cuttingStart >= 0 && sharedStart > cuttingStart);
  assert(woodStart > sharedStart && dxfStart > woodStart);
  assert(buildListStart > dxfStart, "both cutting tools precede build-list export");
  for (const id of ["caseSetCount", "sheetLengthMm", "sheetWidthMm", "sheetKerfMm", "allowPartRotation"]) {
    const matches = html.match(new RegExp(`id="${id}"`, "g")) || [];
    assert.equal(matches.length, 1, `${id} remains unique`);
    assert(html.indexOf(`id="${id}"`) > sharedStart && html.indexOf(`id="${id}"`) < woodStart, `${id} is shared`);
  }
  assert(html.indexOf('id="cutThroughOnly"') > woodStart && html.indexOf('id="cutThroughOnly"') < dxfStart);
  assert(html.indexOf('id="holeClearanceMm"') > dxfStart && html.indexOf('id="holeClearanceMm"') < buildListStart);
  assert.match(html, /<details id="woodCuttingTool" class="cutting-tool wood-sheet-panel">\s*<summary>/);
  assert.match(html, /<details id="laserCuttingTool" class="cutting-tool dxf-export-panel">\s*<summary>/);
  assert(!html.match(/id="(?:wood|laser)CuttingTool"[^>]*\sopen(?:\s|>)/), "both cutting tools start collapsed");
  assert.match(html, /id="downloadDxfFull"[^>]*aria-describedby="fullDxfDescription fullDxfSettings"[^>]*>Download full-sheet DXF ZIP</);
  assert.match(html, /id="downloadDxfSeparate"[^>]*aria-describedby="separateDxfDescription separateDxfSettings"[^>]*>Download separate-panel DXF ZIP</);
  assert.match(html, /class="dxf-export-options"[^>]*aria-label="DXF download options"/);
  assert.match(html, /<h3 id="full-dxf-title">Full sheets<\/h3>/);
  assert.match(html, /<h3 id="separate-dxf-title">Separate panels<\/h3>/);
  assert(html.indexOf('id="downloadDxfFull"') > dxfStart, "DXF controls stay inside the laser disclosure");
  assert(html.indexOf('id="downloadDxfFull"') < buildListStart);
  assert(html.indexOf('src="assets/js/dxf-export.js"') < html.indexOf('src="assets/js/app.js"'));
  assert.match(html, /Hole clearance \(diameter adjustment\)/);
  assert.match(html, /id="holeClearanceMm"[^>]*min="-1"[^>]*max="1"[^>]*step="0.01"[^>]*value="0.1"[^>]*aria-describedby="holeClearanceHelp"/);
  assert.match(html, /id="sheetKerfMm"[^>]*step="0.1"[^>]*aria-describedby="sheetGapHelp"/);
  assert.match(html, /ignores the saw-only <strong>Cut-through cuts only<\/strong>/);
  assert.match(html, /panel spacing for Full DXF \(minimum 0.10 mm\)/);
  assert.match(html, /CUT_HOLES_FIRST/);
  assert.match(html, /CUT_OUTLINES_LAST/);
  assert.match(html, /front-6W-5D-4H-6mm-xN\.dxf/);
  assert.match(html, /id="dxfExportStatus"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="dxfLaserPreview"[^>]*role="region"[^>]*aria-labelledby="full-dxf-preview-title"/);
  assert(!html.match(/id="dxfLaserPreview"[^>]*aria-live/));
  const css = readStyles();
  assert.match(css, /input:focus-visible,[\s\S]*?outline:\s*3px solid var\(--accent\)/);
  assert.match(css, /\.cutting-tool > summary\s*{[\s\S]*?min-height:\s*64px/);
  assert.match(css, /\.cutting-settings-grid input\[type="number"\]\s*{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.dxf-controls input\s*{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.cutting-settings-grid\s*{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media print[\s\S]*?\.dxf-export-panel\s*{\s*display:\s*none;/);
  assert.match(css, /@media print[\s\S]*?details\.wood-sheet-panel > \.cutting-tool-body\s*{\s*display:\s*block/);
  assert.match(appSource, /exposeLaserError = doc\.getElementById\("laserCuttingTool"\)\?\.open !== false/);
  assert.match(appSource, /setControlValidity\(doc, "sheetKerfMm", exposeLaserError &&/);
  assert.match(appSource, /getElementById\("laserCuttingTool"\)\?\.addEventListener\("toggle", updateApp\)/);
});

test("page follows the beginner-friendly workflow order", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const stepIds = [
    "step-configure-title",
    "step-review-title",
    "step-materials-title",
    "step-export-title",
  ];
  const positions = stepIds.map((id) => html.indexOf(`id="${id}"`));
  assert(positions.every((position) => position >= 0), "all four workflow steps are present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "workflow steps remain in order");
  assert(html.indexOf('id="bom"') < html.indexOf('id="cutting-title"'), "parts list precedes cutting");
  assert(html.indexOf('id="cutting-title"') < html.indexOf('id="wood-sheet-title"'), "Cutting introduces the tools");
  assert(html.indexOf('id="wood-sheet-title"') < html.indexOf('id="dxf-export-title"'), "sheet and DXF tools stay adjacent");
  assert(html.indexOf('id="dxf-export-title"') < html.indexOf('id="step-export-title"'), "cutting precedes build-list export");
  assert(html.indexOf('id="step-export-title"') < html.indexOf('id="export-title"'), "build-list controls follow their step");
});

test("vendored Three.js initializes the detailed viewer without network imports", () => {
  const context = { console: { log() {}, warn() {}, error() {} } };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js/drill-markers3d.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "assets/vendor/three.min.js"), "utf8"), context);
  assert(context.THREE);
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js/model3d.js"), "utf8"), context);
  assert.equal(typeof context.WOODCASE_3D.mount, "function");
  assert.equal(typeof context.WOODCASE_3D.getFastenerRenderPlan, "function");
  assert.equal(typeof context.WOODCASE_3D.getFrontHardwareLayout, "function");
  assert.equal(typeof context.WOODCASE_3D.formatCaseLabel, "function");
  assert.equal(typeof context.WOODCASE_3D.getHingeLayout, "function");
  assert.equal(typeof context.WOODCASE_3D.normalizeOrbitAngle, "function");
  assert.equal(typeof context.WOODCASE_3D.verifyFastenerAssembly, "function");
  assert.equal(typeof context.WOODCASE_3D.getFastenerManifest, "function");
  assert.equal(typeof context.WOODCASE_DRILL_MARKERS_3D.createDrillMarkerPlan, "function");
  const twoH = context.WOODCASE_3D.getFastenerManifest({ heightLevel: 2, hasHandle: false });
  const fourH = context.WOODCASE_3D.getFastenerManifest({ heightLevel: 4, hasHandle: true });
  assert.equal(twoH.primaryM3.total, 30);
  assert.equal(twoH.primaryM3.corners, 16);
  assert.equal(twoH.primaryM3.hinges, 8);
  assert.equal(twoH.primaryM3.lip, 2);
  assert.equal(twoH.primaryM3.lidLocks, 4);
  assert.equal(twoH.frameM3.total, 4);
  assert.equal(twoH.handleM4x50, 0);
  assert.equal(fourH.frameM3.total, 8);
  assert.equal(fourH.frameM3.handleMounts, 4);
  assert.equal(fourH.hingePinM3x40, 2);
  assert.equal(fourH.handleM4x50, 2);

  const plan = context.WOODCASE_3D.getFastenerRenderPlan({ heightLevel: 4, hasHandle: true });
  assert.equal(plan.length, 42, "30 primary + 8 frame + 2 hinge pins + 2 handle bolts");
  const fakeScene = {
    traverse(visitor) {
      for (const entry of plan) visitor({ userData: { fastener: entry.fastener } });
    },
  };
  const builtCounts = context.WOODCASE_3D.verifyFastenerAssembly(fakeScene, { heightLevel: 4, hasHandle: true });
  assert.equal(builtCounts["primaryM3:corners"], 16);
  assert.throws(
    () => context.WOODCASE_3D.verifyFastenerAssembly({ traverse() {} }, { heightLevel: 4, hasHandle: true }),
    /fastener count mismatch/,
  );
  const source = fs.readFileSync(path.join(root, "assets/js/model3d.js"), "utf8");
  const markerBom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 6, depthBoxes: 5, heightLevel: 3 });
  const markerGeometry = app.createPanelGeometry(markerBom);
  const markerPlan = context.WOODCASE_DRILL_MARKERS_3D.createDrillMarkerPlan(
    markerGeometry,
    markerBom.dimensions,
  );
  assert.equal(markerPlan.length, 42);
  assert.equal(markerPlan.filter((marker) => marker.role === "bottom").length, 4);
  assert(markerPlan.filter((marker) => marker.role === "bottom").every((marker) => !marker.fastener));
  assert.match(source, /this\.buildDrillMarkers\(this\.panelGeometry, d\)/);
  assert.match(source, /this\.fastenerCounts = verifyFastenerAssembly\(this\.caseGroup, config\)/);
  assert.match(source, /this\.chamferedUHandle\(/);
  assert.match(source, /this\.socketBolt\(parent, x, topY,/);
  assert.equal(context.WOODCASE_3D.formatCaseLabel({
    materialThicknessMm: 7,
    widthBoxes: 6,
    depthBoxes: 5,
    heightLevel: 4,
  }), "7mm 6x5 4H");

  const frontHardwareSource = source.slice(
    source.indexOf("  buildFrontHardware("),
    source.indexOf("  buildHinges("),
  );
  const lidSource = source.slice(
    source.indexOf("  buildLid("),
    source.indexOf("  rebuild("),
  );
  assert(!frontHardwareSource.includes("primaryM3:lidLocks"), "lid-lock fasteners never belong to the wooden front");
  assert.match(frontHardwareSource, /front-lock:fixed-rail/);
  assert.match(frontHardwareSource, /front-lock:screwless-slider-shell/);
  assert.match(frontHardwareSource, /handle:wide-visible-screw-mount/);
  assert.match(frontHardwareSource, /frameM3:lockToFrame/);
  assert.match(lidSource, /lid-lock:horizontal-mounted-leaf/);
  assert.match(lidSource, /lid-lock:narrow-attached-front-drop/);
  assert(!lidSource.includes("lid-lock:elbow"), "lid L bracket has no extra connector mesh");
  assert.match(lidSource, /"top", "primaryM3:lidLocks"/);
  assert(!lidSource.match(/"front", "primaryM3:lidLocks"/));

  for (const t of [6, 12]) {
    for (const W of [5, 8]) {
      for (const H of [3, 4, 5, 6]) {
        const bom = app.buildBom({ materialThicknessMm: t, widthBoxes: W, depthBoxes: 6, heightLevel: H });
        const layout = context.WOODCASE_3D.getFrontHardwareLayout(bom.configuration, bom.dimensions, t);
        const labelTop = layout.labelCenterY + layout.labelHeight / 2;
        const upperBracketBottom = bom.dimensions.sideHeightMm + layout.lidLockDropCenterY - layout.lidLockDropHeight / 2;
        const lowerLockTop = layout.latchY + layout.lockHeight / 2;
        const lowerLockBottom = layout.latchY - layout.lockHeight / 2;
        const handleMountTop = layout.handleTopY + 10;
        const frontHardwareZ = bom.dimensions.bottomHeightMm / 2 + t / 2 + 3.2;
        const sliderBackZ = frontHardwareZ + layout.lockShellFrontOffset - layout.lockShellDepth / 2;
        const lidDropCenterZ = -bom.dimensions.bottomHeightMm / 2 + bom.dimensions.lidHeightMm + t / 2 + 2.5;
        const lidDropFrontZ = lidDropCenterZ + layout.lidLockDropDepth / 2;
        const lidLeafFrontLocalZ = bom.dimensions.lidHeightMm - 7 + layout.lidLockLeafDepth / 2;
        const lidDropBackLocalZ = bom.dimensions.lidHeightMm + t / 2 + 2.5 - layout.lidLockDropDepth / 2;
        const lidLeafBottomLocalY = layout.lidLockLeafCenterY - layout.lidLockLeafHeight / 2;
        const lidDropTopLocalY = layout.lidLockDropCenterY + layout.lidLockDropHeight / 2;
        const verticalCornerOverlap = lidDropTopLocalY - lidLeafBottomLocalY;
        const depthCornerOverlap = lidLeafFrontLocalZ - lidDropBackLocalZ;
        assert.equal(layout.handleTopY, bom.dimensions.frontBackHeightMm / 2, `centered handle pivots for ${H}H`);
        assert.equal(layout.labelCenterY, layout.handleTopY, `label centered on handle pivot for ${H}H`);
        assert(layout.handleGeometryCenterY + layout.handleHeight / 2 > layout.handleTopY, `handle passes above centered pivot for ${H}H`);
        assert(lowerLockTop > upperBracketBottom, `front slider engages lid drop for ${t}mm ${H}H`);
        assert(sliderBackZ < lidDropFrontZ, `front slider physically overlaps lid drop depth for ${t}mm ${H}H`);
        assert(lidLeafFrontLocalZ >= lidDropBackLocalZ, `two-piece lid L bracket meets directly without connector for ${t}mm ${H}H`);
        assert(lidDropTopLocalY >= lidLeafBottomLocalY, `narrow lid drop physically attaches to top leaf for ${t}mm ${H}H`);
        assert(verticalCornerOverlap >= layout.lidLockCornerOverlap, `lid lock L remains joined through vertical bevel for ${t}mm ${H}H`);
        assert(depthCornerOverlap >= layout.lidLockCornerOverlap, `lid lock L remains joined through depth bevel for ${t}mm ${H}H`);
        assert.equal(layout.lidLockDropWidth, 22, `front-facing lid drop is half its previous width for ${t}mm ${H}H`);
        assert(lowerLockBottom > handleMountTop, `front slider clears handle mounts for ${t}mm ${H}H`);
        const sliderInnerHalfWidth = (layout.lockWidth - layout.lockShellBar * 2) / 2;
        const shiftedRailExtent = layout.lockRailWidth / 2 + layout.lockSliderOffset;
        assert(sliderInnerHalfWidth >= shiftedRailExtent, `outward-offset slider still surrounds rail for ${t}mm ${H}H`);
        assert(sliderInnerHalfWidth - shiftedRailExtent <= 2, `rail visibly sits near one end of slider for ${t}mm ${H}H`);
        assert(layout.handleMountScrewOffset - 3.15 > layout.handleBar / 2, `handle bar clears both visible mount screws for ${t}mm ${H}H`);
        assert(labelTop < layout.lipBottomY, `label/lip clearance for ${t}mm ${W}W ${H}H`);
        assert(layout.handleWidth / 2 - layout.handleBar / 2 > layout.lipWidth / 2 + 5, `handle/lip clearance for ${W}W ${H}H`);
        assert(layout.latchOffset - layout.lockWidth / 2 > layout.lipWidth / 2 + 5, `lock/lip clearance for ${W}W ${H}H`);
        if (H >= 4) {
          assert.equal(layout.handleWidth, 154);
          assert.equal(layout.handleHeight, 46);
        }
      }
    }
  }


  for (const t of [6, 12]) {
    const hingeBom = app.buildBom({ materialThicknessMm: t, widthBoxes: 6, depthBoxes: 5, heightLevel: 4 });
    const hinge = context.WOODCASE_3D.getHingeLayout(hingeBom.dimensions, t);
    assert.equal(hinge.axisY, hingeBom.dimensions.sideHeightMm - 1.5);
    assert.equal(hinge.axisZ, hinge.backZ - 2);
    assert.equal(hinge.axisY + hinge.assemblyOffsetY, hingeBom.dimensions.sideHeightMm, "closed lid keeps its original vertical datum");
    assert.equal(hinge.axisZ + hinge.assemblyOffsetZ, -hingeBom.dimensions.bottomHeightMm / 2, "closed lid keeps its original rear edge");
    const fixedLeafTopY = hinge.fixedLeafCenterY + hinge.fixedLeafHeight / 2;
    assert.equal(hingeBom.dimensions.sideHeightMm - fixedLeafTopY, 2, `rear hinge leaf starts just below pin for ${t}mm`);
    assert(fixedLeafTopY - hinge.fixedScrewY >= 16, `rear screws sit farther from panel edge for ${t}mm`);
    assert.equal(hinge.movingLeafCenterY - hinge.movingLeafHeight / 2, 0, `moving hinge leaf starts on lid top for ${t}mm`);
    assert.equal(hinge.movingLeafTopY, hinge.movingLeafHeight, `hinge screws sit on moving leaf top for ${t}mm`);
    const movingLeafBackZ = hinge.movingLeafCenterZ - hinge.movingLeafDepth / 2;
    const pinFrontZInLidCoordinates = -hinge.assemblyOffsetZ + 3.1;
    assert(movingLeafBackZ < pinFrontZInLidCoordinates, `moving leaf visibly meets hinge pin for ${t}mm`);
    assert(hinge.movingScrewZ >= 16, `lid screws sit farther from rear edge for ${t}mm`);
  }
  assert.match(source, /hinge:fixed-back-leaf/);
  assert.match(source, /hinge:moving-lid-top-leaf/);
  assert(Math.abs(context.WOODCASE_3D.normalizeOrbitAngle(Math.PI * 1.5) + Math.PI / 2) < 1e-9, "full orbit wraps instead of clamping");

  assert(!source.includes("THREE.MathUtils.clamp(this.pitch"), "detailed viewer does not clamp underside rotation");
  const previewSource = fs.readFileSync(path.join(root, "assets/js/preview.js"), "utf8");
  assert(!previewSource.includes("Math.max(-1.1, Math.min(0.65"), "SVG fallback does not clamp underside rotation");
});

test("preview dimensions use one collapsible block with panels and callouts together", () => {
  const bom = app.buildBom({ materialThicknessMm: 12, widthBoxes: 6, depthBoxes: 5, heightLevel: 3 });
  const panel = { open: false };
  const content = { innerHTML: "" };
  const doc = {
    getElementById(id) {
      return id === "modelDimensions" ? panel : id === "modelDimensionsContent" ? content : null;
    },
  };

  app.renderModelDimensions(bom.configuration, bom, doc);

  assert.equal(panel.open, true);
  assert.match(content.innerHTML, /<div class="dimension-callouts">/);
  assert.equal((content.innerHTML.match(/class="dimension-callout"/g) || []).length, 2);
  assert.match(content.innerHTML, /55 × 55 mm ModuBOX grid/);
  assert.match(content.innerHTML, /6 × 5 cells/);
  assert.match(content.innerHTML, /Recessed lid construction/);
  assert.match(content.innerHTML, /lid fits between the side panels/i);
  assert.match(content.innerHTML, /top is flush with the side-panel tops/i);
  assert.match(content.innerHTML, /class="panel-dimensions-heading">Wood panels/);
  assert.match(content.innerHTML, /Front \/ back ×2/);
  assert(!content.innerHTML.includes("<details"), "wood panels have no nested disclosure");
  assert(!content.innerHTML.includes("Computed wood panels"));

  const css = readStyles();
  assert.match(css, /\.model-dimensions\s*>\s*summary\s*{/);
  assert.match(css, /\.dimension-callouts\s*{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?\.dimension-callouts\s*{[^}]*grid-template-columns:\s*1fr/s);
});

test("formula disclosure uses hover on desktop but keeps taps on touch devices", () => {
  const desktopMatchMedia = () => ({ matches: true });
  const touchMatchMedia = () => ({ matches: false });
  assert.equal(app.usesHoverOnlyFormulaDisclosure(desktopMatchMedia), true);
  assert.equal(app.usesHoverOnlyFormulaDisclosure(touchMatchMedia), false);

  let desktopPrevented = false;
  let desktopOpenRemoved = false;
  app.handleFormulaDisclosureClick({
    preventDefault() { desktopPrevented = true; },
    currentTarget: { parentElement: { removeAttribute(name) { desktopOpenRemoved = name === "open"; } } },
  }, desktopMatchMedia);
  assert.equal(desktopPrevented, true);
  assert.equal(desktopOpenRemoved, true);

  let touchPrevented = false;
  app.handleFormulaDisclosureClick({
    preventDefault() { touchPrevented = true; },
    currentTarget: { parentElement: { removeAttribute() {} } },
  }, touchMatchMedia);
  assert.equal(touchPrevented, false);

  const attributes = new Set();
  const details = {
    setAttribute(name) { attributes.add(name); },
    removeAttribute(name) { attributes.delete(name); },
  };
  app.setFormulaDisclosureOpen(details, true, desktopMatchMedia);
  assert.equal(attributes.has("open"), true, "desktop mouseenter opens the tooltip");
  app.setFormulaDisclosureOpen(details, false, desktopMatchMedia);
  assert.equal(attributes.has("open"), false, "desktop mouseleave closes the tooltip");

  app.setFormulaDisclosureOpen(details, true, touchMatchMedia);
  assert.equal(attributes.has("open"), false, "touch state remains controlled by native tap behavior");
});

test("all supported sheet layouts preserve bounds and selected kerf spacing", () => {
  const { materialThicknessMm, widthBoxes, depthBoxes, heightLevel } = app.catalog.parameters;
  const optionMatrix = [1, 6].flatMap((caseSetCount) =>
    [false, true].flatMap((allowRotation) =>
      [false, true].map((cutThroughOnly) => ({
        caseSetCount,
        sheetLengthMm: 1000,
        sheetWidthMm: 500,
        kerfMm: 3,
        allowRotation,
        cutThroughOnly,
      })),
    ),
  );
  let checkedPlans = 0;
  for (const t of materialThicknessMm.values) {
    for (const W of widthBoxes.values) {
      for (const D of depthBoxes.values) {
        for (const H of heightLevel.values) {
          const bom = app.buildBom({
            materialThicknessMm: t,
            widthBoxes: W,
            depthBoxes: D,
            heightLevel: H,
          });
          for (const options of optionMatrix) {
            const context = [
              `${t}mm`,
              `${W}x${D}`,
              `${H}H`,
              `${options.caseSetCount}sets`,
              options.allowRotation ? "rotate" : "fixed",
              options.cutThroughOnly ? "cut-through" : "compact",
            ].join("/");
            assertSheetPlanBoundsAndKerf(app.calculateWoodSheetPlan(bom, options), context);
            checkedPlans += 1;
          }
        }
      }
    }
  }
  assert.equal(checkedPlans, 3360);
});

test("compact planner preserves kerf in the known overlapping-free-rectangle repro", () => {
  const bom = app.buildBom({
    materialThicknessMm: 6,
    widthBoxes: 5,
    depthBoxes: 7,
    heightLevel: 4,
  });
  const plan = app.calculateWoodSheetPlan(bom, {
    caseSetCount: 6,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    kerfMm: 3,
    allowRotation: true,
    cutThroughOnly: false,
  });
  assertSheetPlanBoundsAndKerf(plan, "compact kerf repro");
});

test("cut-through planning groups matching strips and emits a usable cut order", () => {
  const bom = app.buildBom({ materialThicknessMm: 9, widthBoxes: 7, depthBoxes: 5, heightLevel: 2 });
  const plan = app.calculateWoodSheetPlan(bom, {
    caseSetCount: 4,
    sheetLengthMm: 1000,
    sheetWidthMm: 500,
    kerfMm: 3,
    allowRotation: true,
    cutThroughOnly: true,
  });

  assert.equal(plan.success, true);
  assert.equal(plan.sheetCount, 3, "cut optimization does not add a sheet");
  assert(plan.cutCount < 48, "matching strips need fewer cuts than isolating all 24 pieces twice");
  assert.equal(plan.sheets.flatMap((sheet) => sheet.placements).length, 24);

  const batchCuts = plan.sheets.flatMap((sheet) => sheet.cutPlan.filter((cut) => cut.kind === "batch"));
  const frontBackMarks = new Set(batchCuts.flatMap((cut) => cut.marks).filter((mark) => /^[34]/.test(mark)));
  assert.deepEqual(
    [...frontBackMarks].sort(),
    ["3a", "3b", "3c", "3d", "4a", "4b", "4c", "4d"],
    "all matching front/back panels are cut from grouped strips",
  );
  assert(batchCuts.some((cut) => cut.count >= 3), "a grouped operation replaces several individual cuts");

  for (const sheet of plan.sheets) {
    assert.deepEqual(sheet.cutPlan.map((cut) => cut.step), sheet.cutPlan.map((_cut, index) => index + 1));
    for (const cut of sheet.cutPlan) {
      for (const line of cut.lines) {
        const coordinateLimit = line.orientation === "vertical" ? plan.sheetLengthMm : plan.sheetWidthMm;
        const spanLimit = line.orientation === "vertical" ? plan.sheetWidthMm : plan.sheetLengthMm;
        assert(line.coordinate >= 0 && line.coordinate <= coordinateLimit);
        assert(line.from >= 0 && line.to <= spanLimit && line.from <= line.to);
      }
    }
    const svg = app.renderSheetLayoutSvg(sheet, plan);
    assert.match(svg, /class="sheet-cut-line/);
    assert.match(svg, /class="sheet-cut-number"/);
  }
});

test("cut guidelines use informational blue instead of error red", () => {
  const css = readStyles();
  const cutStyles = css.slice(css.indexOf(".sheet-cut-line"), css.indexOf(".bom {"));
  assert.match(cutStyles, /#447fbd/);
  assert.match(cutStyles, /#356fa9/);
  assert(!cutStyles.includes("#b42318"));
});
