(function (root, factory) {
  let core = root.WOODCASE_CORE;
  if (typeof module === "object" && module.exports) {
    core = require("./core.js");
    module.exports = factory(core);
  } else {
    root.WOODCASE_SHEET_PLANNER = factory(core);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("WOODCASE_CORE is required");
  const { formatCount, formatSize, getCurrentBom } = core;
  const woodSheetPlanCache = new Map();

  function formatSetLetter(index) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let value = index;
    let label = "";
    do {
      label = alphabet[value % alphabet.length] + label;
      value = Math.floor(value / alphabet.length) - 1;
    } while (value >= 0);
    return label;
  }

  function expandWoodPieces(bomInput, caseSetCountInput) {
    const bom = bomInput || getCurrentBom();
    const caseSetCount = caseSetCountInput === undefined ? 1 : Number(caseSetCountInput);
    const basePieces = [];
    for (const part of bom.woodParts) {
      for (let index = 1; index <= part.quantity; index += 1) {
        basePieces.push({
          id: `${part.id}-${index}`,
          partId: part.id,
          item: part.item,
          partCopy: index,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          areaMm2: part.lengthMm * part.widthMm,
        });
      }
    }
    basePieces.sort(
      (a, b) => b.areaMm2 - a.areaMm2 || Math.max(b.lengthMm, b.widthMm) - Math.max(a.lengthMm, a.widthMm),
    );
    return Array.from({ length: caseSetCount }, (_value, setIndex) => {
      const setLetter = formatSetLetter(setIndex);
      return basePieces.map((piece, pieceIndex) => ({
        ...piece,
        id: `${piece.id}-${setLetter}`,
        mark: `${pieceIndex + 1}${setLetter}`,
        setIndex: setIndex + 1,
        setLetter,
        pieceNumber: pieceIndex + 1,
      }));
    }).flat();
  }

  function normalizeCaseSetCount(value) {
    const caseSetCount = Number(value === undefined ? 1 : value);
    if (!Number.isInteger(caseSetCount) || caseSetCount < 1 || caseSetCount > 6) {
      throw new Error("Case sets must be a whole number from 1 to 6");
    }
    return caseSetCount;
  }

  function normalizeWoodSheetOptions(input) {
    const options = {
      caseSetCount: normalizeCaseSetCount(input && input.caseSetCount),
      sheetLengthMm: Number(input && input.sheetLengthMm !== undefined ? input.sheetLengthMm : 1000),
      sheetWidthMm: Number(input && input.sheetWidthMm !== undefined ? input.sheetWidthMm : 500),
      kerfMm: Number(input && input.kerfMm !== undefined ? input.kerfMm : 3),
      allowRotation: input && input.allowRotation !== undefined ? Boolean(input.allowRotation) : true,
      cutThroughOnly: input && input.cutThroughOnly !== undefined ? Boolean(input.cutThroughOnly) : false,
    };
    if (!Number.isFinite(options.sheetLengthMm) || options.sheetLengthMm <= 0) {
      throw new Error("Sheet length must be greater than 0");
    }
    if (!Number.isFinite(options.sheetWidthMm) || options.sheetWidthMm <= 0) {
      throw new Error("Sheet width must be greater than 0");
    }
    if (!Number.isFinite(options.kerfMm) || options.kerfMm < 0) {
      throw new Error("Kerf / gap must be 0 or greater");
    }
    return options;
  }

  function getPieceOrientations(piece, options) {
    const orientations = [
      {
        width: piece.lengthMm,
        height: piece.widthMm,
        rotated: false,
      },
    ];
    if (options.allowRotation && piece.lengthMm !== piece.widthMm) {
      orientations.push({
        width: piece.widthMm,
        height: piece.lengthMm,
        rotated: true,
      });
    }
    return orientations;
  }

  function makeSinglePackingUnits(pieces) {
    return pieces.map((piece) => ({
      ...piece,
      batchPieces: [{
        piece,
        x: 0,
        y: 0,
        width: piece.lengthMm,
        height: piece.widthMm,
      }],
      internalCut: null,
    }));
  }

  function getBatchCapacity(shortSide, longSide, options) {
    if (options.allowRotation) {
      const alongLength = longSide <= options.sheetWidthMm
        ? Math.floor((options.sheetLengthMm + options.kerfMm) / (shortSide + options.kerfMm))
        : 0;
      const alongWidth = longSide <= options.sheetLengthMm
        ? Math.floor((options.sheetWidthMm + options.kerfMm) / (shortSide + options.kerfMm))
        : 0;
      return Math.max(1, alongLength, alongWidth);
    }
    if (longSide > options.sheetLengthMm) {
      return 1;
    }
    return Math.max(
      1,
      Math.floor((options.sheetWidthMm + options.kerfMm) / (shortSide + options.kerfMm)),
    );
  }

  function makeGroupedPackingUnits(pieces, options, maxBatchSize) {
    const groups = new Map();
    for (const piece of pieces) {
      const key = options.allowRotation
        ? [Math.min(piece.lengthMm, piece.widthMm), Math.max(piece.lengthMm, piece.widthMm)].join("x")
        : [piece.lengthMm, piece.widthMm].join("x");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(piece);
    }

    const units = [];
    for (const group of groups.values()) {
      const first = group[0];
      const shortSide = options.allowRotation
        ? Math.min(first.lengthMm, first.widthMm)
        : first.widthMm;
      const longSide = options.allowRotation
        ? Math.max(first.lengthMm, first.widthMm)
        : first.lengthMm;
      if (longSide / shortSide < 2.5) {
        units.push(...makeSinglePackingUnits(group));
        continue;
      }
      const capacity = Math.min(
        getBatchCapacity(shortSide, longSide, options),
        maxBatchSize || Number.POSITIVE_INFINITY,
      );
      for (let offset = 0; offset < group.length; offset += capacity) {
        const chunk = group.slice(offset, offset + capacity);
        if (chunk.length === 1) {
          units.push(...makeSinglePackingUnits(chunk));
          continue;
        }
        const batchWidth = chunk.length * shortSide + (chunk.length - 1) * options.kerfMm;
        const batchHeight = longSide;
        units.push({
          id: `batch-${chunk.map((piece) => piece.id).join("-")}`,
          item: `${chunk.length} matching panels`,
          lengthMm: batchWidth,
          widthMm: batchHeight,
          areaMm2: batchWidth * batchHeight,
          pieceNumber: Math.min(...chunk.map((piece) => piece.pieceNumber)),
          setIndex: Math.min(...chunk.map((piece) => piece.setIndex)),
          batchPieces: chunk.map((piece, index) => ({
            piece,
            x: index * (shortSide + options.kerfMm),
            y: 0,
            width: shortSide,
            height: longSide,
          })),
          internalCut: {
            count: chunk.length - 1,
            orientation: "vertical",
            coordinates: chunk.slice(1).map((_piece, index) => (index + 1) * shortSide + index * options.kerfMm),
            from: 0,
            to: longSide,
            marks: chunk.map((piece) => piece.mark),
            partSize: formatSize(first.lengthMm, first.widthMm),
          },
        });
      }
    }
    return units;
  }

  function placementOverlaps(placement, sheet, kerfMm) {
    return sheet.placements.some((existing) => {
      const separateX =
        placement.x + placement.width + kerfMm <= existing.x ||
        existing.x + existing.width + kerfMm <= placement.x;
      const separateY =
        placement.y + placement.height + kerfMm <= existing.y ||
        existing.y + existing.height + kerfMm <= placement.y;
      return !(separateX || separateY);
    });
  }

  function getCandidatePoints(sheet, options) {
    const xValues = new Set([0]);
    const yValues = new Set([0]);
    for (const placed of sheet.placements) {
      xValues.add(placed.x + placed.width + options.kerfMm);
      yValues.add(placed.y + placed.height + options.kerfMm);
    }
    return [...xValues]
      .flatMap((x) => [...yValues].map((y) => ({ x, y })))
      .filter((point) => point.x <= options.sheetLengthMm && point.y <= options.sheetWidthMm)
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function canPieceFitAnySheet(piece, options) {
    return getPieceOrientations(piece, options).some(
      (orientation) =>
        orientation.width <= options.sheetLengthMm && orientation.height <= options.sheetWidthMm,
    );
  }

  function rectsIntersect(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function createPackingSheets(options, sheetCount) {
    return Array.from({ length: sheetCount }, (_value, index) => ({
      index: index + 1,
      lengthMm: options.sheetLengthMm,
      widthMm: options.sheetWidthMm,
      placements: [],
      outerCuts: [],
      freeRects: [{ x: 0, y: 0, width: options.sheetLengthMm, height: options.sheetWidthMm }],
    }));
  }

  function splitFreeRect(freeRect, blockedRect) {
    if (!rectsIntersect(freeRect, blockedRect)) {
      return [freeRect];
    }
    const result = [];
    const freeRight = freeRect.x + freeRect.width;
    const freeBottom = freeRect.y + freeRect.height;
    const blockedRight = blockedRect.x + blockedRect.width;
    const blockedBottom = blockedRect.y + blockedRect.height;

    if (blockedRect.x > freeRect.x) {
      result.push({
        x: freeRect.x,
        y: freeRect.y,
        width: blockedRect.x - freeRect.x,
        height: freeRect.height,
      });
    }
    if (blockedRight < freeRight) {
      result.push({
        x: blockedRight,
        y: freeRect.y,
        width: freeRight - blockedRight,
        height: freeRect.height,
      });
    }
    if (blockedRect.y > freeRect.y) {
      result.push({
        x: freeRect.x,
        y: freeRect.y,
        width: freeRect.width,
        height: blockedRect.y - freeRect.y,
      });
    }
    if (blockedBottom < freeBottom) {
      result.push({
        x: freeRect.x,
        y: blockedBottom,
        width: freeRect.width,
        height: freeBottom - blockedBottom,
      });
    }
    return result.filter((rect) => rect.width > 0 && rect.height > 0);
  }

  function containsRect(outer, inner) {
    return (
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height
    );
  }

  function pruneFreeRects(rects) {
    return rects.filter(
      (rect, index) =>
        !rects.some((candidate, candidateIndex) => candidateIndex !== index && containsRect(candidate, rect)),
    );
  }

  function placePieceOnSheet(sheet, placement, options) {
    sheet.placements.push(placement);
    const blocked = {
      x: placement.x,
      y: placement.y,
      width: placement.width + options.kerfMm,
      height: placement.height + options.kerfMm,
    };
    sheet.freeRects = pruneFreeRects(
      sheet.freeRects.flatMap((freeRect) => splitFreeRect(freeRect, blocked)),
    );
  }

  function getGuillotineRemainders(freeRect, placement, options, splitDirection) {
    const usedWidth = Math.min(
      freeRect.width,
      placement.width + (placement.width < freeRect.width ? options.kerfMm : 0),
    );
    const usedHeight = Math.min(
      freeRect.height,
      placement.height + (placement.height < freeRect.height ? options.kerfMm : 0),
    );
    const rightWidth = freeRect.width - usedWidth;
    const bottomHeight = freeRect.height - usedHeight;
    const remainders = splitDirection === "vertical-first"
      ? [
          { x: freeRect.x + usedWidth, y: freeRect.y, width: rightWidth, height: freeRect.height },
          { x: freeRect.x, y: freeRect.y + usedHeight, width: placement.width, height: bottomHeight },
        ]
      : [
          { x: freeRect.x, y: freeRect.y + usedHeight, width: freeRect.width, height: bottomHeight },
          { x: freeRect.x + usedWidth, y: freeRect.y, width: rightWidth, height: placement.height },
        ];
    return remainders.filter((rect) => rect.width > 0 && rect.height > 0);
  }

  function findBestGuillotinePlacement(piece, sheets, options) {
    let best = null;
    for (const sheet of sheets) {
      for (let freeRectIndex = 0; freeRectIndex < sheet.freeRects.length; freeRectIndex += 1) {
        const freeRect = sheet.freeRects[freeRectIndex];
        for (const orientation of getPieceOrientations(piece, options)) {
          if (orientation.width > freeRect.width || orientation.height > freeRect.height) {
            continue;
          }
          const placement = {
            ...piece,
            x: freeRect.x,
            y: freeRect.y,
            width: orientation.width,
            height: orientation.height,
            rotated: orientation.rotated,
          };
          for (const splitDirection of ["vertical-first", "horizontal-first"]) {
            const remainders = getGuillotineRemainders(
              freeRect,
              placement,
              options,
              splitDirection,
            );
            const candidate = {
              sheet,
              freeRectIndex,
              freeRect,
              placement,
              remainders,
              splitDirection,
              areaWaste: freeRect.width * freeRect.height - orientation.width * orientation.height,
              shortSideWaste: Math.min(
                freeRect.width - orientation.width,
                freeRect.height - orientation.height,
              ),
              largestRemainderArea: Math.max(
                0,
                ...remainders.map((rect) => rect.width * rect.height),
              ),
            };
            if (
              !best ||
              candidate.areaWaste < best.areaWaste ||
              (candidate.areaWaste === best.areaWaste &&
                candidate.shortSideWaste < best.shortSideWaste) ||
              (candidate.areaWaste === best.areaWaste &&
                candidate.shortSideWaste === best.shortSideWaste &&
                candidate.largestRemainderArea > best.largestRemainderArea) ||
              (candidate.areaWaste === best.areaWaste &&
                candidate.shortSideWaste === best.shortSideWaste &&
                candidate.largestRemainderArea === best.largestRemainderArea &&
                candidate.sheet.index < best.sheet.index)
            ) {
              best = candidate;
            }
          }
        }
      }
    }
    return best;
  }

  function placePieceGuillotine(candidate) {
    const { freeRect, placement, splitDirection } = candidate;
    const targetMarks = placement.batchPieces.map(({ piece }) => piece.mark);
    const verticalCut = {
      kind: "breakdown",
      count: 1,
      targetMarks,
      lines: [{
        orientation: "vertical",
        coordinate: placement.x + placement.width,
        from: freeRect.y,
        to: freeRect.y + freeRect.height,
      }],
    };
    const horizontalCut = {
      kind: "breakdown",
      count: 1,
      targetMarks,
      lines: [{
        orientation: "horizontal",
        coordinate: placement.y + placement.height,
        from: freeRect.x,
        to: freeRect.x + freeRect.width,
      }],
    };
    if (splitDirection === "vertical-first") {
      if (placement.width < freeRect.width) candidate.sheet.outerCuts.push(verticalCut);
      if (placement.height < freeRect.height) {
        horizontalCut.lines[0].to = placement.x + placement.width;
        candidate.sheet.outerCuts.push(horizontalCut);
      }
    } else {
      if (placement.height < freeRect.height) candidate.sheet.outerCuts.push(horizontalCut);
      if (placement.width < freeRect.width) {
        verticalCut.lines[0].to = placement.y + placement.height;
        candidate.sheet.outerCuts.push(verticalCut);
      }
    }
    candidate.sheet.placements.push(candidate.placement);
    candidate.sheet.freeRects.splice(
      candidate.freeRectIndex,
      1,
      ...candidate.remainders,
    );
  }

  function expandPackingSheet(sheet) {
    const placements = [];
    const batchCuts = [];
    for (const unit of sheet.placements) {
      for (const local of unit.batchPieces) {
        const x = unit.rotated ? unit.x + local.y : unit.x + local.x;
        const y = unit.rotated ? unit.y + local.x : unit.y + local.y;
        const width = unit.rotated ? local.height : local.width;
        const height = unit.rotated ? local.width : local.height;
        placements.push({
          ...local.piece,
          x,
          y,
          width,
          height,
          rotated: width !== local.piece.lengthMm || height !== local.piece.widthMm,
        });
      }
      if (unit.internalCut) {
        const lines = unit.internalCut.coordinates.map((coordinate) => unit.rotated
          ? {
              orientation: "horizontal",
              coordinate: unit.y + coordinate,
              from: unit.x + unit.internalCut.from,
              to: unit.x + unit.internalCut.to,
            }
          : {
              orientation: "vertical",
              coordinate: unit.x + coordinate,
              from: unit.y + unit.internalCut.from,
              to: unit.y + unit.internalCut.to,
            });
        batchCuts.push({
          ...unit.internalCut,
          kind: "batch",
          orientation: unit.rotated ? "horizontal" : "vertical",
          lines,
        });
      }
    }
    const cutPlan = [...sheet.outerCuts, ...batchCuts].map((cut, index) => ({
      ...cut,
      step: index + 1,
    }));
    const cutCount = cutPlan.reduce((sum, cut) => sum + cut.count, 0);
    return {
      index: sheet.index,
      lengthMm: sheet.lengthMm,
      widthMm: sheet.widthMm,
      placements,
      cutPlan,
      cutCount,
    };
  }

  function findBestPlacement(piece, sheets, options) {
    let best = null;
    for (const sheet of sheets) {
      for (const freeRect of sheet.freeRects) {
        for (const orientation of getPieceOrientations(piece, options)) {
          if (orientation.width > freeRect.width || orientation.height > freeRect.height) {
            continue;
          }
          const candidate = {
            sheet,
            placement: {
              ...piece,
              x: freeRect.x,
              y: freeRect.y,
              width: orientation.width,
              height: orientation.height,
              rotated: orientation.rotated,
            },
            areaWaste: freeRect.width * freeRect.height - orientation.width * orientation.height,
            shortSideWaste: Math.min(freeRect.width - orientation.width, freeRect.height - orientation.height),
            longSideWaste: Math.max(freeRect.width - orientation.width, freeRect.height - orientation.height),
          };
          if (placementOverlaps(candidate.placement, sheet, options.kerfMm)) {
            continue;
          }
          if (
            !best ||
            candidate.areaWaste < best.areaWaste ||
            (candidate.areaWaste === best.areaWaste && candidate.shortSideWaste < best.shortSideWaste) ||
            (candidate.areaWaste === best.areaWaste &&
              candidate.shortSideWaste === best.shortSideWaste &&
              candidate.longSideWaste < best.longSideWaste) ||
            (candidate.areaWaste === best.areaWaste &&
              candidate.shortSideWaste === best.shortSideWaste &&
              candidate.longSideWaste === best.longSideWaste &&
              candidate.sheet.index < best.sheet.index)
          ) {
            best = candidate;
          }
        }
      }
    }
    return best;
  }

  function makePackingOrders(pieces) {
    const withOriginalIndex = pieces.map((piece, index) => ({ ...piece, originalIndex: index }));
    const sorters = [
      (a, b) => Math.max(b.lengthMm, b.widthMm) - Math.max(a.lengthMm, a.widthMm) || b.areaMm2 - a.areaMm2,
      (a, b) => b.areaMm2 - a.areaMm2 || Math.max(b.lengthMm, b.widthMm) - Math.max(a.lengthMm, a.widthMm),
      (a, b) => b.lengthMm - a.lengthMm || b.widthMm - a.widthMm,
      (a, b) => b.widthMm - a.widthMm || b.lengthMm - a.lengthMm,
      (a, b) => a.pieceNumber - b.pieceNumber || a.setIndex - b.setIndex,
      (a, b) => a.setIndex - b.setIndex || a.pieceNumber - b.pieceNumber,
    ];
    const seen = new Set();
    return sorters
      .map((sorter) => withOriginalIndex.slice().sort(sorter))
      .filter((order) => {
        const key = order.map((piece) => piece.id).join("|");
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function packPiecesGreedy(pieces, options, sheetCount, order) {
    const sheets = createPackingSheets(options, sheetCount);
    for (const piece of order) {
      const candidate = options.cutThroughOnly
        ? findBestGuillotinePlacement(piece, sheets, options)
        : findBestPlacement(piece, sheets, options);
      if (!candidate) {
        return null;
      }
      if (options.cutThroughOnly) {
        placePieceGuillotine(candidate);
      } else {
        placePieceOnSheet(candidate.sheet, candidate.placement, options);
      }
    }
    return sheets.map(expandPackingSheet);
  }

  function tryPackPiecesInSheetCount(pieces, options, sheetCount) {
    const packingUnitSets = options.cutThroughOnly
      ? [
          makeGroupedPackingUnits(pieces, options),
          makeGroupedPackingUnits(pieces, options, 4),
          makeGroupedPackingUnits(pieces, options, 3),
          makeGroupedPackingUnits(pieces, options, 2),
          makeSinglePackingUnits(pieces),
        ]
      : [makeSinglePackingUnits(pieces)];
    let best = null;
    for (const units of packingUnitSets) {
      for (const order of makePackingOrders(units)) {
        const sheets = packPiecesGreedy(units, options, sheetCount, order);
        if (!sheets) continue;
        const cutCount = sheets.reduce((sum, sheet) => sum + sheet.cutCount, 0);
        const rotationCount = sheets.reduce(
          (sum, sheet) => sum + sheet.placements.filter((placement) => placement.rotated).length,
          0,
        );
        if (
          !best ||
          cutCount < best.cutCount ||
          (cutCount === best.cutCount && rotationCount < best.rotationCount)
        ) {
          best = { sheets, cutCount, rotationCount };
        }
      }
    }
    return best ? best.sheets : null;
  }

  function getWoodSheetCacheKey(pieces, options) {
    return JSON.stringify({
      options,
      pieces: pieces.map((piece) => [piece.mark, piece.lengthMm, piece.widthMm]),
    });
  }

  function cloneWoodSheetPlan(plan) {
    return JSON.parse(JSON.stringify(plan));
  }

  function rememberWoodSheetPlan(key, plan) {
    woodSheetPlanCache.set(key, plan);
    if (woodSheetPlanCache.size > 30) {
      woodSheetPlanCache.delete(woodSheetPlanCache.keys().next().value);
    }
    return cloneWoodSheetPlan(plan);
  }

  function calculateWoodSheetPlan(bomInput, optionsInput) {
    const bom = bomInput || getCurrentBom();
    const options = normalizeWoodSheetOptions(optionsInput);
    const pieces = expandWoodPieces(bom, options.caseSetCount).sort(
      (a, b) => Math.max(b.lengthMm, b.widthMm) - Math.max(a.lengthMm, a.widthMm) || b.areaMm2 - a.areaMm2,
    );
    const cacheKey = getWoodSheetCacheKey(pieces, options);
    if (woodSheetPlanCache.has(cacheKey)) {
      return cloneWoodSheetPlan(woodSheetPlanCache.get(cacheKey));
    }
    const totalPieceAreaMm2 = pieces.reduce((sum, piece) => sum + piece.areaMm2, 0);
    const totalSheetAreaMm2 = options.sheetLengthMm * options.sheetWidthMm;
    const lowerBound = Math.max(1, Math.ceil(totalPieceAreaMm2 / totalSheetAreaMm2));
    const impossiblePiece = pieces.find((piece) => !canPieceFitAnySheet(piece, options));

    if (impossiblePiece) {
      return rememberWoodSheetPlan(cacheKey, {
        ...options,
        success: false,
        sheetCount: null,
        lowerBound,
        totalPieceAreaMm2,
        totalSheetAreaMm2,
        utilizationPercent: 0,
        sheets: [],
        pieces,
        warnings: [
          `${impossiblePiece.item} (${formatSize(impossiblePiece.lengthMm, impossiblePiece.widthMm)}) does not fit on one sheet.`,
        ],
        explanation: [
          `The cut list was expanded into ${pieces.length} rectangular wooden pieces for ${formatCount(options.caseSetCount, "complete case set")}.`,
          `At least ${formatCount(lowerBound, "sheet")} would be needed by area alone, but one piece is larger than the selected sheet size.`,
        ],
      });
    }

    for (let sheetCount = lowerBound; sheetCount <= pieces.length; sheetCount += 1) {
      const sheets = tryPackPiecesInSheetCount(pieces, options, sheetCount);
      if (sheets) {
        let placementNumber = 1;
        for (const sheet of sheets) {
          for (const placement of sheet.placements) {
            placement.number = placementNumber;
            placementNumber += 1;
          }
        }
        const cutCount = sheets.reduce((sum, sheet) => sum + sheet.cutCount, 0);
        const utilizationPercent = (totalPieceAreaMm2 / (sheetCount * totalSheetAreaMm2)) * 100;
        return rememberWoodSheetPlan(cacheKey, {
          ...options,
          success: true,
          sheetCount,
          lowerBound,
          totalPieceAreaMm2,
          totalSheetAreaMm2,
          utilizationPercent,
          cutCount,
          sheets,
          pieces,
          warnings: [],
          explanation: [
            `The wood cut list was expanded into ${pieces.length} rectangular pieces for ${formatCount(options.caseSetCount, "complete case set")}. Letters mark sets: a is the first case, b is the second case, and so on.`,
            `Total part area is ${Math.round(totalPieceAreaMm2).toLocaleString()} mm². One sheet is ${Math.round(totalSheetAreaMm2).toLocaleString()} mm², so the area-only lower bound is ${formatCount(lowerBound, "sheet")}.`,
            options.cutThroughOnly
              ? `Cut-through mode groups matching panels into shared strips, then uses guillotine packing. Sheet count is minimized first; layouts using the same number of sheets are ranked by fewer edge-to-edge cuts.`
              : `The calculator uses a fast compact rectangle-packing search with several sorting strategies and tests layouts from ${formatCount(lowerBound, "sheet")} upward until every rectangle fits with a ${options.kerfMm} mm gap between pieces.`,
            `First fitting layout found uses ${formatCount(sheetCount, "sheet")}, with about ${utilizationPercent.toFixed(1)}% material utilization before trimming waste.`,
            ...(options.cutThroughOnly
              ? [`The numbered plan requires about ${formatCount(cutCount, "straight cut")}. Coordinates start at the sheet's top-left corner; allow the selected ${options.kerfMm} mm kerf on the waste side of each line.`]
              : []),
          ],
        });
      }
    }

    return rememberWoodSheetPlan(cacheKey, {
      ...options,
      success: false,
      sheetCount: null,
      lowerBound,
      totalPieceAreaMm2,
      totalSheetAreaMm2,
      utilizationPercent: 0,
      sheets: [],
      pieces,
      warnings: ["No fitting layout was found with one sheet per wooden piece."],
      explanation: [
        `The cut list was expanded into ${pieces.length} rectangular wooden pieces for ${formatCount(options.caseSetCount, "complete case set")}.`,
        "Try a larger sheet size, a smaller kerf/gap, or allow rotating parts.",
      ],
    });
  }

  return { expandWoodPieces, normalizeWoodSheetOptions, calculateWoodSheetPlan };
});
