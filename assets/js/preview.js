(function (root, factory) {
  let core = root.WOODCASE_CORE;
  let panelGeometry = root.WOODCASE_PANEL_GEOMETRY;
  if (typeof module === "object" && module.exports) {
    core = require("./core.js");
    panelGeometry = require("./panel-geometry.js");
    module.exports = factory(core, panelGeometry);
  } else {
    root.WOODCASE_PREVIEW = factory(core, panelGeometry);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, panelGeometry) {
  "use strict";

  if (!core || !panelGeometry) throw new Error("Preview dependencies are required");
  const { buildBom, escapeHtml, normalizeOrbitAngle } = core;

  function renderPreviewSvg(configInput, bomInput, geometryInput) {
    const bom = bomInput || buildBom(configInput);
    const config = bom.configuration;
    const d = bom.dimensions;
    const t = config.materialThicknessMm;
    const geometry = geometryInput || panelGeometry.createPanelGeometry(bom);

    function defs(id) {
      return `<defs><marker id="${id}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" class="dimension-arrow"/></marker><pattern id="grid-${id}" width="55" height="55" patternUnits="userSpaceOnUse"><path d="M 55 0 L 0 0 0 55" class="modubox-grid-line"/></pattern></defs>`;
    }

    function dimension(x1, y1, x2, y2, label, markerId, textX, textY, anchor) {
      const transform = x1 === x2 ? ` transform="rotate(-90 ${textX} ${textY})"` : "";
      return [
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dimension-line" marker-start="url(#${markerId})" marker-end="url(#${markerId})"/>`,
        `<text x="${textX}" y="${textY}" class="dimension-label" text-anchor="${anchor || "middle"}"${transform}>${escapeHtml(label)}</text>`,
      ].join("");
    }

    const topScale = Math.min(310 / d.bottomWidthMm, 205 / d.bottomHeightMm);
    const topW = d.bottomWidthMm * topScale;
    const topD = d.bottomHeightMm * topScale;
    const gridW = config.widthBoxes * 55 * topScale;
    const gridD = config.depthBoxes * 55 * topScale;
    const topX = (420 - topW) / 2;
    const topY = 42;
    const gridX = topX + t * topScale;
    const gridY = topY + t * topScale;
    const topSvg = [
      `<svg class="flat-view-svg" viewBox="0 0 420 320" role="img" aria-label="Top interior view with ModuBOX grid">`, defs("top-arrow"),
      `<rect x="${topX}" y="${topY}" width="${topW}" height="${topD}" class="wood-panel"/>`,
      `<rect x="${gridX}" y="${gridY}" width="${gridW}" height="${gridD}" class="grid-floor"/>`,
      ...Array.from({ length: config.widthBoxes + 1 }, (_v, index) => `<line x1="${gridX + index * 55 * topScale}" y1="${gridY}" x2="${gridX + index * 55 * topScale}" y2="${gridY + gridD}" class="modubox-grid-line"/>`),
      ...Array.from({ length: config.depthBoxes + 1 }, (_v, index) => `<line x1="${gridX}" y1="${gridY + index * 55 * topScale}" x2="${gridX + gridW}" y2="${gridY + index * 55 * topScale}" class="modubox-grid-line"/>`),
      `<text x="210" y="${gridY + gridD / 2}" class="grid-label">${config.widthBoxes} × ${config.depthBoxes} cells</text>`,
      dimension(topX, topY + topD + 24, topX + topW, topY + topD + 24, `${config.widthBoxes} boxes · ${config.widthBoxes * 55} mm grid · ${d.bottomWidthMm} mm overall`, "top-arrow", 210, topY + topD + 48),
      dimension(topX - 22, topY, topX - 22, topY + topD, `${config.depthBoxes} boxes / ${config.depthBoxes * 55} mm`, "top-arrow", topX - 30, topY + topD / 2, "middle"),
      `</svg>`,
    ].join("");

    const frontScale = Math.min(325 / d.bottomWidthMm, 130 / d.sideHeightMm);
    const outerFrontW = d.bottomWidthMm * frontScale;
    const frontH = d.sideHeightMm * frontScale;
    const frontX = (420 - outerFrontW) / 2;
    const frontY = 45;
    const panelX = frontX + t * frontScale;
    const panelY = frontY + (d.sideHeightMm - d.frontBackHeightMm) * frontScale;
    const panelW = d.frontBackLengthMm * frontScale;
    const panelH = d.frontBackHeightMm * frontScale;
    const latchOffset = Math.min(panelW * 0.31, 95);
    const handleWidth = Math.min(138, panelW * 0.48);
    const screwDot = (x, y, feature) => `<circle cx="${x}" cy="${y}" r="2.4" class="flat-fastener"${feature ? ` data-fastener="${feature}"` : ""}/>`;
    const flatLock = (centerX) => {
      const direction = Math.sign(centerX - 210) || 1;
      const baseWidth = 42;
      const baseHeight = 9;
      const lipWidth = 24;
      const lipHeight = 14;
      const shellWidth = 48;
      const shellHeight = 18;
      const railWidth = 29;
      const baseY = frontY - 5;
      const lipCenterX = centerX - direction * (baseWidth - lipWidth) / 2;
      const lipY = frontY + 1;
      const sliderCenterX = centerX + direction * 4;
      const sliderY = panelY + 2;
      const railY = sliderY + (shellHeight - 7) / 2;
      return [
        `<g data-feature="flat-top-lock">`,
        `<rect x="${centerX - baseWidth / 2}" y="${baseY}" width="${baseWidth}" height="${baseHeight}" rx="3" class="printed-part flat-lock-lid-base"/>`,
        `<rect x="${lipCenterX - lipWidth / 2}" y="${lipY}" width="${lipWidth}" height="${lipHeight}" rx="3" class="printed-part flat-lock-lip"/>`,
        `<rect x="${centerX - railWidth / 2}" y="${railY}" width="${railWidth}" height="7" rx="2" class="flat-lock-rail"/>`,
        screwDot(centerX - railWidth * 0.27, railY + 3.5, "lock-rail"),
        screwDot(centerX + railWidth * 0.27, railY + 3.5, "lock-rail"),
        `<rect x="${sliderCenterX - shellWidth / 2}" y="${sliderY}" width="${shellWidth}" height="${shellHeight}" rx="4" class="flat-slider-shell"/>`,
        `</g>`,
      ].join("");
    };
    const handle = config.hasHandle
      ? (() => {
        const pivotY = panelY + panelH / 2;
        const halfWidth = handleWidth / 2;
        const handleDrop = Math.min(40, Math.max(24, panelH * 0.42));
        const verticalRun = Math.max(7, handleDrop * 0.28);
        const diagonalDrop = handleDrop - verticalRun;
        const diagonalInset = diagonalDrop;
        const mountWidth = 28;
        const mountHeight = 18;
        const labelWidth = handleWidth * 0.64;
        const labelHeight = 16;
        const label = `${config.materialThicknessMm}mm ${config.widthBoxes}x${config.depthBoxes} ${config.heightLevel}H`;
        const mount = (x) => [
          `<g data-feature="flat-handle-mount">`,
          `<rect x="${x - mountWidth / 2}" y="${pivotY - mountHeight / 2}" width="${mountWidth}" height="${mountHeight}" rx="4" class="printed-part"/>`,
          screwDot(x - 8, pivotY, "handle-mount"),
          screwDot(x + 8, pivotY, "handle-mount"),
          `</g>`,
        ].join("");
        return [
          `<g data-feature="handle">`,
          `<rect x="${210 - labelWidth / 2}" y="${pivotY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="3" class="printed-part label-plate"/>`,
          `<text x="210" y="${pivotY + 3}" class="flat-hardware-label">${escapeHtml(label)}</text>`,
          mount(210 - halfWidth),
          mount(210 + halfWidth),
          `<polyline points="${210 - halfWidth},${pivotY} ${210 - halfWidth},${pivotY + verticalRun} ${210 - halfWidth + diagonalInset},${pivotY + handleDrop} ${210 + halfWidth - diagonalInset},${pivotY + handleDrop} ${210 + halfWidth},${pivotY + verticalRun} ${210 + halfWidth},${pivotY}" class="handle-curve flat-chamfered-handle"/>`,
          `</g>`,
        ].join("");
      })()
      : `<text x="210" y="${panelY + panelH * 0.62}" class="svg-note svg-centered" data-feature="no-handle">2H — no handle</text>`;
    const frontSvg = [
      `<svg class="flat-view-svg" viewBox="0 0 420 270" role="img" aria-label="Front assembly elevation">`, defs("front-arrow"),
      `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" class="wood-panel"/>`,
      `<rect x="${frontX}" y="${frontY}" width="${Math.max(8, t * frontScale)}" height="${frontH}" rx="3" class="printed-part corner-rail"/>`,
      `<rect x="${frontX + outerFrontW - Math.max(8, t * frontScale)}" y="${frontY}" width="${Math.max(8, t * frontScale)}" height="${frontH}" rx="3" class="printed-part corner-rail"/>`,
      flatLock(210 - latchOffset),
      flatLock(210 + latchOffset),
      `<rect x="165" y="${panelY - 7}" width="90" height="16" rx="3" class="printed-part"/>`,
      handle,
      dimension(frontX, frontY + frontH + 25, frontX + outerFrontW, frontY + frontH + 25, `${config.widthBoxes} boxes · ${d.bottomWidthMm} mm overall`, "front-arrow", 210, frontY + frontH + 49),
      dimension(frontX - 20, frontY, frontX - 20, frontY + frontH, `${config.heightLevel}H · ${d.sideHeightMm} mm`, "front-arrow", frontX - 28, frontY + frontH / 2),
      `</svg>`,
    ].join("");

    const sideScale = Math.min(315 / d.bottomHeightMm, 130 / d.sideHeightMm);
    const sideW = d.bottomHeightMm * sideScale;
    const sideH = d.sideHeightMm * sideScale;
    const sideX = (420 - sideW) / 2;
    const sideY = 45;
    const sideSvg = [
      `<svg class="flat-view-svg" viewBox="0 0 420 270" role="img" aria-label="Side assembly elevation">`, defs("side-arrow"),
      `<rect x="${sideX}" y="${sideY}" width="${sideW}" height="${sideH}" class="wood-panel"/>`,
      `<rect x="${sideX}" y="${sideY}" width="12" height="${sideH}" rx="3" class="printed-part"/>`,
      `<rect x="${sideX + sideW - 12}" y="${sideY}" width="12" height="${sideH}" rx="3" class="printed-part"/>`,
      `<line x1="${sideX}" y1="${sideY + sideH - t * sideScale}" x2="${sideX + sideW}" y2="${sideY + sideH - t * sideScale}" class="assembly-seam"/>`,
      dimension(sideX, sideY + sideH + 25, sideX + sideW, sideY + sideH + 25, `${config.depthBoxes} boxes · ${d.bottomHeightMm} mm overall`, "side-arrow", 210, sideY + sideH + 49),
      dimension(sideX - 20, sideY, sideX - 20, sideY + sideH, `${config.heightLevel}H · ${d.sideHeightMm} mm`, "side-arrow", sideX - 28, sideY + sideH / 2),
      `</svg>`,
    ].join("");

    const panels = geometry.parts.map((part, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const cellX = 22 + col * 266;
      const cellY = 28 + row * 250;
      const scale = Math.min(210 / part.widthMm, 165 / part.heightMm);
      const width = part.widthMm * scale;
      const height = part.heightMm * scale;
      const holes = part.holes.map((hole) => [
        `<circle class="panel-cut-hole"`,
        ` data-role="${part.role}" data-hole-id="${hole.id}"`,
        ` data-x-mm="${hole.xMm}" data-y-mm="${hole.yMm}" data-diameter-mm="${hole.diameterMm}"`,
        ` cx="${cellX + hole.xMm * scale}" cy="${cellY + 18 + (part.heightMm - hole.yMm) * scale}"`,
        ` r="${hole.diameterMm * scale / 2}"/>`,
      ].join("")).join("");
      return [
        `<text x="${cellX}" y="${cellY}" class="panel-title">${escapeHtml(part.label)} ×1 · ${part.holes.length} holes</text>`,
        `<rect x="${cellX}" y="${cellY + 18}" width="${width}" height="${height}" class="wood-panel"/>`,
        holes,
        `<text x="${cellX}" y="${cellY + height + 42}" class="panel-size">${part.widthMm} × ${part.heightMm} × ${part.thicknessMm} mm</text>`,
      ].join("");
    }).join("");
    const clearance = geometry.clearanceDiameterMm;
    const clearanceLabel = `${clearance >= 0 ? "+" : ""}${clearance.toFixed(2)} mm`;
    const panelsSvg = `<svg class="flat-view-svg panels-svg" viewBox="0 0 816 530" role="img" aria-label="Dimensioned wooden panels with exact drill holes">${panels}<text x="408" y="516" class="flat-note">Nominal finished outlines · ${geometry.holeCount} holes · ${clearanceLabel} diametral hole adjustment · no laser kerf compensation</text></svg>`;

    return [
      `<div class="flat-preview-heading"><div><h3>Flat assembly views</h3><p>Dimensioned views use the same formulas as the BOM.</p></div><span>${config.widthBoxes}W × ${config.depthBoxes}D × ${config.heightLevel}H · ${t} mm material</span></div>`,
      `<div class="flat-preview-grid">`,
      `<article class="flat-view-card"><h3>Interior grid</h3>${topSvg}</article>`,
      `<article class="flat-view-card"><h3>Front assembly</h3>${frontSvg}</article>`,
      `<article class="flat-view-card"><h3>Side assembly</h3>${sideSvg}</article>`,
      `<article class="flat-view-card flat-view-card-wide"><h3>Wood panels and drill holes</h3>${panelsSvg}</article>`,
      `</div>`,
    ].join("");
  }

  function rotatePoint(point, yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const x1 = point.x * cy + point.z * sy;
    const z1 = -point.x * sy + point.z * cy;
    const y1 = point.y;
    return {
      x: x1,
      y: y1 * cp - z1 * sp,
      z: y1 * sp + z1 * cp,
    };
  }

  function renderModel3dSvg(configInput, bomInput, viewInput) {
    const bom = bomInput || buildBom(configInput);
    const config = bom.configuration;
    const d = bom.dimensions;
    const view = viewInput || { yaw: -0.62, pitch: -0.38, open: true };
    const width = d.bottomWidthMm;
    const depth = d.bottomHeightMm;
    const height = d.sideHeightMm;
    const scale = Math.min(360 / width, 280 / depth, 260 / height);
    const cx = 450;
    const cy = 285;

    function project(point) {
      const rotated = rotatePoint(point, view.yaw, view.pitch);
      return {
        x: cx + rotated.x * scale,
        y: cy - rotated.y * scale,
        z: rotated.z,
      };
    }

    function pt(x, y, z) {
      return { x, y, z };
    }

    const hw = width / 2;
    const hd = depth / 2;
    const hh = height / 2;
    const lidAngle = view.open ? Math.PI * 0.58 : 0;

    function lidPoint(x, z) {
      const relativeZ = z - hd;
      return pt(
        x,
        hh - relativeZ * Math.sin(lidAngle),
        hd + relativeZ * Math.cos(lidAngle),
      );
    }

    const lidCenter = lidPoint(0, 0);
    const faces = [
      {
        id: "front",
        label: "Front panel",
        points: [pt(-hw, -hh, -hd), pt(hw, -hh, -hd), pt(hw, hh, -hd), pt(-hw, hh, -hd)],
        className: "model-face model-front",
      },
      {
        id: "back",
        label: "Back panel",
        points: [pt(hw, -hh, hd), pt(-hw, -hh, hd), pt(-hw, hh, hd), pt(hw, hh, hd)],
        className: "model-face model-back",
      },
      {
        id: "left",
        label: "Left side panel",
        points: [pt(-hw, -hh, hd), pt(-hw, -hh, -hd), pt(-hw, hh, -hd), pt(-hw, hh, hd)],
        className: "model-face model-side",
      },
      {
        id: "right",
        label: "Right side panel",
        points: [pt(hw, -hh, -hd), pt(hw, -hh, hd), pt(hw, hh, hd), pt(hw, hh, -hd)],
        className: "model-face model-side",
      },
      {
        id: "bottom",
        label: "Bottom panel",
        points: [pt(-hw, -hh, hd), pt(hw, -hh, hd), pt(hw, -hh, -hd), pt(-hw, -hh, -hd)],
        className: "model-face model-bottom",
      },
      {
        id: "lid",
        label: "Lid panel",
        points: [lidPoint(-hw, -hd), lidPoint(hw, -hd), lidPoint(hw, hd), lidPoint(-hw, hd)],
        className: "model-face model-lid",
      },
    ];

    function faceDepth(face) {
      return face.points.reduce((sum, point) => sum + project(point).z, 0) / face.points.length;
    }

    function polygon(face) {
      const points = face.points.map(project);
      const pointText = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
      return `<polygon points="${pointText}" class="${face.className}" data-panel="${face.id}"/>`;
    }

    function labelFor(name, point, className) {
      const p = project(point);
      return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" class="${className || "model-label"}">${escapeHtml(name)}</text>`;
    }

    function hardwareLabel(name, point) {
      const p = project(point);
      return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" class="model-label model-item-label" data-item="${escapeHtml(name)}">${escapeHtml(name)}</text>`;
    }

    const sortedFaces = faces.slice().sort((a, b) => faceDepth(a) - faceDepth(b));
    const faceSvg = sortedFaces.map(polygon).join("");
    const gridSvg = view.open
      ? (() => {
          const gridHalfWidth = config.widthBoxes * 55 / 2;
          const gridHalfDepth = config.depthBoxes * 55 / 2;
          const lines = [];
          for (let column = 0; column <= config.widthBoxes; column += 1) {
            const x = -gridHalfWidth + column * 55;
            const start = project(pt(x, -hh + 1, -gridHalfDepth));
            const end = project(pt(x, -hh + 1, gridHalfDepth));
            lines.push(`<line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" class="model-grid-line"/>`);
          }
          for (let row = 0; row <= config.depthBoxes; row += 1) {
            const z = -gridHalfDepth + row * 55;
            const start = project(pt(-gridHalfWidth, -hh + 1, z));
            const end = project(pt(gridHalfWidth, -hh + 1, z));
            lines.push(`<line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" class="model-grid-line"/>`);
          }
          return lines.join("");
        })()
      : "";
    const panelLabels = [
      labelFor("Front", pt(0, 0, -hd - 2)),
      labelFor("Back", pt(0, 0, hd + 2)),
      labelFor("Left side", pt(-hw - 2, 0, 0)),
      labelFor("Right side", pt(hw + 2, 0, 0)),
      labelFor(view.open ? "Lid — open" : "Lid — closed", pt(lidCenter.x, lidCenter.y + 8, lidCenter.z)),
      labelFor("Bottom", pt(0, -hh - 8, 0)),
    ].join("");
    const hardwareLabels = [
      hardwareLabel("Corner protectors", pt(-hw, hh, -hd)),
      hardwareLabel("Corner protectors", pt(hw, hh, hd)),
      hardwareLabel("Hinges", pt(-hw * 0.38, hh * 0.25, hd + 8)),
      hardwareLabel("Lock set", pt(hw * 0.34, 0, -hd - 8)),
      hardwareLabel("Lip", lidPoint(0, -hd * 0.55)),
    ].join("");
    const handleLabel = config.hasHandle
      ? hardwareLabel("Flat handle", pt(0, Math.min(hh - 6, hh * 0.45), -hd - 10))
      : labelFor("No handle on 2H", pt(0, Math.min(hh - 6, hh * 0.2), -hd - 10), "model-label model-note");

    return [
      `<svg class="model3d-svg" viewBox="0 0 900 560" role="img" aria-label="Draggable 3D Wood Case model" data-model="3d">`,
      `<rect x="0" y="0" width="900" height="560" class="svg-bg"/>`,
      `<text x="26" y="34" class="svg-label">Schematic fallback: drag to rotate</text>`,
      `<text x="26" y="54" class="model-hint">${d.bottomWidthMm} x ${d.bottomHeightMm} footprint, ${height} mm side height</text>`,
      `<g class="model-shape">${faceSvg}${gridSvg}</g>`,
      `<g class="model-labels">${panelLabels}${hardwareLabels}${handleLabel}</g>`,
      `</svg>`,
    ].join("");
  }

  return { renderPreviewSvg, renderModel3dSvg };
});
