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
    return normalizeConfig(Object.fromEntries(
      Object.entries({ ...catalog.parameters, ...catalog.buildOptions }).map(([key, spec]) => [key, spec.defaultValue]),
    ));
  }

  function normalizeConfig(input) {
    const result = {};
    for (const [key, spec] of Object.entries({ ...catalog.parameters, ...catalog.buildOptions })) {
      const rawValue = input && input[key] !== undefined ? input[key] : spec.defaultValue;
      const numericValues = spec.values.every((value) => typeof value === "number");
      const value = numericValues ? Number(rawValue) : rawValue;
      if (!spec.values.includes(value)) {
        throw new Error(`${key} must be one of ${spec.values.join(", ")}`);
      }
      result[key] = value;
    }
    result.lidMaterial = result.clearLid ? "clear plastic" : "wood";
    if (!result.clearLid) result.lidThicknessMm = result.materialThicknessMm;
    if (result.heightLevel !== 2) result.handle2H = "none";
    if (result.lipStyle === "thin" && (result.widthBoxes === 5 || result.lidThicknessMm < 6)) {
      throw new Error("Thin lip requires 6–8 boxes width and a 6–12 mm lid");
    }
    if (result.cornerFastening === "wood-screws") {
      const wall = catalog.screwCorners.printedWallMm[result.materialThicknessMm];
      if (!wall) throw new Error("Wood-screw corners require strong wood / plywood 9–12 mm thick");
      const length = result.cornerScrewLengthMm;
      if (length && (length <= wall || length >= wall + result.materialThicknessMm)) throw new Error("Corner screw length must enter the wood without reaching its inner face");
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
        category: part.id === "lid" && config.clearLid ? "sheet" : "wood",
        material: part.id === "lid" && config.clearLid ? config.lidMaterial : "wood",
        id: part.id,
        item: part.id === "lid" && config.clearLid ? `${config.lidMaterial} lid panel` : part.label,
        quantity: part.quantity,
        unit: "pcs",
        lengthMm,
        widthMm,
        thicknessMm: part.id === "lid" ? config.lidThicknessMm : config.materialThicknessMm,
        formula: formatFormulaPair(part.lengthKey, part.widthKey),
        note: part.source,
      };
    });
  }

  function calculatePrintedParts(configInput) {
    const config = normalizeConfig(configInput);
    const parts = catalog.printedPartRules
      .filter((rule) => matchesRule(config, rule.when))
      .map((rule) => {
        const lidPart = ["hinges", "lock-latch"].includes(rule.id) || rule.id.startsWith("lip-");
        let stlFile = formatCatalogPath(rule.stlPathPattern, config, { t: lidPart ? config.lidThicknessMm : config.materialThicknessMm });
        if (lidPart && config.lidThicknessMm < 6) stlFile = stlFile.replace(/\.STL$/, ".stl");
        if (rule.id.startsWith("lip-") && config.lipStyle === "thin") stlFile = stlFile.replace("Lip_6-8", "Lip_Thin_6-8").replace(/\.STL$/, ".stl");
        const bambu3mfFile = rule.bambuProjectPath || "";
        return {
          category: "printed",
          id: rule.id,
          item: rule.label,
          quantity: rule.printedBodies,
          unit: "printed bodies",
          stlFile,
          bambu3mfFile,
          note: lidPart ? `${rule.id.startsWith("lip-") ? config.lipStyle + " lip. " : ""}Use ${config.lidThicknessMm} mm lid parts. Hinges include both leaves; keep body lock parts at ${config.materialThicknessMm} mm. Check the selected STL; Bambu projects are examples, not every variant.` : rule.note,
        };
      });
    return parts;
  }

  function calculateRecommendedParts(configInput) {
    const config = normalizeConfig(configInput);
    return (catalog.recommendedPartRules || [])
      .filter((rule) => matchesRule(config, rule.when) && !(rule.id === "template-side" && config.cornerFastening === "wood-screws"))
      .map((rule) => {
        let stlFile = formatCatalogPath(rule.stlPathPattern, config);
        if (rule.id === "template-front-back" && config.heightLevel === 2) stlFile = stlFile.replace(".STL", "_v2.stl");
        return {
          category: "recommended",
          id: rule.id,
          item: rule.label,
          quantity: rule.quantity,
          unit: "optional template",
          stlFile,
          bambu3mfFile: "",
          note: (rule.id === "template-front-back" && config.cornerFastening === "wood-screws" ? "Skip corner through-holes; use this template only for the front locks/handle and rear hinges. " : "") + (rule.id === "template-front-back" && config.heightLevel === 2
            ? `Use the updated 2H v2 template; the old STL is empty. ${config.handle2H === "fixed" ? "Drill the four low central handle holes on the FRONT only; skip them on the back." : "Skip the four low central handle holes on BOTH front and back."}`
            : rule.note),
        };
      });
  }

  function getCornerScrewSpec(config) {
    const printedWallMm = catalog.screwCorners.printedWallMm[config.materialThicknessMm];
    const lengthMm = config.cornerScrewLengthMm || config.materialThicknessMm + printedWallMm - 1;
    return { printedWallMm, lengthMm, penetrationMm: lengthMm - printedWallMm, suggested: !config.cornerScrewLengthMm };
  }

  function calculateHardware(configInput) {
    const config = normalizeConfig(configInput);
    const rows = catalog.hardwareRules
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
    if (config.heightLevel === 2 && config.handle2H === "fixed") {
      rows.find((row) => row.id === "nut-nyloc-m3").quantity += 4;
      const frameBolts = rows.find((row) => row.id === "m3-frame-countersunk");
      frameBolts.quantity += 4;
      frameBolts.use = "Fixed 2H handle: 4 bolts; front lock bases: 4 bolts. Check handle bolt engagement / protrusion.";
      frameBolts.note = `${frameBolts.use} Search: ${frameBolts.search}`;
    }
    if (config.clearLid && config.lidThicknessMm !== config.materialThicknessMm) {
      const bodyBolts = rows.find((row) => row.id === "m3-primary-countersunk");
      bodyBolts.quantity -= 10;
      bodyBolts.use = "Body only: 20 corner bolts including the bottom, plus 4 rear hinge attachment bolts.";
      bodyBolts.note = `${bodyBolts.use} Search: ${bodyBolts.search}`;
      const length = catalog.lidBoltLengths[config.lidThicknessMm];
      rows.push({ category: "hardware", id: "m3-lid-countersunk", item: `Countersunk Bolt M3 x ${length}`, quantity: 10, unit: "pcs", use: "Lid only: 4 hinge, 4 latch and 2 lip bolts.", search: `countersunk screw M3x${length}`, note: "10 lid attachments; 3–5 mm lengths are inferred from the original PDF allowance, verify engagement and countersink with the printed parts." });
    }
    if (config.cornerFastening === "wood-screws") {
      const count = catalog.screwCorners.screwsPerCase;
      const primary = rows.find((row) => row.id === "m3-primary-countersunk");
      primary.quantity -= count;
      primary.use = config.clearLid && config.lidThicknessMm !== config.materialThicknessMm
        ? "Body only: 4 rear hinge attachment bolts."
        : "Hinges, lid latches and lip; corners use wood screws.";
      primary.note = `${primary.use} Search: ${primary.search}`;
      rows.find((row) => row.id === "nut-nyloc-m3").quantity -= count;
      const screw = getCornerScrewSpec(config);
      const use = `Five per corner including the bottom; ${screw.lengthMm} mm length (${screw.suggested ? "calculated suggestion" : "selected"}), ${screw.penetrationMm} mm nominal penetration with the head flush. A recessed head increases penetration. Choose a screw matching the ${catalog.screwCorners.passageDiameterMm} mm passage and ${catalog.screwCorners.countersinkDiameterMm} mm countersink.`;
      rows.push({ category: "hardware", id: "corner-wood-screw", item: `Countersunk wood screw, ${screw.lengthMm} mm long`, quantity: count, unit: "pcs", use, search: "countersunk wood screw", note: `${use} Printed wall: ${screw.printedWallMm} mm. Nominal screw diameter and length are not specified by the author; test the actual screw head, print and wood.` });
    }
    return rows;
  }

  function calculateNotes(configInput) {
    const config = normalizeConfig(configInput);
    const notes = [catalog.notes.stlVs3mf];
    if (config.heightLevel === 2 && config.handle2H !== "fixed") {
      notes.push(catalog.featureRules.handle.disabledReasonByHeight[config.heightLevel]);
    }
    if (config.handle2H === "fixed") notes.push("2H fixed handle: use the updated front template and four M3 mounting bolts/nuts; no handle pivot hardware. Mounting bolt lengths reuse the original frame schedule based on the measured backing plate and nut-pocket stack; check thread engagement and tip protrusion before tightening. Keep the original back-panel holes.");
    if (config.clearLid) notes.push(`Cut a solid ${config.lidThicknessMm} mm ${config.lidMaterial} lid to the listed size; keep the body panel dimensions. Use the original lid drill templates and ${config.lidThicknessMm} mm hinges, latches and lip. The grid remains on the inside bottom; no printed lid frame is required.`, "Mixed-thickness lid placement is shown resting on the front/back panels; it is flush with the side tops only when the lid and body thicknesses match. Trial-fit the hinges and latch before final assembly.");
    if (config.clearLid && config.lidThicknessMm < 6) notes.push("A 3–5 mm lid can flex: the author demonstrated support from full-height inserts, not a load rating. The original hardware PDF covers 6–12 mm only; check the proposed lid bolt lengths against your parts.");
    if (config.clearLid && config.lidThicknessMm > config.materialThicknessMm) notes.push(`The lid projects ${config.lidThicknessMm - config.materialThicknessMm} mm above the side panels. Check latch fit and stacking clearance; this thickness combination was not demonstrated in the source.`);
    if (config.cornerFastening === "wood-screws") {
      const screw = getCornerScrewSpec(config);
      notes.push(`Fit the dedicated screw corners and fasten from outside with 20 countersunk wood screws, including four underneath. The corner through-holes are omitted from the panel drawings and DXFs. Mark and pilot-drill through the fitted corners as appropriate for your wood; do not use the bolt template at the corners.`, `Use strong wood / plywood 9–12 mm thick, not MDF. The printed wall is ${screw.printedWallMm} mm: the ${screw.suggested ? "suggested" : "selected"} ${screw.lengthMm} mm screw enters the wood by ${screw.penetrationMm} mm nominally. The source supplies geometry, not a screw specification; check head seating and tip clearance with the real parts.`, "Only the corners switch to wood screws. Hinges, locks, lip and handle keep their machine bolts and captured nuts; hinge axles are unchanged.");
    } else notes.push("Machine bolts pass from inside through the panel into captured nuts in the printed parts. Each corner uses four wall bolts and one bottom bolt (20 total); the eight hinge attachment bolts, four latch bolts and two lip bolts make 34 primary M3 bolts.");
    notes.push("The internal grid is printed and glued to the bottom.");
    return notes.filter(Boolean);
  }

  function buildBom(configInput) {
    const configuration = normalizeConfig(configInput);
    const dimensions = calculateDerivedDimensions(configuration);
    const hasHandle = configuration.handle2H === "fixed" || matchesRule(configuration, catalog.featureRules.handle.enabledWhen);
    return {
      configuration: {
        ...configuration,
        hasHandle,
        handleStyle: hasHandle ? (configuration.heightLevel === 2 ? "fixed" : "hinged") : "none",
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
      "material",
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
        part.material,
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
      ...bom.notes.map((note) => ["assembly-note", "", "", "", "", "", "", "", "", note]),
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
    return [header, ...rows.map((row) => row.length < header.length ? [...row, ""] : row)].map((row) => row.map(escapeCsv).join(",")).join("\n");
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
      `- Lid: ${config.clearLid ? config.lidMaterial : "wood"}, ${config.lidThicknessMm} mm`,
      `- Lip: ${config.lipStyle}; handle style: ${config.handleStyle}; corners: ${config.cornerFastening}`,
      "",
      "## Sheet Parts",
      "",
      "| Part | Material | Quantity | Size | Thickness | Formula |",
      "|---|---|---:|---|---:|---|",
      ...bom.woodParts.map(
        (part) =>
          `| ${escapeMarkdown(part.item)} | ${escapeMarkdown(part.material)} | ${part.quantity} | ${formatSize(part.lengthMm, part.widthMm)} | ${part.thicknessMm} mm | \`${escapeMarkdown(part.formula)}\` |`,
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
    calculateRecommendedParts, getCornerScrewSpec, calculateHardware, calculateNotes, buildBom, escapeHtml,
    escapeMarkdown, escapeCsv, formatFileReference, formatSize, formatCount,
    exportBomAsCsv, exportBomAsJson, exportBomAsMarkdown, setCurrentBom, getCurrentBom,
  };
});
