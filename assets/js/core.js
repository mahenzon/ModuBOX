(function (root, factory) {
  let catalog = root.WOODCASE_CATALOG;
  if (typeof module === "object" && module.exports) {
    catalog = require("./catalog.js");
    module.exports = factory(catalog);
  } else {
    root.WOODCASE_CORE = factory(catalog);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (catalog) {
  "use strict";

  if (!catalog) throw new Error("WOODCASE_CATALOG is required");

  let currentBom = null;

  function normalizeOrbitAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function getDefaultConfig() {
    return Object.fromEntries(
      Object.entries(catalog.parameters).map(([key, spec]) => [key, spec.defaultValue]),
    );
  }

  function normalizeConfig(input) {
    const result = {};
    for (const [key, spec] of Object.entries(catalog.parameters)) {
      const rawValue = input && input[key] !== undefined ? input[key] : spec.defaultValue;
      const numericValues = spec.values.every((value) => typeof value === "number");
      const value = numericValues ? Number(rawValue) : rawValue;
      if (!spec.values.includes(value)) {
        throw new Error(`${key} must be one of ${spec.values.join(", ")}`);
      }
      result[key] = value;
    }
    return result;
  }

  function matchesRule(config, ruleWhen) {
    if (!ruleWhen) {
      return true;
    }
    return Object.entries(ruleWhen).every(([field, predicate]) => {
      const value = config[field];
      if (Object.prototype.hasOwnProperty.call(predicate, "equals") && value !== predicate.equals) {
        return false;
      }
      if (predicate.oneOf && !predicate.oneOf.includes(value)) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(predicate, "min") && value < predicate.min) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(predicate, "max") && value > predicate.max) {
        return false;
      }
      if (predicate.range) {
        const [min, max] = predicate.range;
        if (value < min || value > max) {
          return false;
        }
      }
      return true;
    });
  }

  function evaluateFormula(formula, config) {
    const constant = formula.constant || 0;
    return (formula.terms || []).reduce(
      (total, term) => total + config[term.field] * term.factor,
      constant,
    );
  }

  function calculateDerivedDimensions(configInput) {
    const config = normalizeConfig(configInput);
    return Object.fromEntries(
      Object.entries(catalog.dimensionFormulas).map(([key, formula]) => [
        key,
        evaluateFormula(formula, config),
      ]),
    );
  }

  function formatFormulaPair(lengthKey, widthKey) {
    return `(${catalog.dimensionFormulas[lengthKey].label}) x (${catalog.dimensionFormulas[widthKey].label})`;
  }

  function formatCatalogPath(pattern, configInput, extra) {
    if (!pattern) {
      return "";
    }
    const config = normalizeConfig(configInput);
    const values = {
      t: config.materialThicknessMm,
      W: config.widthBoxes,
      D: config.depthBoxes,
      H: config.heightLevel,
      ...(extra || {}),
    };
    return pattern.replace(/\{([A-Za-z]+)\}/g, (_match, key) => String(values[key]));
  }

  function resolveQuantity(rule, config) {
    if (typeof rule.quantity === "number") {
      return rule.quantity;
    }
    const quantityRule = (rule.quantityRules || []).find((candidate) =>
      matchesRule(config, candidate.when),
    );
    return quantityRule ? quantityRule.quantity : 0;
  }

  function resolveLookupRule(config, rules) {
    return rules.find((rule) => matchesRule(config, rule.when));
  }

  function calculateWoodParts(configInput, dimensionsInput) {
    const config = normalizeConfig(configInput);
    const dimensions = dimensionsInput || calculateDerivedDimensions(config);
    return catalog.woodParts.map((part) => {
      const lengthMm = dimensions[part.lengthKey];
      const widthMm = dimensions[part.widthKey];
      return {
        category: "wood",
        id: part.id,
        item: part.label,
        quantity: part.quantity,
        unit: "pcs",
        lengthMm,
        widthMm,
        thicknessMm: config.materialThicknessMm,
        formula: formatFormulaPair(part.lengthKey, part.widthKey),
        note: part.source,
      };
    });
  }

  function calculatePrintedParts(configInput) {
    const config = normalizeConfig(configInput);
    return catalog.printedPartRules
      .filter((rule) => matchesRule(config, rule.when))
      .map((rule) => {
        const stlFile = formatCatalogPath(rule.stlPathPattern, config);
        const bambu3mfFile = rule.bambuProjectPath || "";
        return {
          category: "printed",
          id: rule.id,
          item: rule.label,
          quantity: rule.printedBodies,
          unit: "printed bodies",
          stlFile,
          bambu3mfFile,
          note: rule.note,
        };
      });
  }

  function calculateRecommendedParts(configInput) {
    const config = normalizeConfig(configInput);
    return (catalog.recommendedPartRules || [])
      .filter((rule) => matchesRule(config, rule.when))
      .map((rule) => {
        const stlFile = formatCatalogPath(rule.stlPathPattern, config);
        return {
          category: "recommended",
          id: rule.id,
          item: rule.label,
          quantity: rule.quantity,
          unit: "optional template",
          stlFile,
          bambu3mfFile: "",
          note: rule.note,
        };
      });
  }

  function calculateHardware(configInput) {
    const config = normalizeConfig(configInput);
    return catalog.hardwareRules
      .map((rule) => {
        const length = rule.lengthByThickness
          ? rule.lengthByThickness[config.materialThicknessMm]
          : undefined;
        const quantity = resolveQuantity(rule, config);
        const item = rule.item || formatCatalogPath(rule.itemPattern, config, { length });
        const search = rule.search || formatCatalogPath(rule.searchPattern, config, { length });
        return {
          category: "hardware",
          id: rule.id,
          item,
          quantity,
          unit: rule.unit,
          use: rule.use,
          search,
          note: `${rule.use} Search: ${search}`,
        };
      })
      .filter((row) => row.quantity > 0);
  }

  function calculateNotes(configInput) {
    const config = normalizeConfig(configInput);
    const notes = [catalog.notes.stlVs3mf];
    if (!matchesRule(config, catalog.featureRules.handle.enabledWhen)) {
      notes.push(catalog.featureRules.handle.disabledReasonByHeight[config.heightLevel]);
    }
    return notes.filter(Boolean);
  }

  function buildBom(configInput) {
    const configuration = normalizeConfig(configInput);
    const dimensions = calculateDerivedDimensions(configuration);
    const hasHandle = matchesRule(configuration, catalog.featureRules.handle.enabledWhen);
    return {
      configuration: {
        ...configuration,
        hasHandle,
      },
      dimensions,
      woodParts: calculateWoodParts(configuration, dimensions),
      printedParts: calculatePrintedParts(configuration),
      recommendedParts: calculateRecommendedParts(configuration),
      hardware: calculateHardware(configuration),
      notes: calculateNotes(configuration),
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeMarkdown(value) {
    return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
  }

  function escapeCsv(value) {
    if (value === null || value === undefined) {
      return "";
    }
    const text = String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function formatFileReference(displayPath) {
    if (!displayPath) {
      return "";
    }
    return `<span class="file-reference">${escapeHtml(displayPath)}</span>`;
  }

  function formatSize(lengthMm, widthMm) {
    return `${lengthMm} x ${widthMm} mm`;
  }

  function formatCount(count, singular, plural) {
    return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
  }

  function exportBomAsCsv(bomInput) {
    const bom = bomInput || currentBom;
    const header = [
      "category",
      "item",
      "quantity",
      "unit",
      "length_mm",
      "width_mm",
      "thickness_mm",
      "stl_file",
      "bambu_3mf_file",
      "note",
    ];
    const rows = [
      ...bom.woodParts.map((part) => [
        part.category,
        part.item,
        part.quantity,
        part.unit,
        part.lengthMm,
        part.widthMm,
        part.thicknessMm,
        "",
        "",
        `${part.note}; formula: ${part.formula}`,
      ]),
      ...bom.printedParts.map((part) => [
        part.category,
        part.item,
        part.quantity,
        part.unit,
        "",
        "",
        "",
        part.stlFile,
        part.bambu3mfFile,
        part.note,
      ]),
      ...(bom.recommendedParts || []).map((part) => [
        part.category,
        part.item,
        part.quantity,
        part.unit,
        "",
        "",
        "",
        part.stlFile,
        part.bambu3mfFile,
        part.note,
      ]),
      ...bom.hardware.map((part) => [
        part.category,
        part.item,
        part.quantity,
        part.unit,
        "",
        "",
        "",
        "",
        "",
        part.note,
      ]),
    ];
    return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  }

  function exportBomAsJson(bomInput) {
    return JSON.stringify(bomInput || currentBom, null, 2);
  }

  function exportBomAsMarkdown(bomInput) {
    const bom = bomInput || currentBom;
    const config = bom.configuration;
    const lines = [
      "# Wood Case v2 BOM",
      "",
      "## Configuration",
      "",
      `- Material: ${config.materialThicknessMm} mm`,
      `- Width: ${config.widthBoxes} Boxes`,
      `- Depth: ${config.depthBoxes} Boxes`,
      `- Height: ${config.heightLevel}H`,
      `- Handle: ${config.hasHandle ? "yes" : "no"}`,
      "",
      "## Wooden Parts",
      "",
      "| Part | Quantity | Size | Thickness | Formula |",
      "|---|---:|---|---:|---|",
      ...bom.woodParts.map(
        (part) =>
          `| ${escapeMarkdown(part.item)} | ${part.quantity} | ${formatSize(part.lengthMm, part.widthMm)} | ${part.thicknessMm} mm | \`${escapeMarkdown(part.formula)}\` |`,
      ),
      "",
      "## Printed Parts",
      "",
      "| Part | Printed bodies | STL model | Bambu 3MF project | Notes |",
      "|---|---:|---|---|---|",
      ...bom.printedParts.map(
        (part) =>
          `| ${escapeMarkdown(part.item)} | ${part.quantity} | \`${escapeMarkdown(part.stlFile)}\` | \`${escapeMarkdown(part.bambu3mfFile)}\` | ${escapeMarkdown(part.note)} |`,
      ),
      "",
      "## Recommended Preparation Templates",
      "",
      "These STL files are optional flat/thin printed templates for positioning cut or drill holes. They are not required case parts.",
      "",
      "| Template | Quantity | STL model | Notes |",
      "|---|---:|---|---|",
      ...(bom.recommendedParts || []).map(
        (part) =>
          `| ${escapeMarkdown(part.item)} | ${part.quantity} | \`${escapeMarkdown(part.stlFile)}\` | ${escapeMarkdown(part.note)} |`,
      ),
      "",
      "## Hardware",
      "",
      "| Item | Quantity | Use | Search |",
      "|---|---:|---|---|",
      ...bom.hardware.map(
        (part) =>
          `| ${escapeMarkdown(part.item)} | ${part.quantity} ${part.unit} | ${escapeMarkdown(part.use)} | ${escapeMarkdown(part.search)} |`,
      ),
      "",
      "## Notes",
      "",
      ...bom.notes.map((note) => `- ${escapeMarkdown(note)}`),
      "",
    ];
    return lines.join("\n");
  }

  function setCurrentBom(bom) {
    currentBom = bom;
  }

  function getCurrentBom() {
    return currentBom;
  }

  return {
    catalog, normalizeOrbitAngle, getDefaultConfig, normalizeConfig, matchesRule,
    evaluateFormula, calculateDerivedDimensions, formatFormulaPair, formatCatalogPath,
    resolveQuantity, resolveLookupRule, calculateWoodParts, calculatePrintedParts,
    calculateRecommendedParts, calculateHardware, calculateNotes, buildBom, escapeHtml,
    escapeMarkdown, escapeCsv, formatFileReference, formatSize, formatCount,
    exportBomAsCsv, exportBomAsJson, exportBomAsMarkdown, setCurrentBom, getCurrentBom,
  };
});
