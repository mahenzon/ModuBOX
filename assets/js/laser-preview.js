(function (root, factory) {
  let core = root.WOODCASE_CORE;
  if (typeof module === "object" && module.exports) {
    core = require("./core.js");
    module.exports = factory(core);
  } else {
    root.WOODCASE_LASER_PREVIEW = factory(core);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("WOODCASE_CORE is required");
  const { escapeHtml } = core;

  function renderLaserSheetSvg(group) {
    const sheet = group.representative;
    const scale = Math.min(720 / sheet.stockLengthMm, 360 / sheet.stockWidthMm);
    const viewWidth = Math.round(sheet.stockLengthMm * scale) + 24;
    const viewHeight = Math.round(sheet.stockWidthMm * scale) + 24;
    const mapPoint = (point) => ({
      x: 12 + point.xMm * scale,
      y: 12 + (sheet.stockWidthMm - point.yMm) * scale,
    });
    const panels = sheet.panels.map((panel) => {
      const points = panel.outline
        .map(mapPoint)
        .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" ");
      const holes = panel.holes.map((hole) => {
        const point = mapPoint(hole);
        return [
          `<circle class="laser-preview-hole" data-instance-id="${escapeHtml(panel.instanceId)}"`,
          ` data-hole-id="${escapeHtml(hole.id)}" data-x-mm="${hole.xMm}"`,
          ` data-y-mm="${hole.yMm}" data-diameter-mm="${hole.diameterMm}"`,
          ` cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}"`,
          ` r="${(hole.diameterMm * scale / 2).toFixed(3)}"/>`,
        ].join("");
      }).join("");
      return [
        `<polygon class="laser-preview-outline" data-instance-id="${escapeHtml(panel.instanceId)}"`,
        ` data-role="${panel.role}" data-rotation-deg="${panel.rotationDeg}" points="${points}"/>`,
        holes,
      ].join("");
    }).join("");
    return [
      `<svg class="laser-layout-svg" viewBox="0 0 ${viewWidth} ${viewHeight}"`,
      ` role="img" aria-label="Laser cut preview for ${group.filename}">`,
      `<rect x="12" y="12" width="${(sheet.stockLengthMm * scale).toFixed(2)}"`,
      ` height="${(sheet.stockWidthMm * scale).toFixed(2)}" class="laser-preview-stock"/>`,
      panels,
      `</svg>`,
    ].join("");
  }

  function renderFullLaserPreview(layout) {
    const plan = layout.plan;
    const cards = layout.groups.map((group) => [
      `<article class="laser-layout-card">`,
      `<h3>${escapeHtml(group.filename)}</h3>`,
      `<p>${escapeHtml(group.representative.material)} · ${group.representative.thicknessMm} mm · Cut ${group.quantity} identical physical sheet${group.quantity === 1 ? "" : "s"}</p>`,
      renderLaserSheetSvg(group),
      `</article>`,
    ].join("")).join("");
    return [
      `<div class="laser-preview-summary">`,
      `<strong>${plan.sheetCount} physical sheet${plan.sheetCount === 1 ? "" : "s"}</strong>`,
      `<span>${layout.groups.length} unique cut layout${layout.groups.length === 1 ? "" : "s"} · `,
      `${plan.sheetLengthMm} × ${plan.sheetWidthMm} mm stock · `,
      `${plan.nestingGapMm} mm nesting gap · compact laser packing</span>`,
      `</div>`,
      `<p class="laser-preview-note">The stock boundary and colors are preview-only. Physical DXFs contain true hole circles first and closed panel outlines last.</p>`,
      `<div class="laser-layout-cards">${cards}</div>`,
    ].join("");
  }

  return { renderLaserSheetSvg, renderFullLaserPreview };
});
