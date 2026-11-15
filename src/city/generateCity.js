import * as THREE from "three";

export const WALK_SPEED = 6; // units per second
export const SECONDS_PER_ROW = 2;

const ROWS_PER_BLOCK = 4; // 4 rows * 2s = 8s per block
const BLOCK_CYCLE_LENGTH = ROWS_PER_BLOCK * SECONDS_PER_ROW * WALK_SPEED; // 48 units
const ROW_PITCH_IN_BLOCK = 9.5; // 4 * 9.5 = 38 units occupied, leaving 10-unit cross-street
const SIDE_OFFSETS = [12, 24, 36]; // Main road front house + 2 matching houses along cross-streets

function trebleToColor(treble) {
  const hue = 0.62 - treble * 0.52;
  const sat = 0.78 + treble * 0.18;
  const light = 0.48 + treble * 0.16;
  return new THREE.Color().setHSL(hue, sat, light);
}

function buildProps(feature) {
  return {
    height: 3 + feature.rms * 15, // 3–18
    width: 4 + feature.bass * 6, // 4–10
    depth: 4 + feature.mid * 3.5, // 4–7.5
    color: trebleToColor(feature.treble),
  };
}

function hash01(a, b, c, d) {
  const n = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 93.17) * 43758.5453;
  return n - Math.floor(n);
}

function addBuildingWindows(building, bIdx, litWindows, unlitWindows) {
  const { width, height, depth, x, z, rowIndex, isMainRow } = building;

  let floors = 2;
  if (height >= 13) floors = 6;
  else if (height >= 8) floors = 4;

  const baseTop = 0.15;
  const bottomMargin = 0.55;
  const topMargin = 0.45;
  const usableH = Math.max(1.2, height - bottomMargin - topMargin);
  const floorStep = usableH / floors;
  const winH = Math.min(0.95, floorStep * 0.56);

  const colsW = width >= 7.2 ? 3 : 2;
  const colsD = depth >= 5.8 ? 3 : 2;
  const winWidthFront = Math.min(0.95, ((width * 0.62) / colsW) * 0.62);
  const winWidthSide = Math.min(0.85, ((depth * 0.62) / colsD) * 0.62);
  const offsetFront = depth / 2 + 0.05;
  const offsetSide = width / 2 + 0.05;

  for (let f = 0; f < floors; f++) {
    const wy = baseTop + bottomMargin + (f + 0.5) * floorStep;

    for (let c = 0; c < colsW; c++) {
      const t = colsW === 1 ? 0 : c / (colsW - 1) - 0.5;
      const wx = x + t * (width * 0.58);

      for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const wz = sideIdx === 0 ? z + offsetFront : z - offsetFront;
        const isLit = hash01(bIdx, sideIdx, f, c) < 0.68;
        const win = {
          x: wx,
          y: wy,
          z: wz,
          w: winWidthFront,
          h: winH,
          d: 0.08,
          rowIndex,
          isMainRow,
        };
        if (isLit) litWindows.push(win);
        else unlitWindows.push(win);
      }
    }

    for (let c = 0; c < colsD; c++) {
      const t = colsD === 1 ? 0 : c / (colsD - 1) - 0.5;
      const wz = z + t * (depth * 0.58);

      for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const wx = sideIdx === 0 ? x - offsetSide : x + offsetSide;
        const isLit = hash01(bIdx, sideIdx + 2, f, c) < 0.68;
        const win = {
          x: wx,
          y: wy,
          z: wz,
          w: 0.08,
          h: winH,
          d: winWidthSide,
          rowIndex,
          isMainRow,
        };
        if (isLit) litWindows.push(win);
        else unlitWindows.push(win);
      }
    }
  }
}

