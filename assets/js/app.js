(function (root, factory) {
  let catalog = root.WOODCASE_CATALOG;
  let core = root.WOODCASE_CORE;
  let preview = root.WOODCASE_PREVIEW;
  let planner = root.WOODCASE_SHEET_PLANNER;
  let renderers = root.WOODCASE_RENDERERS;
  if (typeof module === "object" && module.exports) {
    catalog = require("./catalog.js");
    core = require("./core.js");
    preview = require("./preview.js");
    planner = require("./sheet-planner.js");
    renderers = require("./renderers.js");
    module.exports = factory(root, catalog, core, preview, planner, renderers);
  } else {
    root.WOODCASE_APP = factory(root, catalog, core, preview, planner, renderers);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, catalog, core, preview, planner, renderers) {
  "use strict";

  if (!catalog || !core || !preview || !planner || !renderers) {
    throw new Error("Wood Case application dependencies are required");
  }

  const { getDefaultConfig, normalizeConfig, normalizeOrbitAngle, buildBom, setCurrentBom, exportBomAsCsv, exportBomAsJson, exportBomAsMarkdown } = core;
  const { renderPreviewSvg, renderModel3dSvg } = preview;
  const { normalizeWoodSheetOptions } = planner;
  const { getConfigFromControls, renderControls, renderSummary, renderBomTables, getWoodSheetOptionsFromControls, renderWoodSheetCalculator, renderModelDimensions } = renderers;

  let currentBom = null;
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
      const input = doc.querySelector(`[name="${key}"][value="${value}"]`);
      if (input) {
        input.checked = true;
      }
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

  function renderPreview(config, bom, doc) {
    const model = doc.getElementById("model3d");
    if (model) {
      if (typeof globalThis !== "undefined" && globalThis.WOODCASE_3D) {
        if (!modelViewer) modelViewer = globalThis.WOODCASE_3D.mount(model);
        if (modelViewer) {
          modelViewer.open = modelView.open;
          modelViewer.update(bom);
        } else {
          model.innerHTML = renderModel3dSvg(config, bom, modelView);
        }
      } else {
        model.innerHTML = renderModel3dSvg(config, bom, modelView);
      }
    }
    renderModelDimensions(config, bom, doc, modelView);
    doc.getElementById("preview").innerHTML = renderPreviewSvg(config, bom);
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
      else if (currentBom) renderPreview(currentBom.configuration, currentBom, doc);
      savePreferences(doc);
    });
    resetButton?.addEventListener("click", () => {
      modelView.yaw = -0.62;
      modelView.pitch = -0.38;
      if (modelViewer) modelViewer.reset();
      else if (currentBom) renderPreview(currentBom.configuration, currentBom, doc);
      savePreferences(doc);
    });
  }

  function updateApp() {
    const doc = document;
    const config = getConfigFromControls(doc);
    const bom = buildBom(config);
    currentBom = bom;
    setCurrentBom(bom);
    renderSummary(bom.configuration, bom, doc);
    renderPreview(bom.configuration, bom, doc);
    renderBomTables(bom, doc);
    renderWoodSheetCalculator(bom, doc);
    savePreferences(doc);
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindExportButtons(doc) {
    doc.getElementById("downloadMarkdown").addEventListener("click", () => {
      downloadText("woodcase-bom.md", exportBomAsMarkdown(currentBom), "text/markdown");
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
    doc.querySelectorAll(".wood-sheet-input").forEach((input) => {
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
    catalog, PREFERENCES_STORAGE_KEY, getDefaultConfig, loadPreferences, initApp,
    ...core, ...preview, ...planner, ...renderers,
  };
});
