(function (root, factory) {
  let catalog = root.WOODCASE_CATALOG;
  let core = root.WOODCASE_CORE;
  let planner = root.WOODCASE_SHEET_PLANNER;
  if (typeof module === "object" && module.exports) {
    catalog = require("./catalog.js");
    core = require("./core.js");
    planner = require("./sheet-planner.js");
    module.exports = factory(catalog, core, planner);
  } else {
    root.WOODCASE_RENDERERS = factory(catalog, core, planner);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (catalog, core, planner) {
  "use strict";

  if (!catalog || !core || !planner) throw new Error("Wood Case renderer dependencies are required");
  const { normalizeConfig, escapeHtml, formatFileReference, formatSize, formatCount } = core;
  const { normalizeWoodSheetOptions, calculateWoodSheetPlan } = planner;

  function getConfigFromControls(doc) {
    const source = doc || document;
    const config = {};
    for (const key of Object.keys({ ...catalog.parameters, ...catalog.buildOptions })) {
      const checked = source.querySelector(`[name="${key}"]:checked`);
      const input = source.querySelector(`[name="${key}"]`);
      const rawValue = input?.type === "checkbox" ? input.checked : checked?.value;
      config[key] = rawValue;
    }
    if (doc?.getElementById("build-options")) {
      if (Number(config.widthBoxes) === 5 || (config.clearLid && Number(config.lidThicknessMm) < 6)) config.lipStyle = "standard";
      if (Number(config.materialThicknessMm) < 9) config.cornerFastening = "bolts";
      const wall = catalog.screwCorners.printedWallMm[config.materialThicknessMm];
      if (Number(config.cornerScrewLengthMm) >= wall + Number(config.materialThicknessMm)) config.cornerScrewLengthMm = 0;
      const normalized = normalizeConfig(config);
      for (const [key, spec] of Object.entries(catalog.buildOptions)) {
        const field = source.getElementById(`option-${key}`);
        if (!field) continue;
        field.hidden = !core.matchesRule(normalized, spec.when);
        for (const input of source.querySelectorAll(`[name="${key}"]`)) {
          if (input.type === "checkbox") continue;
          input.checked = input.value === String(normalized[key]);
          input.disabled = (spec.disabledValues || []).includes(input.value) || (key === "lipStyle" && input.value === "thin" && (normalized.widthBoxes === 5 || normalized.lidThicknessMm < 6)) || (key === "cornerFastening" && input.value === "wood-screws" && normalized.materialThicknessMm < 9) || (key === "cornerScrewLengthMm" && Number(input.value) >= wall + normalized.materialThicknessMm);
          if (key === "cornerScrewLengthMm" && input.value === "0" && wall) {
            const suggested = core.getCornerScrewSpec({ ...normalized, cornerScrewLengthMm: 0 });
            input.nextElementSibling.textContent = `Auto (${suggested.lengthMm} mm)`;
          }
        }
      }
    }
    return normalizeConfig(config);
  }

  function renderControls(doc, onChange) {
    const controls = doc.getElementById("controls");
    const labels = { none: "No handle", fixed: "Fixed handle", standard: "Standard lip", thin: "Thin lip", bolts: "Bolts + nuts", "wood-screws": "Direct wood screws" };
    const renderGroup = ([key, spec]) => {
      if (key === "clearLid") return `<div class="control-group" id="option-${key}"><label class="preview-toggle"><input type="checkbox" name="${key}" value="true"><span>${escapeHtml(spec.label)}</span></label></div>`;
      const buttons = spec.values.map((value) => {
        const id = `${key}-${value}`;
        const label = spec.valueLabels?.[value] || labels[value] || `${value}${key === "heightLevel" ? "" : " "}${spec.unit || ""}`;
        return `<input type="radio" class="btn-check" name="${key}" id="${id}" value="${value}" ${value === spec.defaultValue ? "checked" : ""}><label class="choice" for="${id}">${escapeHtml(label)}</label>`;
      }).join("");
      return `<fieldset class="control-group" id="option-${key}"><legend>${escapeHtml(spec.label)}</legend><div class="choice-row">${buttons}</div>${spec.help ? `<small>${escapeHtml(spec.help)}</small>` : ""}</fieldset>`;
    };
    controls.innerHTML = Object.entries(catalog.parameters).map(renderGroup).join("")
      + `<div id="build-options" class="build-options">${Object.entries(catalog.buildOptions).map(renderGroup).join("")}</div>`;
    if (onChange) {
      controls.querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", onChange);
      });
    }
  }

  function renderSummary(config, bom, doc) {
    const el = doc.getElementById("summary");
    const totalWood = bom.woodParts.reduce((sum, row) => sum + row.quantity, 0);
    const totalPrinted = bom.printedParts.reduce((sum, row) => sum + row.quantity, 0);
    const totalRecommended = (bom.recommendedParts || []).reduce((sum, row) => sum + row.quantity, 0);
    el.innerHTML = [
      `<div class="summary-card"><span>Configuration</span><strong>${config.materialThicknessMm} mm / ${config.widthBoxes} x ${config.depthBoxes} / ${config.heightLevel}H</strong></div>`,
      `<div class="summary-card"><span>Footprint</span><strong>${bom.dimensions.bottomWidthMm} x ${bom.dimensions.bottomHeightMm} mm</strong></div>`,
      `<div class="summary-card"><span>Sheet pieces</span><strong>${totalWood}</strong></div>`,
      `<div class="summary-card"><span>Printed bodies</span><strong>${totalPrinted}</strong></div>`,
      `<div class="summary-card"><span>Optional templates</span><strong>${totalRecommended}</strong></div>`,
      `<div class="summary-card"><span>Handle</span><strong>${config.hasHandle ? (config.handleStyle === "fixed" ? "Fixed (2H)" : "Hinged") : "Not selected (2H)"}</strong></div>`,
    ].join("");
  }

  function renderTable(title, rows, columns, description) {
    const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const body = rows
      .map(
        (row) =>
          `<tr>${columns
            .map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key] || "")}</td>`)
          .join("")}</tr>`,
      )
      .join("");
    const descriptionHtml = description
      ? `<p class="bom-section-note">${escapeHtml(description)}</p>`
      : "";
    return `<section class="bom-section"><h2>${escapeHtml(title)}</h2>${descriptionHtml}<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function renderFormulaDisclosure(formula) {
    return `<details class="formula-disclosure"><summary aria-label="Show size formula" title="Show size formula">?</summary><code>${escapeHtml(formula)}</code></details>`;
  }

  function usesHoverOnlyFormulaDisclosure(matchMediaInput) {
    const host = typeof globalThis !== "undefined" ? globalThis : null;
    const matchMedia = matchMediaInput || (host && host.matchMedia);
    return typeof matchMedia === "function"
      && matchMedia.call(host, "(hover: hover) and (pointer: fine)").matches;
  }

  function handleFormulaDisclosureClick(event, matchMediaInput) {
    if (!usesHoverOnlyFormulaDisclosure(matchMediaInput)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.parentElement.removeAttribute("open");
  }

  function setFormulaDisclosureOpen(details, shouldOpen, matchMediaInput) {
    if (!usesHoverOnlyFormulaDisclosure(matchMediaInput)) {
      return;
    }
    if (shouldOpen) {
      details.setAttribute("open", "");
    } else {
      details.removeAttribute("open");
    }
  }

  function renderBomTables(bom, doc) {
    const el = doc.getElementById("bom");
    el.innerHTML = [
      renderTable("Panel Cut List", bom.woodParts, [
        { label: "Part", key: "item" },
        { label: "Qty", key: "quantity" },
        { label: "Size", render: (row) => escapeHtml(formatSize(row.lengthMm, row.widthMm)) },
        { label: "Material", key: "material" },
        { label: "Thickness", render: (row) => `${row.thicknessMm} mm` },
        { label: "", render: (row) => renderFormulaDisclosure(row.formula) },
      ]),
      renderTable("Printed Parts", bom.printedParts, [
        { label: "Part", key: "item" },
        { label: "Bodies", key: "quantity" },
        { label: "STL model", render: (row) => formatFileReference(row.stlFile) },
        { label: "Bambu 3MF", render: (row) => formatFileReference(row.bambu3mfFile) },
        { label: "Notes", key: "note" },
      ]),
      renderTable("Recommended Preparation Templates", bom.recommendedParts || [], [
        { label: "Template", key: "item" },
        { label: "Qty", key: "quantity" },
        { label: "STL model", render: (row) => formatFileReference(row.stlFile) },
        { label: "Notes", key: "note" },
      ], "Optional flat/thin 3D printed helpers for positioning cut or drill holes; not required for the case build."),
      renderTable("Hardware", bom.hardware, [
        { label: "Item", key: "item" },
        { label: "Qty", render: (row) => `${row.quantity} ${row.unit}` },
        { label: "Use", key: "use" },
        { label: "Search", key: "search" },
      ]),
      `<section class="assembly-notes"><h3>Assembly notes</h3><ul>${bom.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></section>`,
    ].join("");
    el.querySelectorAll(".formula-disclosure").forEach((details) => {
      const summary = details.querySelector("summary");
      summary.addEventListener("click", handleFormulaDisclosureClick);
      details.addEventListener("mouseenter", () => setFormulaDisclosureOpen(details, true));
      details.addEventListener("mouseleave", () => setFormulaDisclosureOpen(details, false));
      details.addEventListener("focusin", () => setFormulaDisclosureOpen(details, true));
      details.addEventListener("focusout", () => setFormulaDisclosureOpen(details, false));
    });
  }

  function getWoodSheetOptionsFromControls(doc) {
    const source = doc || document;
    return normalizeWoodSheetOptions({
      caseSetCount: source.getElementById("caseSetCount")?.value,
      sheetLengthMm: source.getElementById("sheetLengthMm")?.value,
      sheetWidthMm: source.getElementById("sheetWidthMm")?.value,
      kerfMm: source.getElementById("sheetKerfMm")?.value,
      allowRotation: source.getElementById("allowPartRotation")?.checked,
      cutThroughOnly: source.getElementById("cutThroughOnly")?.checked,
    });
  }

  function renderSheetLayoutSvg(sheet, options) {
    const scale = Math.min(720 / options.sheetLengthMm, 360 / options.sheetWidthMm);
    const viewWidth = Math.round(options.sheetLengthMm * scale) + 24;
    const viewHeight = Math.round(options.sheetWidthMm * scale) + 24;
    const rects = sheet.placements
      .map((placement) => {
        const x = 12 + placement.x * scale;
        const y = 12 + placement.y * scale;
        const width = placement.width * scale;
        const height = placement.height * scale;
        return [
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" class="sheet-piece"/>`,
          `<text x="${(x + width / 2).toFixed(1)}" y="${(y + height / 2 + 5).toFixed(1)}" class="sheet-piece-number">${escapeHtml(placement.mark)}</text>`,
        ].join("");
      })
      .join("");
    const cutOverlay = options.cutThroughOnly
      ? sheet.cutPlan.map((cut) => cut.lines.map((line, lineIndex) => {
          const x1 = 12 + (line.orientation === "vertical" ? line.coordinate : line.from) * scale;
          const y1 = 12 + (line.orientation === "vertical" ? line.from : line.coordinate) * scale;
          const x2 = 12 + (line.orientation === "vertical" ? line.coordinate : line.to) * scale;
          const y2 = 12 + (line.orientation === "vertical" ? line.to : line.coordinate) * scale;
          const labelX = line.orientation === "vertical" ? x1 + 8 : x1 + 14;
          const labelY = line.orientation === "vertical" ? y1 + 16 : y1 - 6;
          return [
            `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="sheet-cut-line ${cut.kind === "batch" ? "is-batch" : ""}"/>`,
            lineIndex === 0
              ? `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" class="sheet-cut-number">${cut.step}</text>`
              : "",
          ].join("");
        }).join("")).join("")
      : "";

    return [
      `<svg class="sheet-layout-svg" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="Cut layout for sheet ${sheet.index}">`,
      `<rect x="12" y="12" width="${(options.sheetLengthMm * scale).toFixed(1)}" height="${(options.sheetWidthMm * scale).toFixed(1)}" class="sheet-board"/>`,
      rects,
      cutOverlay,
      `</svg>`,
    ].join("");
  }

  const formatCoordinate = (value) => Number(value.toFixed(3));

  function formatCutCoordinates(cut) {
    return cut.lines
      .map((line) => `${formatCoordinate(line.coordinate)} mm`)
      .join(", ");
  }

  function renderSheetCutPlan(sheet) {
    if (!sheet.cutPlan.length) return "";
    const steps = sheet.cutPlan.map((cut) => {
      if (cut.kind === "batch") {
        return [
          `<li><span class="cut-step-number">${cut.step}</span><div>`,
          `<strong>Divide the ${cut.marks.map(escapeHtml).join(" · ")} strip</strong>`,
          `<span>Make ${formatCount(cut.count, `parallel ${cut.orientation} cut`)} at ${escapeHtml(formatCutCoordinates(cut))} to produce ${formatCount(cut.marks.length, `${cut.partSize} panel`)}.</span>`,
          `</div></li>`,
        ].join("");
      }
      const line = cut.lines[0];
      const axis = line.orientation === "vertical" ? "x" : "y";
      const spanAxis = line.orientation === "vertical" ? "y" : "x";
      return [
        `<li><span class="cut-step-number">${cut.step}</span><div>`,
        `<strong>${line.orientation === "vertical" ? "Vertical" : "Horizontal"} breakdown cut at ${axis} = ${formatCoordinate(line.coordinate)} mm</strong>`,
        `<span>Cut through ${spanAxis} = ${formatCoordinate(line.from)}–${formatCoordinate(line.to)} mm; keep the section containing ${cut.targetMarks.map(escapeHtml).join(" · ")}.</span>`,
        `</div></li>`,
      ].join("");
    }).join("");
    return [
      `<details class="cut-plan" open>`,
      `<summary>Cut order · ${formatCount(sheet.cutCount, "straight cut")}</summary>`,
      `<p>Follow the numbered dashed lines. Finish the breakdown cuts first, then divide the matching-panel strips.</p>`,
      `<ol>${steps}</ol>`,
      `</details>`,
    ].join("");
  }

  function renderWoodSheetPlan(plan) {
    if (!plan.success) {
      return [
        `<div class="wood-sheet-summary is-warning"><strong>No fitting layout found</strong></div>`,
        `<ul class="calc-explanation">${plan.explanation.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
        `<ul class="calc-warnings">${plan.warnings.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      ].join("");
    }

    const sheetCards = plan.sheets
      .map((sheet) => {
        const rows = sheet.placements
          .map(
            (placement) =>
              `<tr><td>${escapeHtml(placement.mark)}</td><td>${escapeHtml(placement.item)} ${placement.partCopy > 1 ? `#${placement.partCopy}` : ""}</td><td>${escapeHtml(formatSize(placement.lengthMm, placement.widthMm))}</td><td>${placement.rotated ? "Yes" : "No"}</td><td>${formatCoordinate(placement.x)}, ${formatCoordinate(placement.y)} mm</td></tr>`,
          )
          .join("");
        return [
          `<article class="sheet-card">`,
          `<h3>Sheet ${sheet.index} · ${escapeHtml(sheet.material || "wood")} · ${sheet.thicknessMm || ""} mm</h3>`,
          renderSheetLayoutSvg(sheet, plan),
          plan.cutThroughOnly ? renderSheetCutPlan(sheet) : "",
          `<div class="table-wrap"><table><thead><tr><th>#</th><th>Part</th><th>Cut size</th><th>Rotated</th><th>Top-left position</th></tr></thead><tbody>${rows}</tbody></table></div>`,
          `</article>`,
        ].join("");
      })
      .join("");

    return [
      `<div class="wood-sheet-summary"><strong>Buy ${formatCount(plan.sheetCount, "sheet")}</strong><span>${formatCount(plan.caseSetCount, "case set")}, ${plan.sheetLengthMm} x ${plan.sheetWidthMm} mm, ${plan.kerfMm} mm gap, ${plan.allowRotation ? "rotation allowed" : "no rotation"}, ${plan.cutThroughOnly ? "cut-through cuts only" : "compact layout"}</span></div>`,
      `<ul class="calc-explanation">${plan.explanation.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      `<div class="sheet-cards">${sheetCards}</div>`,
    ].join("");
  }

  function renderWoodSheetCalculator(bom, doc) {
    const result = doc.getElementById("woodSheetResult");
    if (!result) {
      return;
    }
    let plan;
    try {
      plan = calculateWoodSheetPlan(bom, getWoodSheetOptionsFromControls(doc));
      result.innerHTML = renderWoodSheetPlan(plan);
    } catch (error) {
      result.innerHTML = `<div class="wood-sheet-summary is-warning"><strong>${escapeHtml(error.message)}</strong></div>`;
    }
  }

  function renderModelDimensions(config, bom, doc, viewInput) {
    const panel = doc.getElementById("modelDimensions");
    const content = doc.getElementById("modelDimensionsContent");
    if (!panel || !content) return;
    const d = bom.dimensions;
    const view = viewInput || { dimensionsOpen: true };
    const gridWidthMm = config.widthBoxes * 55;
    const gridDepthMm = config.depthBoxes * 55;
    panel.open = view.dimensionsOpen;
    content.innerHTML = [
      `<div class="dimension-card-heading"><strong>Selected size</strong><span>usable grid → overall case</span></div>`,
      `<dl class="primary-dimensions">`,
      `<div><dt>Width</dt><dd><strong>${config.widthBoxes} boxes</strong><span>${gridWidthMm} mm grid</span><span>${d.bottomWidthMm} mm overall</span></dd></div>`,
      `<div><dt>Depth</dt><dd><strong>${config.depthBoxes} boxes</strong><span>${gridDepthMm} mm grid</span><span>${d.bottomHeightMm} mm overall</span></dd></div>`,
      `<div><dt>Height</dt><dd><strong>${config.heightLevel}H</strong><span>${d.frontBackHeightMm} mm panel</span><span>${Math.max(d.sideHeightMm, d.frontBackHeightMm + config.lidThicknessMm)} mm panels with lid</span></dd></div>`,
      `<div><dt>Material</dt><dd><strong>${config.materialThicknessMm} mm</strong><span>wood thickness</span></dd></div>`,
      `</dl>`,
      `<div class="dimension-callouts">`,
      `<div class="dimension-callout"><strong>55 × 55 mm ModuBOX grid</strong><span>${config.widthBoxes} × ${config.depthBoxes} cells, printed and glued to the inside bottom only.</span></div>`,
      `<div class="dimension-callout"><strong>Recessed lid construction</strong><span>The lid fits between the side panels and rests on the shorter front/back panels; its top is flush with the sides when lid and body thicknesses match.</span></div>`,
      `</div>`,
      `<div class="panel-dimensions">`,
      `<strong class="panel-dimensions-heading">Panels</strong>`,
      `<ul>`,
      `<li><span>Front / back ×2</span><strong>${d.frontBackLengthMm} × ${d.frontBackHeightMm} × ${config.materialThicknessMm} mm</strong></li>`,
      `<li><span>Sides ×2</span><strong>${d.sideLengthMm} × ${d.sideHeightMm} × ${config.materialThicknessMm} mm</strong></li>`,
      `<li><span>Lid ×1 · ${config.clearLid ? config.lidMaterial : "wood"}</span><strong>${d.lidWidthMm} × ${d.lidHeightMm} × ${config.lidThicknessMm} mm</strong></li>`,
      `<li><span>Bottom ×1</span><strong>${d.bottomWidthMm} × ${d.bottomHeightMm} × ${config.materialThicknessMm} mm</strong></li>`,
      `</ul>`,
      `</div>`,
    ].join("");
  }

  return {
    getConfigFromControls, renderControls, renderSummary, renderTable, renderFormulaDisclosure,
    usesHoverOnlyFormulaDisclosure, handleFormulaDisclosureClick, setFormulaDisclosureOpen,
    renderBomTables, getWoodSheetOptionsFromControls, renderSheetLayoutSvg,
    formatCutCoordinates, renderSheetCutPlan, renderWoodSheetPlan, renderWoodSheetCalculator,
    renderModelDimensions,
  };
});
