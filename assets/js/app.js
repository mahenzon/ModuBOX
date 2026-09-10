(function (root, factory) {
  let catalog = root.WOODCASE_CATALOG;
  let core = root.WOODCASE_CORE;
  let panelGeometry = root.WOODCASE_PANEL_GEOMETRY;
  let preview = root.WOODCASE_PREVIEW;
  let planner = root.WOODCASE_SHEET_PLANNER;
  let renderers = root.WOODCASE_RENDERERS;
  let dxfExport = root.WOODCASE_DXF_EXPORT;
  let laserPreview = root.WOODCASE_LASER_PREVIEW;
  if (typeof module === "object" && module.exports) {
    catalog = require("./catalog.js");
    core = require("./core.js");
    panelGeometry = require("./panel-geometry.js");
    preview = require("./preview.js");
    planner = require("./sheet-planner.js");
    renderers = require("./renderers.js");
    dxfExport = require("./dxf-export.js");
    laserPreview = require("./laser-preview.js");
    module.exports = factory(
      root, catalog, core, panelGeometry, preview, planner, renderers, dxfExport, laserPreview,
    );
  } else {
    root.WOODCASE_APP = factory(
      root, catalog, core, panelGeometry, preview, planner, renderers, dxfExport, laserPreview,
    );
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (root, catalog, core, panelGeometry, preview, planner, renderers, dxfExport, laserPreview) {
  "use strict";

  if (
    !catalog || !core || !panelGeometry || !preview || !planner
    || !renderers || !dxfExport || !laserPreview
  ) {
    throw new Error("Wood Case application dependencies are required");
  }

  const { getDefaultConfig, normalizeConfig, normalizeOrbitAngle, buildBom, setCurrentBom, exportBomAsCsv, exportBomAsJson, exportBomAsMarkdown, formatCount } = core;
  const { renderPreviewSvg, renderModel3dSvg } = preview;
  const { normalizeWoodSheetOptions } = planner;
  const { getConfigFromControls, renderControls, renderSummary, renderBomTables, getWoodSheetOptionsFromControls, renderWoodSheetCalculator, renderModelDimensions } = renderers;
  const { createPanelGeometry, normalizeClearanceDiameterMm } = panelGeometry;
  const {
    normalizeCaseSetCount, createFullDxfLayout, createFullDxfExport, createSeparateDxfExport,
  } = dxfExport;
  const { renderFullLaserPreview } = laserPreview;

  let currentBom = null, currentPanelGeometry = null, currentLaserLayout = null;
  let modelViewer = null;
  const PREFERENCES_STORAGE_KEY = "modubox-wood-case-preferences-v1";
  const modelView = {
    yaw: -0.62,
    pitch: -0.38,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    dimensionsOpen: true,
    open: true,
  };
  function getPreferenceStorage() {
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch (_error) {
      return null;
    }
  }
  function loadPreferences(storageInput) {
    const storage = storageInput || getPreferenceStorage();
    if (!storage) {
      return null;
    }
    try {
      const parsed = JSON.parse(storage.getItem(PREFERENCES_STORAGE_KEY));
      if (!parsed || parsed.version !== 1) {
        return null;
      }
      const preferences = {
        version: 1,
        config: normalizeConfig(parsed.config),
        woodSheet: normalizeWoodSheetOptions(parsed.woodSheet),
        dxf: {
          clearanceDiameterMm: normalizeClearanceDiameterMm(
            parsed.dxf && parsed.dxf.clearanceDiameterMm,
          ),
        },
      };
      if (parsed.modelView && Number.isFinite(parsed.modelView.yaw) && Number.isFinite(parsed.modelView.pitch)) {
        preferences.modelView = {
          yaw: parsed.modelView.yaw,
          pitch: parsed.modelView.pitch,
          dimensionsOpen: parsed.modelView.dimensionsOpen !== undefined
            ? parsed.modelView.dimensionsOpen !== false
            : parsed.modelView.showDimensions !== false,
          open: parsed.modelView.open !== false,
        };
      }
      return preferences;
    } catch (_error) {
      return null;
    }
  }
  function applyPreferences(preferences, doc) {
    if (!preferences) {
      return;
    }
    for (const [key, value] of Object.entries(preferences.config)) {
      const input = doc.querySelector(`[name="${key}"]`);
      if (input?.type === "checkbox") input.checked = value === true;
      else { const radio = doc.querySelector(`[name="${key}"][value="${value}"]`); if (radio) radio.checked = true; }
    }
    const woodControlValues = {
      caseSetCount: preferences.woodSheet.caseSetCount,
      sheetLengthMm: preferences.woodSheet.sheetLengthMm,
      sheetWidthMm: preferences.woodSheet.sheetWidthMm,
      sheetKerfMm: preferences.woodSheet.kerfMm,
    };
    for (const [id, value] of Object.entries(woodControlValues)) {
      const input = doc.getElementById(id);
      if (input) {
        input.value = value;
      }
    }
    const rotation = doc.getElementById("allowPartRotation");
    const cutThrough = doc.getElementById("cutThroughOnly");
    if (rotation) rotation.checked = preferences.woodSheet.allowRotation;
    if (cutThrough) cutThrough.checked = preferences.woodSheet.cutThroughOnly;
    const holeClearance = doc.getElementById("holeClearanceMm");
    if (holeClearance) holeClearance.value = preferences.dxf.clearanceDiameterMm;
    if (preferences.modelView) {
      modelView.yaw = preferences.modelView.yaw;
      modelView.pitch = preferences.modelView.pitch;
      modelView.dimensionsOpen = preferences.modelView.dimensionsOpen;
      modelView.open = preferences.modelView.open;
      const dimensionsPanel = doc.getElementById("modelDimensions");
      const openToggle = doc.getElementById("openCaseModel");
      if (dimensionsPanel) dimensionsPanel.open = modelView.dimensionsOpen;
      if (openToggle) openToggle.checked = modelView.open;
    }
  }
  function savePreferences(doc, storageInput) {
    const storage = storageInput || getPreferenceStorage();
    if (!storage) {
      return false;
    }
    try {
      storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        version: 1,
        config: getConfigFromControls(doc),
        woodSheet: getWoodSheetOptionsFromControls(doc),
        dxf: {
          clearanceDiameterMm: getHoleClearanceFromControls(doc),
        },
        modelView: {
          yaw: modelView.yaw,
          pitch: modelView.pitch,
          dimensionsOpen: modelView.dimensionsOpen,
          open: modelView.open,
        },
      }));
      return true;
    } catch (_error) {
      return false;
    }
  }
  function getHoleClearanceFromControls(doc) {
    const input = doc.getElementById("holeClearanceMm");
    if (input && input.value === "") throw new Error("Hole diameter adjustment is required");
    return normalizeClearanceDiameterMm(input?.value);
  }
  function setDxfStatus(status, message, state) {
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }
  function setControlValidity(doc, id, invalid) {
    const input = doc.getElementById(id);
    if (!input) return;
    if (invalid) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-errormessage", "dxfExportStatus");
    } else {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-errormessage");
    }
  }
  function renderPreview(config, bom, geometry, doc) {
    const model = doc.getElementById("model3d");
    if (model) {
      if (typeof globalThis !== "undefined" && globalThis.WOODCASE_3D) {
        if (!modelViewer) modelViewer = globalThis.WOODCASE_3D.mount(model);
        if (modelViewer) {
          modelViewer.open = modelView.open;
          modelViewer.update(bom, geometry);
        } else {
          model.innerHTML = renderModel3dSvg(config, bom, modelView);
        }
      } else {
        model.innerHTML = renderModel3dSvg(config, bom, modelView);
      }
    }
    renderModelDimensions(config, bom, doc, modelView);
    doc.getElementById("preview").innerHTML = renderPreviewSvg(config, bom, geometry);
  }
  function bindModelDrag(doc) {
    const model = doc.getElementById("model3d");
    if (!model) {
      return;
    }
    model.addEventListener("pointerdown", (event) => {
      if (modelViewer) return;
      modelView.dragging = true;
      modelView.pointerId = event.pointerId;
      modelView.lastX = event.clientX;
      modelView.lastY = event.clientY;
      model.setPointerCapture(event.pointerId);
      model.classList.add("is-dragging");
    });
    model.addEventListener("pointermove", (event) => {
      if (!modelView.dragging || event.pointerId !== modelView.pointerId) {
        return;
      }
      const dx = event.clientX - modelView.lastX;
      const dy = event.clientY - modelView.lastY;
      modelView.lastX = event.clientX;
      modelView.lastY = event.clientY;
      modelView.yaw += dx * 0.01;
      modelView.pitch = normalizeOrbitAngle(modelView.pitch + dy * 0.008);
      if (currentBom) {
        model.innerHTML = renderModel3dSvg(currentBom.configuration, currentBom, modelView);
      }
    });
    function stopDrag(event) {
      if (event.pointerId !== modelView.pointerId) {
        return;
      }
      modelView.dragging = false;
      modelView.pointerId = null;
      model.classList.remove("is-dragging");
      savePreferences(doc);
    }
    model.addEventListener("pointerup", stopDrag);
    model.addEventListener("pointercancel", stopDrag);
  }

  function bindModelControls(doc) {
    const dimensionsPanel = doc.getElementById("modelDimensions");
    const openToggle = doc.getElementById("openCaseModel");
    const resetButton = doc.getElementById("resetModelView");
    dimensionsPanel?.addEventListener("toggle", () => {
      modelView.dimensionsOpen = dimensionsPanel.open;
      savePreferences(doc);
    });
    openToggle?.addEventListener("change", () => {
      modelView.open = openToggle.checked;
      if (modelViewer) modelViewer.setOpen(modelView.open);
      else if (currentBom) {
        renderPreview(currentBom.configuration, currentBom, currentPanelGeometry, doc);
      }
      savePreferences(doc);
    });
    resetButton?.addEventListener("click", () => {
      modelView.yaw = -0.62;
      modelView.pitch = -0.38;
      if (modelViewer) modelViewer.reset();
      else if (currentBom) {
        renderPreview(currentBom.configuration, currentBom, currentPanelGeometry, doc);
      }
      savePreferences(doc);
    });
  }

  function updateApp() {
    const doc = document;
    const config = getConfigFromControls(doc);
    const bom = buildBom(config);
    const status = doc.getElementById("dxfExportStatus");
    const exposeLaserError = doc.getElementById("laserCuttingTool")?.open !== false;
    let geometry;
    try {
      geometry = createPanelGeometry(bom, {
        clearanceDiameterMm: getHoleClearanceFromControls(doc),
      });
    } catch (error) {
      currentPanelGeometry = null;
      currentLaserLayout = null;
      setControlValidity(doc, "holeClearanceMm", exposeLaserError);
      setDxfStatus(status, exposeLaserError ? `DXF export unavailable: ${error.message}` : "", exposeLaserError ? "error" : "");
      const laserResult = doc.getElementById("dxfLaserPreview");
      if (laserResult) {
        laserResult.innerHTML = `<p class="laser-preview-error">${core.escapeHtml(error.message)}</p>`;
      }
      return;
    }
    setControlValidity(doc, "holeClearanceMm", false);
    currentBom = bom;
    currentPanelGeometry = geometry;
    setCurrentBom(bom);
    renderSummary(bom.configuration, bom, doc);
    renderPreview(bom.configuration, bom, geometry, doc);
    renderBomTables(bom, doc);
    renderWoodSheetCalculator(bom, doc);
    const laserResult = doc.getElementById("dxfLaserPreview");
    try {
      currentLaserLayout = createFullDxfLayout(
        bom,
        getWoodSheetOptionsFromControls(doc),
        geometry.clearanceDiameterMm,
      );
      if (laserResult) laserResult.innerHTML = renderFullLaserPreview(currentLaserLayout);
      setControlValidity(doc, "sheetKerfMm", false);
      setDxfStatus(status, "");
    } catch (error) {
      currentLaserLayout = null;
      setControlValidity(doc, "sheetKerfMm", exposeLaserError && /nesting gap/i.test(error.message));
      if (laserResult) {
        laserResult.innerHTML = `<p class="laser-preview-error">${core.escapeHtml(error.message)}</p>`;
      }
      setDxfStatus(status, exposeLaserError ? `Full-sheet DXF unavailable: ${error.message}` : "", exposeLaserError ? "error" : "");
    }
    savePreferences(doc);
  }
  function downloadText(filename, text, mimeType) {
    downloadFile(filename, text, mimeType);
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getDxfCaseSetCountFromControls(doc) {
    return normalizeCaseSetCount(doc.getElementById("caseSetCount")?.value);
  }

  function bindExportButtons(doc) {
    doc.getElementById("downloadMarkdown").addEventListener("click", () => {
      downloadText("woodcase-bom.md", exportBomAsMarkdown(currentBom), "text/markdown");
    });
    doc.getElementById("downloadDxfFull").addEventListener("click", () => {
      const status = doc.getElementById("dxfExportStatus");
      try {
        const layout = currentLaserLayout || createFullDxfLayout(
          currentBom,
          getWoodSheetOptionsFromControls(doc),
          getHoleClearanceFromControls(doc),
        );
        const exported = createFullDxfExport(currentBom, layout);
        downloadFile(exported.filename, exported.content, exported.mimeType);
        setControlValidity(doc, "sheetKerfMm", false);
        setControlValidity(doc, "holeClearanceMm", false);
        setDxfStatus(status, `Downloaded ${exported.filename}: ${formatCount(layout.groups.length, "unique cut layout")} for ${formatCount(layout.plan.sheetCount, "physical sheet")}.`, "success");
      } catch (error) {
        setControlValidity(doc, "sheetKerfMm", /nesting gap/i.test(error.message));
        setControlValidity(doc, "holeClearanceMm", /hole diameter|clearance/i.test(error.message));
        setDxfStatus(status, `Full-sheet DXF ZIP not downloaded: ${error.message}`, "error");
      }
    });
    doc.getElementById("downloadDxfSeparate").addEventListener("click", () => {
      const status = doc.getElementById("dxfExportStatus");
      try {
        const caseSetCount = getDxfCaseSetCountFromControls(doc);
        const geometry = currentPanelGeometry || createPanelGeometry(currentBom, {
          clearanceDiameterMm: getHoleClearanceFromControls(doc),
        });
        const exported = createSeparateDxfExport(currentBom, caseSetCount, geometry);
        downloadFile(exported.filename, exported.content, exported.mimeType);
        setControlValidity(doc, "holeClearanceMm", false);
        setDxfStatus(status, `Downloaded ${exported.filename}: five panel DXFs plus a manifest for ${formatCount(caseSetCount, "case set")}.`, "success");
      } catch (error) {
        setControlValidity(doc, "holeClearanceMm", /hole diameter|clearance/i.test(error.message));
        setDxfStatus(status, `Separate-panel DXF ZIP not downloaded: ${error.message}`, "error");
      }
    });
    doc.getElementById("printBom").addEventListener("click", () => {
      window.print();
    });
    doc.getElementById("exportFormat").addEventListener("change", (event) => {
      if (event.target.value === "csv") {
        downloadText("woodcase-bom.csv", exportBomAsCsv(currentBom), "text/csv;charset=utf-8");
      } else if (event.target.value === "json") {
        downloadText("woodcase-bom.json", exportBomAsJson(currentBom), "application/json");
      }
      event.target.value = "";
    });
  }

  function bindWoodSheetControls(doc) {
    doc.getElementById("laserCuttingTool")?.addEventListener("toggle", updateApp);
    doc.querySelectorAll(".wood-sheet-input, .dxf-input").forEach((input) => {
      input.addEventListener("input", updateApp);
      input.addEventListener("change", updateApp);
    });
  }

  function initApp(doc) {
    const source = doc || document;
    renderControls(source, updateApp);
    applyPreferences(loadPreferences(), source);
    bindModelDrag(source);
    bindModelControls(source);
    bindExportButtons(source);
    bindWoodSheetControls(source);
    updateApp();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => initApp(document));
  }
  return {
    catalog, PREFERENCES_STORAGE_KEY, getDefaultConfig, loadPreferences,
    getDxfCaseSetCountFromControls, getHoleClearanceFromControls, initApp,
    ...core, ...panelGeometry, ...preview, ...planner, ...renderers, ...dxfExport, ...laserPreview,
  };
  },
);