export function generateCityLayout(segments, duration) {
  const count = segments.length;
  const effectiveDuration = Math.max(duration || count * SECONDS_PER_ROW, SECONDS_PER_ROW);
  const trackRoadLength = effectiveDuration * WALK_SPEED;

  const buildings = [];
  const colliders = [];
  const blockSidewalks = new Map();
  const curbs = [];
  const lamps = [];
  const trees = [];
  const crosswalksZ = [];
  const litWindows = [];
  const unlitWindows = [];

  let minBuildingZ = 0;

  for (let i = 0; i < count; i++) {
    const seg = segments[i];
    const blockIdx = Math.floor(i / ROWS_PER_BLOCK);
    const posInBlock = i % ROWS_PER_BLOCK;

    const blockStartZ = -blockIdx * BLOCK_CYCLE_LENGTH;
    const z = blockStartZ - 5 - posInBlock * ROW_PITCH_IN_BLOCK;
    minBuildingZ = Math.min(minBuildingZ, z - 5);

    const leftProps = buildProps(seg.left);
    const rightProps = buildProps(seg.right);

    SIDE_OFFSETS.forEach((absX, laneIndex) => {
      const leftB = {
        rowIndex: i,
        side: "left",
        isMainRow: laneIndex === 0,
        x: -absX,
        z,
        ...leftProps,
      };
      buildings.push(leftB);
      addBuildingWindows(leftB, buildings.length, litWindows, unlitWindows);

      colliders.push({
        minX: -absX - leftProps.width / 2,
        maxX: -absX + leftProps.width / 2,
        minZ: z - leftProps.depth / 2,
        maxZ: z + leftProps.depth / 2,
      });

      const rightB = {
        rowIndex: i,
        side: "right",
        isMainRow: laneIndex === 0,
        x: absX,
        z,
        ...rightProps,
      };
      buildings.push(rightB);
      addBuildingWindows(rightB, buildings.length, litWindows, unlitWindows);

      colliders.push({
        minX: absX - rightProps.width / 2,
        maxX: absX + rightProps.width / 2,
        minZ: z - rightProps.depth / 2,
        maxZ: z + rightProps.depth / 2,
      });
    });

    if (!blockSidewalks.has(blockIdx)) {
      const padDepth = ROWS_PER_BLOCK * ROW_PITCH_IN_BLOCK;
      const padCenterZ = blockStartZ - padDepth / 2 - 0.25;
      const padWidth = 38;

      blockSidewalks.set(blockIdx, [
        { x: -(5 + padWidth / 2), z: padCenterZ, width: padWidth, depth: padDepth },
        { x: 5 + padWidth / 2, z: padCenterZ, width: padWidth, depth: padDepth },
      ]);

      curbs.push(
        { x: -5.15, z: padCenterZ, width: 0.35, depth: padDepth },
        { x: 5.15, z: padCenterZ, width: 0.35, depth: padDepth }
      );

      const lampOffsets = [-2.0, -19.25, -36.5];
      for (const dz of lampOffsets) {
        lamps.push({ x: -5.45, z: blockStartZ + dz, side: -1 });
        lamps.push({ x: 5.45, z: blockStartZ + dz, side: 1 });
      }

      const treeOffsets = [-10.6, -27.9];
      treeOffsets.forEach((dz, tIdx) => {
        const scaleL = 0.88 + hash01(blockIdx, tIdx, 1, 0) * 0.28;
        const scaleR = 0.88 + hash01(blockIdx, tIdx, 2, 0) * 0.28;
        trees.push({ x: -6.0, z: blockStartZ + dz, scale: scaleL });
        trees.push({ x: 6.0, z: blockStartZ + dz, scale: scaleR });
      });

      crosswalksZ.push(blockStartZ - 39.2);
      crosswalksZ.push(blockStartZ - 46.8);
    }
  }

  lamps.sort((a, b) => b.z - a.z);

  const endZ = Math.min(-trackRoadLength, minBuildingZ - 6);
  const startPlazaDepth = 16;
  const endPlazaDepth = 16;

  // Precompute HUD summary values per 2-second row
  const rowSummaries = segments.map((s) => {
    const avgTreble = (s.left.treble + s.right.treble) * 0.5;
    return {
      rms: (s.left.rms + s.right.rms) * 0.5,
      bass: (s.left.bass + s.right.bass) * 0.5,
      mid: (s.left.mid + s.right.mid) * 0.5,
      treble: avgTreble,
      colorCss: trebleToColor(avgTreble).getStyle(),
    };
  });

  return {
    buildings,
    colliders,
    sidewalks: Array.from(blockSidewalks.values()).flat(),
    curbs,
    lamps,
    trees,
    crosswalksZ,
    litWindows,
    unlitWindows,
    rowSummaries,
    startPlaza: {
      x: 0,
      z: startPlazaDepth / 2,
      width: 30,
      depth: startPlazaDepth,
    },
    endPlaza: {
      x: 0,
      z: endZ - endPlazaDepth / 2,
      width: 30,
      depth: endPlazaDepth,
    },
    spawn: {
      x: 0,
      y: 1.6,
      z: 0,
    },
    roadEndZ: endZ,
    bounds: {
      minX: -46,
      maxX: 46,
      minZ: endZ - endPlazaDepth + 2,
      maxZ: startPlazaDepth - 2,
    },
  };
}