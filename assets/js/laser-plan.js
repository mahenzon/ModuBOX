(function (root, factory) {
  let planner = root.WOODCASE_SHEET_PLANNER;
  if (typeof module === "object" && module.exports) {
    planner = require("./sheet-planner.js");
    module.exports = factory(planner);
  } else {
    root.WOODCASE_LASER_PLAN = factory(planner);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (planner) {
  "use strict";

  if (!planner) throw new Error("WOODCASE_SHEET_PLANNER is required");
  const MIN_NESTING_GAP_MM = 0.1;

  function normalizeLaserOptions(optionsInput) {
    const options = planner.normalizeWoodSheetOptions({
      ...(optionsInput || {}),
      cutThroughOnly: false,
    });
    if (options.kerfMm < MIN_NESTING_GAP_MM) {
      throw new Error(
        `Full laser export requires a nesting gap of at least ${MIN_NESTING_GAP_MM} mm`,
      );
    }
    return {
      ...options,
      cutThroughOnly: false,
      nestingGapMm: options.kerfMm,
      packingRoute: "laser-compact",
    };
  }

  function calculateLaserPlan(bom, optionsInput) {
    const options = normalizeLaserOptions(optionsInput);
    return {
      ...planner.calculateWoodSheetPlan(bom, options),
      cutThroughOnly: false,
      nestingGapMm: options.nestingGapMm,
      packingRoute: options.packingRoute,
    };
  }

  return { MIN_NESTING_GAP_MM, normalizeLaserOptions, calculateLaserPlan };
});
