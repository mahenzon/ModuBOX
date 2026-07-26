(function (root, factory) {
  const adapter = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = adapter;
  } else {
    root.WOODCASE_DRILL_MARKERS_3D = adapter;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createDrillMarkerPlan(geometry, dimensions, epsilonInput) {
    if (!geometry || !Array.isArray(geometry.parts)) return [];
    const epsilon = Number(epsilonInput === undefined ? 0.08 : epsilonInput);
    const byRole = new Map(geometry.parts.map((part) => [part.role, part]));
    const outerWidth = dimensions.bottomWidthMm;
    const outerDepth = dimensions.bottomHeightMm;
    const mapPart = (role, parent, position, rotation) => {
      const part = byRole.get(role);
      return part.holes.map((hole) => ({
        id: hole.id,
        role,
        parent,
        family: hole.family,
        diameterMm: hole.diameterMm,
        radiusMm: hole.diameterMm / 2,
        position: position(hole, part),
        rotation,
      }));
    };
    return [
      ...mapPart(
        "front",
        "case",
        (hole, part) => [hole.xMm - part.widthMm / 2, hole.yMm, outerDepth / 2 + epsilon],
        [0, 0, 0],
      ),
      ...mapPart(
        "back",
        "case",
        (hole, part) => [part.widthMm / 2 - hole.xMm, hole.yMm, -outerDepth / 2 - epsilon],
        [0, Math.PI, 0],
      ),
      ...mapPart(
        "left-side",
        "case",
        (hole) => [-outerWidth / 2 - epsilon, hole.yMm, -outerDepth / 2 + hole.xMm],
        [0, -Math.PI / 2, 0],
      ),
      ...mapPart(
        "right-side",
        "case",
        (hole) => [outerWidth / 2 + epsilon, hole.yMm, outerDepth / 2 - hole.xMm],
        [0, Math.PI / 2, 0],
      ),
      ...mapPart(
        "lid",
        "lid",
        (hole, part) => [hole.xMm - part.widthMm / 2, epsilon, part.heightMm - hole.yMm],
        [-Math.PI / 2, 0, 0],
      ),
      ...mapPart(
        "bottom",
        "case",
        (hole, part) => [
          hole.xMm - part.widthMm / 2,
          -epsilon,
          part.heightMm / 2 - hole.yMm,
        ],
        [Math.PI / 2, 0, 0],
      ),
    ];
  }

  return { createDrillMarkerPlan };
});
