(function (root, factory) {
  const catalog = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = catalog;
  } else {
    root.WOODCASE_CATALOG = catalog;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    units: {
      length: "mm",
      quantity: "pcs",
    },
    parameters: {
      materialThicknessMm: {
        label: "Material thickness",
        values: [6, 7, 8, 9, 10, 11, 12],
        defaultValue: 6,
        unit: "mm",
      },
      widthBoxes: {
        label: "Width",
        values: [5, 6, 7, 8],
        defaultValue: 6,
        unit: "Boxes",
      },
      depthBoxes: {
        label: "Depth",
        values: [5, 6, 7],
        defaultValue: 5,
        unit: "Boxes",
      },
      heightLevel: {
        label: "Height",
        values: [2, 3, 4, 5, 6],
        defaultValue: 4,
        unit: "H",
      },
    },
    featureRules: {
      handle: {
        enabledWhen: { heightLevel: { min: 3 } },
        disabledReasonByHeight: {
          2: "2H case has no handle by design.",
        },
      },
    },
    dimensionFormulas: {
      frontBackLengthMm: {
        label: "55 * W",
        terms: [{ field: "widthBoxes", factor: 55 }],
      },
      frontBackHeightMm: {
        label: "18 * H + 4",
        constant: 4,
        terms: [{ field: "heightLevel", factor: 18 }],
      },
      sideLengthMm: {
        label: "55 * D + 2 * t",
        terms: [
          { field: "depthBoxes", factor: 55 },
          { field: "materialThicknessMm", factor: 2 },
        ],
      },
      sideHeightMm: {
        label: "18 * H + 4 + t",
        constant: 4,
        terms: [
          { field: "heightLevel", factor: 18 },
          { field: "materialThicknessMm", factor: 1 },
        ],
      },
      lidWidthMm: {
        label: "55 * W - 2",
        constant: -2,
        terms: [{ field: "widthBoxes", factor: 55 }],
      },
      lidHeightMm: {
        label: "55 * D + 2 * t",
        terms: [
          { field: "depthBoxes", factor: 55 },
          { field: "materialThicknessMm", factor: 2 },
        ],
      },
      bottomWidthMm: {
        label: "55 * W + 2 * t",
        terms: [
          { field: "widthBoxes", factor: 55 },
          { field: "materialThicknessMm", factor: 2 },
        ],
      },
      bottomHeightMm: {
        label: "55 * D + 2 * t",
        terms: [
          { field: "depthBoxes", factor: 55 },
          { field: "materialThicknessMm", factor: 2 },
        ],
      },
    },
    woodParts: [
      {
        id: "front-back",
        label: "Front/Back panel",
        quantity: 2,
        lengthKey: "frontBackLengthMm",
        widthKey: "frontBackHeightMm",
        source: "PDF sheet 2, Front and Back, Tables A/B",
      },
      {
        id: "side",
        label: "Side panel",
        quantity: 2,
        lengthKey: "sideLengthMm",
        widthKey: "sideHeightMm",
        source: "PDF sheet 3, Sides, Tables A/B",
      },
      {
        id: "lid",
        label: "Lid panel",
        quantity: 1,
        lengthKey: "lidWidthMm",
        widthKey: "lidHeightMm",
        source: "PDF sheet 4, Lid, Tables A/B",
      },
      {
        id: "bottom",
        label: "Bottom panel",
        quantity: 1,
        lengthKey: "bottomWidthMm",
        widthKey: "bottomHeightMm",
        source: "PDF sheet 5, Bottom, Tables A/B",
      },
    ],
    printedPartRules: [
      {
        id: "corners",
        label: "Corners",
        printedBodies: 4,
        stlPathPattern: "Case Parts/corners/corners {H}H/Corners_{H}H_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Corners_bambufile.3mf",
        note: "Corner set for selected height and material thickness.",
      },
      {
        id: "hinges",
        label: "Hinges",
        printedBodies: 4,
        stlPathPattern: "Case Parts/hinges/Hinges_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Hinges_Bambufile.3mf",
        note: "Hinge set for selected material thickness.",
      },
      {
        id: "locks",
        label: "Locks",
        printedBodies: 4,
        stlPathPattern: "Case Parts/Locks/Lock_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Locks_Bambufile.3mf",
        note: "Lock printed set for selected material thickness.",
      },
      {
        id: "lock-latch",
        label: "Lock latch",
        printedBodies: 2,
        stlPathPattern: "Case Parts/lock latches/Lock latch_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Lock latch_Bambufile.3mf",
        note: "Two latch bodies for selected material thickness.",
      },
      {
        id: "lip-5-wide",
        label: "Lip, 5 Boxes wide",
        when: { widthBoxes: { equals: 5 } },
        printedBodies: 1,
        stlPathPattern: "Case Parts/lips/Lip_5 wide_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Lips_Bambufile.3mf",
        note: "Lip variant for 5 Boxes width.",
      },
      {
        id: "lip-6-8-wide",
        label: "Lip, 6-8 Boxes wide",
        when: { widthBoxes: { range: [6, 8] } },
        printedBodies: 1,
        stlPathPattern: "Case Parts/lips/Lip_6-8 wide_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Lips_Bambufile.3mf",
        note: "Lip variant for 6-8 Boxes width.",
      },
      {
        id: "handle-3h",
        label: "Handle set, 3H",
        when: { heightLevel: { equals: 3 } },
        printedBodies: 2,
        stlPathPattern: "Case Parts/Handles_3H/Handle_3H_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Handles_Bambufile.3mf",
        note: "Handle set contains handle frame/mount and handle grip.",
      },
      {
        id: "label-3h",
        label: "Label, 3H",
        when: { heightLevel: { equals: 3 } },
        printedBodies: 1,
        stlPathPattern: "Case Parts/lables/Lable_3H.STL",
        bambuProjectPath: "Bambufiles/Lables_bambufile.3mf",
        note: "Label plate for 3H handle configuration.",
      },
      {
        id: "handle-4h-6h",
        label: "Handle set, 4H-6H",
        when: { heightLevel: { range: [4, 6] } },
        printedBodies: 2,
        stlPathPattern: "Case Parts/Handles_4H-6H/Handle_4H-6H_{t}mm.STL",
        bambuProjectPath: "Bambufiles/Handles_Bambufile.3mf",
        note: "Handle set contains handle frame/mount and handle grip.",
      },
      {
        id: "label-4h-6h",
        label: "Label, 4H-6H",
        when: { heightLevel: { range: [4, 6] } },
        printedBodies: 1,
        stlPathPattern: "Case Parts/lables/Lable_4H-6H.STL",
        bambuProjectPath: "Bambufiles/Lables_bambufile.3mf",
        note: "Label plate for 4H-6H handle configuration.",
      },
    ],
    recommendedPartRules: [
      {
        id: "template-front-back",
        label: "Front/back hole template",
        quantity: 1,
        stlPathPattern: "Case Parts/templates/front and back/Template_Front_{H}H_{W}wide.STL",
        note:
          "Optional flat 3D printed template for positioning holes on the front and back wooden panels.",
      },
      {
        id: "template-side",
        label: "Side hole template",
        quantity: 1,
        stlPathPattern: "Case Parts/templates/sides/Template_Side_{H}H_{t}mm.STL.stl",
        note:
          "Optional flat 3D printed template for positioning holes on side panels; selected by height and material thickness.",
      },
      {
        id: "template-lid-front",
        label: "Lid front hole template",
        quantity: 1,
        stlPathPattern: "Case Parts/templates/lid - front/Template_Lid front_{W}wide.STL",
        note:
          "Optional flat 3D printed template for positioning holes along the front edge of the lid.",
      },
      {
        id: "template-hinge-lid",
        label: "Hinge lid template",
        quantity: 1,
        stlPathPattern: "Case Parts/templates/Hinge - Lid/Template Hinge lid_all sizes.STL",
        note:
          "Optional flat 3D printed template for lid hinge hole positioning; one universal STL covers all supported sizes.",
      },
    ],
    hardwareRules: [
      {
        id: "nut-nyloc-m3",
        item: "Nut (Nyloc) M3",
        unit: "pcs",
        quantityRules: [
          { when: { heightLevel: { equals: 2 } }, quantity: 36 },
          { when: { heightLevel: { min: 3 } }, quantity: 40 },
        ],
        use: "Hex holes in printed parts.",
        search: "self locking nut M3, nyloc nut M3, DIN 985 M3",
      },
      {
        id: "nut-nyloc-m4",
        item: "Nut (Nyloc) M4",
        unit: "pcs",
        quantityRules: [
          { when: { heightLevel: { equals: 2 } }, quantity: 0 },
          { when: { heightLevel: { min: 3 } }, quantity: 2 },
        ],
        use: "Inside handle next to label.",
        search: "self locking nut M4, nyloc nut M4, DIN 985 M4",
      },
      {
        id: "m3-primary-countersunk",
        itemPattern: "Countersunk Bolt M3 x {length}",
        unit: "pcs",
        quantity: 30,
        lengthByThickness: {
          6: 12,
          7: 14,
          8: 14,
          9: 16,
          10: 16,
          11: 18,
          12: 18,
        },
        use: "Corners, hinges, lip, and lock part on lid.",
        searchPattern: "countersunk screw M3x{length}, DIN 7991 M3x{length}, ISO 10642 M3x{length}",
      },
      {
        id: "m3-frame-countersunk",
        itemPattern: "Countersunk Bolt M3 x {length}",
        unit: "pcs",
        quantityRules: [
          { when: { heightLevel: { equals: 2 } }, quantity: 4 },
          { when: { heightLevel: { min: 3 } }, quantity: 8 },
        ],
        lengthByThickness: {
          6: 18,
          7: 20,
          8: 20,
          9: 22,
          10: 22,
          11: 25,
          12: 25,
        },
        use: "Handle and lock attachment to frame; for 2H, lock attachment only.",
        searchPattern: "countersunk screw M3x{length}, DIN 7991 M3x{length}, ISO 10642 M3x{length}",
      },
      {
        id: "m3-hinge-countersunk-40",
        item: "Countersunk Bolt M3 x 40",
        unit: "pcs",
        quantity: 2,
        use: "Hinge.",
        search: "countersunk screw M3x40, DIN 7991 M3x40, ISO 10642 M3x40",
      },
      {
        id: "m4-socket-head-50",
        item: "Socket head Bolt M4 x 50",
        unit: "pcs",
        quantityRules: [
          { when: { heightLevel: { equals: 2 } }, quantity: 0 },
          { when: { heightLevel: { min: 3 } }, quantity: 2 },
        ],
        use: "Attach handle grip to handle frame.",
        search: "socket head cap screw M4x50, DIN 912 M4x50",
      },
    ],
    notes: {
      stlVs3mf:
        "Use STL files as ready 3D model files, or use Bambu 3MF project files if you prefer preset print settings.",
      noHandle2H: "2H case has no handle by design.",
    },
  };
});
