const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = require(path.join(root, "assets/js/app.js"));
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
    "assets/vendor/three.min.js",
    "assets/js/model3d.js",
    "assets/js/core.js",
    "assets/js/preview.js",
    "assets/js/sheet-planner.js",
    "assets/js/renderers.js",
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

  for (const file of ["catalog.js", "core.js", "preview.js", "sheet-planner.js", "renderers.js", "app.js"]) {
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
    "app.js": 400,
    "catalog.js": 400,
    "core.js": 550,
    "model3d.js": 850,
    "preview.js": 400,
    "renderers.js": 400,
    "sheet-planner.js": 800,
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
  assert(html.indexOf('id="bom"') < html.indexOf('id="wood-sheet-title"'), "parts list precedes sheet planning");
  assert(html.indexOf('id="wood-sheet-title"') < html.indexOf('id="export-title"'), "export follows material planning");
});

test("vendored Three.js initializes the detailed viewer without network imports", () => {
  const context = { console: { log() {}, warn() {}, error() {} } };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
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
