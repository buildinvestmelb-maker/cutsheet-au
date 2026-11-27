import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import {
  getGridCellMetrics,
  gridCellToLngLat,
  type ElevationGrid,
} from './demLoader';

export type TerrainLensMode = 'hillshade' | 'slope-bands' | 'cut-fill';

export interface SlopeBandMetric {
  id: 'flat' | 'moderate' | 'benching' | 'steep';
  label: string;
  rangeLabel: string;
  colorHex: string;
  cellCount: number;
  pct: number;
  areaHa: number;
  areaSqm: number;
}

export interface DepressionBasinMetric {
  id: string;
  cellCount: number;
  areaSqm: number;
  maxDepthM: number;
  storageVolumeM3: number;
  centroidLngLat: [number, number];
}

export interface HydrologyAnalysisOptions {
  /** Upstream catchment threshold (hectares) for extracting overland flow reaches. Default adaptive / 0.25 ha. */
  catchmentThresholdHa?: number;
  /** Minimum enclosed depression depth (metres) to classify as ponding basin. Default 0.15 m. */
  depressionThresholdM?: number;
  /** Optional external flood/planning exclusion area (hectares) from EnviroSim AU. */
  floodExclusionHa?: number;
}

export interface HydrologyAnalysisResult {
  rows: number;
  cols: number;
  cellAreaSqm: number;
  grossAreaHa: number;
  /** Per-cell slope magnitude in percent (rise / run * 100). */
  slopePctGrid: Float32Array;
  /** Per-cell aspect angle in radians (clockwise from North). */
  aspectRadGrid: Float32Array;
  /** Mean slope (%) inside the parcel boundary. */
  avgSlopePct: number;
  /** Maximum slope (%) inside the parcel boundary. */
  maxSlopePct: number;
  /** 4-band Australian civil grading slope breakdown inside the parcel. */
  slopeBands: readonly SlopeBandMetric[];
  /** Depression-filled surface (m AHD) computed via Priority-Flood. */
  filledElevationsAHD: Float32Array;
  /** Per-cell enclosed ponding depth (filled - original, >= 0 m). */
  depressionDepthGrid: Float32Array;
  /** Total natural depression storage potential (m³) inside parcel for depths >= threshold. */
  naturalStorageM3: number;
  /** Deepest enclosed ponding point inside parcel (m). */
  maxDepressionDepthM: number;
  /** Total area (ha) of enclosed ponding depressions inside parcel. */
  depressionAreaHa: number;
  /** Individual clustered ponding basins inside parcel. */
  depressions: readonly DepressionBasinMetric[];
  /** GeoJSON Polygon overlays for detected low-point ponding basins. */
  depressionsGeoJson: FeatureCollection<Polygon>;
  /** Per-cell D8 steepest-descent pointer (-1 for pit/outlet, 0..7 for Moore neighbor). */
  d8DirectionGrid: Int8Array;
  /** Per-cell upstream contributing catchment area (hectares). */
  flowAccumHaGrid: Float32Array;
  /** Applied catchment threshold (hectares). */
  catchmentThresholdHa: number;
  /** Applied catchment threshold in cell count. */
  catchmentThresholdCells: number;
  /** Number of extracted overland flow channel reaches inside parcel. */
  activeReaches: number;
  /** Peak contributing catchment (hectares) observed inside parcel. */
  peakCatchmentHa: number;
  /** GeoJSON LineString features representing concentrated overland flow paths. */
  flowLinesGeoJson: FeatureCollection<LineString>;
  /** Steep (>15%) area inside parcel (ha). */
  steepAreaHa: number;
  /** Concentrated overland drainage corridor area inside parcel (ha). */
  drainageAreaHa: number;
  /** Optional flood / planning overlay exclusion area (ha). */
  floodAreaHa: number;
  /** Net Developable Area (ha) after deducting steep (>15%), drainage & flood constraints. */
  netDevelopableAreaHa: number;
  /** Net Developable Area percentage of gross parcel area (0–100). */
  netDevelopablePct: number;
}

export interface TerrainLensOptions {
  mode: TerrainLensMode;
  sunAzimuthDeg?: number;
  sunAltitudeDeg?: number;
  verticalExaggeration?: number;
  maxCutM?: number;
  maxFillM?: number;
}

export interface TerrainLensBuffer {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

// 8 Moore neighbor offsets: N, NE, E, SE, S, SW, W, NW
const D8_DR = [-1, -1, 0, 1, 1, 1, 0, -1] as const;
const D8_DC = [0, 1, 1, 1, 0, -1, -1, -1] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function roundTwo(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function roundThree(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

/**
 * Lightweight binary min-heap keyed by elevation for Barnes Priority-Flood depression filling.
 */
class PriorityFloodMinHeap {
  private readonly indices: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.indices.length;
  }

  push(cellIdx: number, elev: number): void {
    this.indices.push(cellIdx);
    this.keys.push(elev);
    this.siftUp(this.indices.length - 1);
  }

  pop(): { idx: number; elev: number } {
    const idx = this.indices[0];
    const elev = this.keys[0];
    const lastIdx = this.indices.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.indices.length > 0) {
      this.indices[0] = lastIdx;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return { idx, elev };
  }

  private siftUp(pos: number): void {
    let i = pos;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  private siftDown(pos: number): void {
    let i = pos;
    const n = this.indices.length;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.keys[left] < this.keys[smallest]) {
        smallest = left;
      }
      if (right < n && this.keys[right] < this.keys[smallest]) {
        smallest = right;
      }
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmpIdx = this.indices[a];
    this.indices[a] = this.indices[b];
    this.indices[b] = tmpIdx;
    const tmpKey = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tmpKey;
  }
}

/**
 * Computes Horn's 3x3 weighted metric gradients (dz/dx, dz/dy), slope (%), and aspect (rad).
 */
export function computeHornSlopeAndAspect(grid: ElevationGrid): {
  dzDx: Float32Array;
  dzDy: Float32Array;
  slopePctGrid: Float32Array;
  aspectRadGrid: Float32Array;
} {
  const { rows, cols, elevationsAHD } = grid;
  const { dxM, dyM } = getGridCellMetrics(grid);
  const total = rows * cols;
  const dzDx = new Float32Array(total);
  const dzDy = new Float32Array(total);
  const slopePctGrid = new Float32Array(total);
  const aspectRadGrid = new Float32Array(total);

  const sample = (r: number, c: number): number => {
    const cr = clamp(r, 0, rows - 1);
    const cc = clamp(c, 0, cols - 1);
    return elevationsAHD[cr * cols + cc];
  };

  const denomX = Math.max(1e-6, 8 * dxM);
  const denomY = Math.max(1e-6, 8 * dyM);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = sample(r - 1, c - 1);
      const b = sample(r - 1, c);
      const cc = sample(r - 1, c + 1);
      const d = sample(r, c - 1);
      const f = sample(r, c + 1);
      const g = sample(r + 1, c - 1);
      const h = sample(r + 1, c);
      const i = sample(r + 1, c + 1);

      // East positive (x), North positive (y -> note row 0 is North)
      const gx = (cc + 2 * f + i - (a + 2 * d + g)) / denomX;
      const gy = (a + 2 * b + cc - (g + 2 * h + i)) / denomY;

      const idx = r * cols + c;
      dzDx[idx] = gx;
      dzDy[idx] = gy;
      slopePctGrid[idx] = Math.hypot(gx, gy) * 100;
      aspectRadGrid[idx] = Math.atan2(gx, gy);
    }
  }

  return { dzDx, dzDy, slopePctGrid, aspectRadGrid };
}

/**
 * Priority-Flood depression filling (Barnes et al. 2014) with tiny downhill epsilon (1e-4 m)
 * so flat filled lakes still drain deterministically towards their spill outlet.
 */
function runPriorityFlood(grid: ElevationGrid): {
  filled: Float32Array;
  depressionDepth: Float32Array;
} {
  const { rows, cols, elevationsAHD } = grid;
  const total = rows * cols;
  const filled = new Float32Array(total);
  const depressionDepth = new Float32Array(total);
  const closed = new Uint8Array(total);
  const heap = new PriorityFloodMinHeap();

  // Seed perimeter cells as known drainage outlets
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        const idx = r * cols + c;
        const z = elevationsAHD[idx];
        filled[idx] = z;
        closed[idx] = 1;
        heap.push(idx, z);
      }
    }
  }

  const DRAIN_EPS = 1e-4;

  while (heap.size > 0) {
    const { idx, elev } = heap.pop();
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;

    for (let dir = 0; dir < 8; dir += 1) {
      const nr = r + D8_DR[dir];
      const nc = c + D8_DC[dir];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (closed[nIdx] === 1) continue;

      closed[nIdx] = 1;
      const rawZ = elevationsAHD[nIdx];
      if (rawZ < elev + DRAIN_EPS) {
        const raised = elev + DRAIN_EPS;
        filled[nIdx] = raised;
        depressionDepth[nIdx] = Math.max(0, elev - rawZ);
        heap.push(nIdx, raised);
      } else {
        filled[nIdx] = rawZ;
        depressionDepth[nIdx] = 0;
        heap.push(nIdx, rawZ);
      }
    }
  }

  return { filled, depressionDepth };
}

/**
 * Computes D8 steepest-descent flow direction and upstream contributing catchment area (ha).
 */
function runD8FlowRouting(
  grid: ElevationGrid,
  filledElevations: Float32Array,
  cellAreaSqm: number,
): {
  d8DirectionGrid: Int8Array;
  flowAccumCells: Int32Array;
  flowAccumHaGrid: Float32Array;
} {
  const { rows, cols } = grid;
  const { dxM, dyM } = getGridCellMetrics(grid);
  const diagM = Math.hypot(dxM, dyM);
  const stepDist = [dyM, diagM, dxM, diagM, dyM, diagM, dxM, diagM] as const;

  const total = rows * cols;
  const d8DirectionGrid = new Int8Array(total);
  d8DirectionGrid.fill(-1);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const z0 = filledElevations[idx];
      let bestDir = -1;
      let bestGrad = 0;

      for (let dir = 0; dir < 8; dir += 1) {
        const nr = r + D8_DR[dir];
        const nc = c + D8_DC[dir];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const drop = z0 - filledElevations[nr * cols + nc];
        if (drop > 0) {
          const grad = drop / stepDist[dir];
          if (grad > bestGrad) {
            bestGrad = grad;
            bestDir = dir;
          }
        }
      }
      d8DirectionGrid[idx] = bestDir;
    }
  }

  // Sort cells strictly high-to-low so upstream accumulation finishes before downstream
  const order = new Int32Array(total);
  for (let i = 0; i < total; i += 1) order[i] = i;
  order.sort((a, b) => filledElevations[b] - filledElevations[a]);

  const flowAccumCells = new Int32Array(total);
  flowAccumCells.fill(1);

  for (let k = 0; k < total; k += 1) {
    const idx = order[k];
    const dir = d8DirectionGrid[idx];
    if (dir < 0) continue;
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;
    const nr = r + D8_DR[dir];
    const nc = c + D8_DC[dir];
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    flowAccumCells[nr * cols + nc] += flowAccumCells[idx];
  }

  const flowAccumHaGrid = new Float32Array(total);
  const haPerCell = cellAreaSqm / 10_000;
  for (let i = 0; i < total; i += 1) {
    flowAccumHaGrid[i] = flowAccumCells[i] * haPerCell;
  }

  return { d8DirectionGrid, flowAccumCells, flowAccumHaGrid };
}

/**
 * Extracts connected D8 overland flow channel polylines inside the parcel exceeding threshold.
 */
function buildFlowLinesGeoJson(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  d8DirectionGrid: Int8Array,
  flowAccumCells: Int32Array,
  flowAccumHaGrid: Float32Array,
  thresholdCells: number,
): {
  flowLinesGeoJson: FeatureCollection<LineString>;
  activeReaches: number;
  peakCatchmentHa: number;
  drainageCellMask: Uint8Array;
} {
  const { rows, cols } = grid;
  const total = rows * cols;
  const isChannel = new Uint8Array(total);
  const drainageCellMask = new Uint8Array(total);
  let peakCatchmentHa = 0;

  for (let i = 0; i < total; i += 1) {
    if (insideMask[i] === 1) {
      if (flowAccumHaGrid[i] > peakCatchmentHa) {
        peakCatchmentHa = flowAccumHaGrid[i];
      }
      if (flowAccumCells[i] >= thresholdCells) {
        isChannel[i] = 1;
        drainageCellMask[i] = 1;
      }
    }
  }

  // Count how many upstream channel neighbors feed each channel cell
  const inDegree = new Uint8Array(total);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (isChannel[idx] === 0) continue;
      const dir = d8DirectionGrid[idx];
      if (dir < 0) continue;
      const nr = r + D8_DR[dir];
      const nc = c + D8_DC[dir];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (isChannel[nIdx] === 1) {
        inDegree[nIdx] += 1;
      }
    }
  }

  // Trace continuous reaches starting from channel heads (inDegree === 0) or confluences (inDegree > 1)
  const visitedEdge = new Uint8Array(total);
  const features: Feature<LineString>[] = [];

  const traceReach = (startIdx: number) => {
    const coords: Array<[number, number]> = [];
    let cur = startIdx;
    let maxHa = flowAccumHaGrid[cur];
    let steps = 0;

    while (steps < total) {
      const r = Math.floor(cur / cols);
      const c = cur - r * cols;
      const [lng, lat] = gridCellToLngLat(grid, r, c);
      coords.push([Number(lng.toFixed(7)), Number(lat.toFixed(7))]);
      if (flowAccumHaGrid[cur] > maxHa) maxHa = flowAccumHaGrid[cur];

      if (visitedEdge[cur] === 1) break;
      visitedEdge[cur] = 1;

      const dir = d8DirectionGrid[cur];
      if (dir < 0) break;
      const nr = r + D8_DR[dir];
      const nc = c + D8_DC[dir];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
      const nextIdx = nr * cols + nc;

      if (isChannel[nextIdx] === 0) {
        // Include one final step to outlet boundary cell for visual continuity
        if (insideMask[nextIdx] === 1) {
          const [nlng, nlat] = gridCellToLngLat(grid, nr, nc);
          coords.push([Number(nlng.toFixed(7)), Number(nlat.toFixed(7))]);
        }
        break;
      }

      cur = nextIdx;
      steps += 1;

      // Stop at a confluence after including the junction vertex so reaches don't overlap
      if (inDegree[cur] > 1) {
        const jr = Math.floor(cur / cols);
        const jc = cur - jr * cols;
        const [jlng, jlat] = gridCellToLngLat(grid, jr, jc);
        coords.push([Number(jlng.toFixed(7)), Number(jlat.toFixed(7))]);
        if (flowAccumHaGrid[cur] > maxHa) maxHa = flowAccumHaGrid[cur];
        break;
      }
    }

    if (coords.length >= 2) {
      const normalizedOrder =
        peakCatchmentHa > 0 ? clamp(maxHa / peakCatchmentHa, 0.2, 1) : 0.4;
      features.push({
        type: 'Feature',
        properties: {
          reachId: `reach-${features.length + 1}`,
          catchmentHa: roundTwo(maxHa),
          widthFactor: Number((1.4 + normalizedOrder * 2.6).toFixed(2)),
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      });
    }
  };

  for (let i = 0; i < total; i += 1) {
    if (isChannel[i] === 1 && (inDegree[i] === 0 || inDegree[i] > 1)) {
      traceReach(i);
    }
  }

  return {
    flowLinesGeoJson: {
      type: 'FeatureCollection',
      features,
    },
    activeReaches: features.length,
    peakCatchmentHa: roundTwo(peakCatchmentHa),
    drainageCellMask,
  };
}

/**
 * Clusters contiguous ponding depression cells (>= thresholdM) into bounding GeoJSON polygons.
 */
function buildDepressionsGeoJson(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  depressionDepthGrid: Float32Array,
  cellAreaSqm: number,
  thresholdM: number,
): {
  depressions: DepressionBasinMetric[];
  depressionsGeoJson: FeatureCollection<Polygon>;
  naturalStorageM3: number;
  maxDepressionDepthM: number;
  depressionAreaHa: number;
} {
  const { rows, cols, boundsWgs84 } = grid;
  const [minLng, minLat, maxLng, maxLat] = boundsWgs84;
  const dLng = (maxLng - minLng) / cols;
  const dLat = (maxLat - minLat) / rows;
  const total = rows * cols;
  const visited = new Uint8Array(total);

  const depressions: DepressionBasinMetric[] = [];
  const features: Feature<Polygon>[] = [];
  let naturalStorageM3 = 0;
  let maxDepressionDepthM = 0;
  let totalDepCells = 0;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const startIdx = r * cols + c;
      if (
        insideMask[startIdx] === 0 ||
        visited[startIdx] === 1 ||
        depressionDepthGrid[startIdx] < thresholdM
      ) {
        continue;
      }

      // BFS connected component
      const queue: number[] = [startIdx];
      visited[startIdx] = 1;
      const cells: Array<[number, number, number]> = [];
      let minR = r;
      let maxR = r;
      let minC = c;
      let maxC = c;
      let basinVol = 0;
      let basinMaxD = 0;
      let sumLng = 0;
      let sumLat = 0;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const cr = Math.floor(cur / cols);
        const cc = cur - cr * cols;
        const depth = depressionDepthGrid[cur];
        cells.push([cr, cc, depth]);
        minR = Math.min(minR, cr);
        maxR = Math.max(maxR, cr);
        minC = Math.min(minC, cc);
        maxC = Math.max(maxC, cc);
        basinVol += depth * cellAreaSqm;
        if (depth > basinMaxD) basinMaxD = depth;
        const [lng, lat] = gridCellToLngLat(grid, cr, cc);
        sumLng += lng;
        sumLat += lat;

        for (let dir = 0; dir < 8; dir += 1) {
          const nr = cr + D8_DR[dir];
          const nc = cc + D8_DC[dir];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (
            visited[nIdx] === 0 &&
            insideMask[nIdx] === 1 &&
            depressionDepthGrid[nIdx] >= thresholdM
          ) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      totalDepCells += cells.length;
      naturalStorageM3 += basinVol;
      if (basinMaxD > maxDepressionDepthM) maxDepressionDepthM = basinMaxD;

      const id = `basin-${depressions.length + 1}`;
      const areaSqm = cells.length * cellAreaSqm;
      const centroidLngLat: [number, number] = [
        Number((sumLng / cells.length).toFixed(6)),
        Number((sumLat / cells.length).toFixed(6)),
      ];

      depressions.push({
        id,
        cellCount: cells.length,
        areaSqm: roundTwo(areaSqm),
        maxDepthM: roundThree(basinMaxD),
        storageVolumeM3: roundTwo(basinVol),
        centroidLngLat,
      });

      // Emit clean polygon for each ponding cluster (cell union bounding polygon or cell-perimeter)
      const west = minLng + minC * dLng;
      const east = minLng + (maxC + 1) * dLng;
      const north = maxLat - minR * dLat;
      const south = maxLat - (maxR + 1) * dLat;

      features.push({
        type: 'Feature',
        properties: {
          basinId: id,
          maxDepthM: roundThree(basinMaxD),
          storageVolumeM3: roundTwo(basinVol),
          areaSqm: roundTwo(areaSqm),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      });
    }
  }

  return {
    depressions,
    depressionsGeoJson: {
      type: 'FeatureCollection',
      features,
    },
    naturalStorageM3: roundTwo(naturalStorageM3),
    maxDepressionDepthM: roundThree(maxDepressionDepthM),
    depressionAreaHa: roundTwo((totalDepCells * cellAreaSqm) / 10_000),
  };
}

/**
 * Full Australian civil terrain, slope classification, Priority-Flood ponding,
 * D8 overland flow routing, and Net Developable Area (NDA) engine.
 */
export function analyzeTerrainHydrology(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  cellAreaSqm: number,
  options: HydrologyAnalysisOptions = {},
): HydrologyAnalysisResult {
  const { rows, cols } = grid;
  const total = rows * cols;
  const depressionThresholdM =
    typeof options.depressionThresholdM === 'number' &&
    Number.isFinite(options.depressionThresholdM)
      ? Math.max(0.05, options.depressionThresholdM)
      : 0.15;
  const floodAreaHa =
    typeof options.floodExclusionHa === 'number' &&
    Number.isFinite(options.floodExclusionHa)
      ? Math.max(0, options.floodExclusionHa)
      : 0;

  // 1. Horn 3x3 Metric Slope & Aspect
  const { slopePctGrid, aspectRadGrid } = computeHornSlopeAndAspect(grid);

  let insideCount = 0;
  let slopeSum = 0;
  let maxSlopePct = 0;
  let flatCount = 0;
  let modCount = 0;
  let benchCount = 0;
  let steepCount = 0;

  for (let i = 0; i < total; i += 1) {
    if (insideMask[i] === 0) continue;
    insideCount += 1;
    const s = slopePctGrid[i];
    slopeSum += s;
    if (s > maxSlopePct) maxSlopePct = s;
    if (s < 5) flatCount += 1;
    else if (s < 10) modCount += 1;
    else if (s <= 15) benchCount += 1;
    else steepCount += 1;
  }

  const safeInsideCount = Math.max(1, insideCount);
  const grossAreaHa = (insideCount * cellAreaSqm) / 10_000;
  const haPerCell = cellAreaSqm / 10_000;

  const slopeBands: SlopeBandMetric[] = [
    {
      id: 'flat',
      label: '0–5% Flat',
      rangeLabel: '0–5%',
      colorHex: '#10b981',
      cellCount: flatCount,
      pct: roundTwo((flatCount / safeInsideCount) * 100),
      areaHa: roundTwo(flatCount * haPerCell),
      areaSqm: roundTwo(flatCount * cellAreaSqm),
    },
    {
      id: 'moderate',
      label: '5–10% Moderate',
      rangeLabel: '5–10%',
      colorHex: '#eab308',
      cellCount: modCount,
      pct: roundTwo((modCount / safeInsideCount) * 100),
      areaHa: roundTwo(modCount * haPerCell),
      areaSqm: roundTwo(modCount * cellAreaSqm),
    },
    {
      id: 'benching',
      label: '10–15% Benching',
      rangeLabel: '10–15%',
      colorHex: '#f97316',
      cellCount: benchCount,
      pct: roundTwo((benchCount / safeInsideCount) * 100),
      areaHa: roundTwo(benchCount * haPerCell),
      areaSqm: roundTwo(benchCount * cellAreaSqm),
    },
    {
      id: 'steep',
      label: '>15% Steep',
      rangeLabel: '>15%',
      colorHex: '#ef4444',
      cellCount: steepCount,
      pct: roundTwo((steepCount / safeInsideCount) * 100),
      areaHa: roundTwo(steepCount * haPerCell),
      areaSqm: roundTwo(steepCount * cellAreaSqm),
    },
  ];

  // 2. Priority-Flood Depression Filling & Low-Point Ponding Basins
  const { filled: filledElevationsAHD, depressionDepth: depressionDepthGrid } =
    runPriorityFlood(grid);
  const depSummary = buildDepressionsGeoJson(
    grid,
    insideMask,
    depressionDepthGrid,
    cellAreaSqm,
    depressionThresholdM,
  );

  // 3. D8 Flow Direction & Accumulation
  const { d8DirectionGrid, flowAccumCells, flowAccumHaGrid } = runD8FlowRouting(
    grid,
    filledElevationsAHD,
    cellAreaSqm,
  );

  const defaultThresholdHa = Math.max(0.08, roundTwo(grossAreaHa * 0.08));
  const catchmentThresholdHa =
    typeof options.catchmentThresholdHa === 'number' &&
    Number.isFinite(options.catchmentThresholdHa) &&
    options.catchmentThresholdHa > 0
      ? options.catchmentThresholdHa
      : defaultThresholdHa;
  const catchmentThresholdCells = Math.max(
    3,
    Math.round((catchmentThresholdHa * 10_000) / Math.max(1, cellAreaSqm)),
  );

  const flowSummary = buildFlowLinesGeoJson(
    grid,
    insideMask,
    d8DirectionGrid,
    flowAccumCells,
    flowAccumHaGrid,
    catchmentThresholdCells,
  );

  // 4. Net Developable Area (NDA) — union of steep (>15%) and active drainage cells + flood
  let constrainedNonSteepDrainageCells = 0;
  let totalDrainageCells = 0;
  for (let i = 0; i < total; i += 1) {
    if (insideMask[i] === 0) continue;
    if (flowSummary.drainageCellMask[i] === 1) {
      totalDrainageCells += 1;
      if (slopePctGrid[i] <= 15) {
        constrainedNonSteepDrainageCells += 1;
      }
    }
  }

  const steepAreaHa = roundTwo(steepCount * haPerCell);
  const drainageAreaHa = roundTwo(totalDrainageCells * haPerCell);
  const combinedSlopeDrainageConstraintHa =
    (steepCount + constrainedNonSteepDrainageCells) * haPerCell;
  const netDevelopableAreaHa = roundTwo(
    Math.max(0, grossAreaHa - combinedSlopeDrainageConstraintHa - floodAreaHa),
  );
  const netDevelopablePct =
    grossAreaHa > 0 ? roundTwo((netDevelopableAreaHa / grossAreaHa) * 100) : 0;

  return {
    rows,
    cols,
    cellAreaSqm: roundTwo(cellAreaSqm),
    grossAreaHa: roundTwo(grossAreaHa),
    slopePctGrid,
    aspectRadGrid,
    avgSlopePct: roundTwo(slopeSum / safeInsideCount),
    maxSlopePct: roundTwo(maxSlopePct),
    slopeBands,
    filledElevationsAHD,
    depressionDepthGrid,
    naturalStorageM3: depSummary.naturalStorageM3,
    maxDepressionDepthM: depSummary.maxDepressionDepthM,
    depressionAreaHa: depSummary.depressionAreaHa,
    depressions: depSummary.depressions,
    depressionsGeoJson: depSummary.depressionsGeoJson,
    d8DirectionGrid,
    flowAccumHaGrid,
    catchmentThresholdHa: roundTwo(catchmentThresholdHa),
    catchmentThresholdCells,
    activeReaches: flowSummary.activeReaches,
    peakCatchmentHa: flowSummary.peakCatchmentHa,
    flowLinesGeoJson: flowSummary.flowLinesGeoJson,
    steepAreaHa,
    drainageAreaHa,
    floodAreaHa: roundTwo(floodAreaHa),
    netDevelopableAreaHa,
    netDevelopablePct,
  };
}

/**
 * Generates a pure RGBA raster buffer for draping Hillshade, Civil Slope Bands,
 * or Cut/Fill Heatmap inside the parcel boundary on a 2D GIS map.
 * Cells outside `insideMask` receive alpha = 0 so the underlying satellite/vector map shows cleanly.
 */
export function computeTerrainLensRgba(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  deltaGrid: Float32Array,
  slopePctGrid: Float32Array,
  options: TerrainLensOptions,
): TerrainLensBuffer {
  const { rows, cols, elevationsAHD, minAHD, maxAHD } = grid;
  const { dzDx, dzDy } = computeHornSlopeAndAspect(grid);

  const azimuthDeg = Number.isFinite(options.sunAzimuthDeg)
    ? (options.sunAzimuthDeg as number)
    : 315;
  const altitudeDeg = clamp(
    Number.isFinite(options.sunAltitudeDeg)
      ? (options.sunAltitudeDeg as number)
      : 42,
    5,
    88,
  );
  const zExag = clamp(
    Number.isFinite(options.verticalExaggeration)
      ? (options.verticalExaggeration as number)
      : 3.0,
    0.5,
    8.0,
  );

  // Convert compass azimuth (0°=N, 90°=E, 315°=NW) & altitude into unit sun vector (x=East, y=North, z=Up)
  const azRad = (azimuthDeg * Math.PI) / 180;
  const altRad = (altitudeDeg * Math.PI) / 180;
  const sx = Math.cos(altRad) * Math.sin(azRad);
  const sy = Math.cos(altRad) * Math.cos(azRad);
  const sz = Math.sin(altRad);

  const elevSpan = Math.max(0.5, maxAHD - minAHD);
  const maxCut = Math.max(0.8, options.maxCutM ?? 2.5);
  const maxFill = Math.max(0.8, options.maxFillM ?? 2.5);

  const rgba = new Uint8ClampedArray(rows * cols * 4);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const px = idx * 4;

      if (insideMask[idx] === 0) {
        rgba[px] = 0;
        rgba[px + 1] = 0;
        rgba[px + 2] = 0;
        rgba[px + 3] = 0;
        continue;
      }

      // Surface normal n = (-gx*zExag, -gy*zExag, 1) normalized
      const nx = -dzDx[idx] * zExag;
      const ny = -dzDy[idx] * zExag;
      const nz = 1;
      const nLen = Math.hypot(nx, ny, nz);
      const shadeRaw = (nx * sx + ny * sy + nz * sz) / nLen;
      const shade = clamp(0.42 + shadeRaw * 0.72, 0.28, 1.25);

      let cr = 180;
      let cg = 195;
      let cb = 210;
      let alpha = 215;

      if (options.mode === 'hillshade') {
        const t = clamp((elevationsAHD[idx] - minAHD) / elevSpan, 0, 1);
        // Subtle hypsometric architectural tint (cool slate valley -> warm parchment crest)
        const baseR = 88 + t * 124;
        const baseG = 114 + t * 98;
        const baseB = 132 + t * 72;
        cr = clamp(Math.round(baseR * shade), 0, 255);
        cg = clamp(Math.round(baseG * shade), 0, 255);
        cb = clamp(Math.round(baseB * shade), 0, 255);
        alpha = 200;
      } else if (options.mode === 'slope-bands') {
        const s = slopePctGrid[idx];
        let br = 16;
        let bg = 185;
        let bb = 129;
        if (s < 5) {
          br = 16;
          bg = 185;
          bb = 129; // Emerald
        } else if (s < 10) {
          br = 234;
          bg = 179;
          bb = 8; // Amber
        } else if (s <= 15) {
          br = 249;
          bg = 115;
          bb = 22; // Orange
        } else {
          br = 239;
          bg = 68;
          bb = 68; // Rose/Red
        }
        const mod = clamp(0.62 + shadeRaw * 0.48, 0.45, 1.15);
        cr = clamp(Math.round(br * mod), 0, 255);
        cg = clamp(Math.round(bg * mod), 0, 255);
        cb = clamp(Math.round(bb * mod), 0, 255);
        alpha = 212;
      } else {
        // Cut / Fill Heatmap
        const delta = deltaGrid[idx];
        const mod = clamp(0.68 + shadeRaw * 0.4, 0.5, 1.15);
        if (Math.abs(delta) <= 0.12) {
          // Balanced on-grade band (cyan)
          cr = Math.round(56 * mod);
          cg = Math.round(189 * mod);
          cb = Math.round(248 * mod);
          alpha = 188;
        } else if (delta > 0) {
          // Cut zone (amber -> vivid rose-red)
          const t = clamp(delta / maxCut, 0, 1);
          const br = 245 - t * 6;
          const bg = 166 - t * 112;
          const bb = 35 + t * 33;
          cr = clamp(Math.round(br * mod), 0, 255);
          cg = clamp(Math.round(bg * mod), 0, 255);
          cb = clamp(Math.round(bb * mod), 0, 255);
          alpha = 222;
        } else {
          // Fill zone (sky-mint -> deep emerald)
          const t = clamp(-delta / maxFill, 0, 1);
          const br = 56 - t * 40;
          const bg = 211 - t * 50;
          const bb = 175 - t * 65;
          cr = clamp(Math.round(br * mod), 0, 255);
          cg = clamp(Math.round(bg * mod), 0, 255);
          cb = clamp(Math.round(bb * mod), 0, 255);
          alpha = 222;
        }
      }

      rgba[px] = cr;
      rgba[px + 1] = cg;
      rgba[px + 2] = cb;
      rgba[px + 3] = alpha;
    }
  }

  return { width: cols, height: rows, rgba };
}

/**
 * Renders the Terrain Lens RGBA buffer into a smooth bilinear-upsampled PNG Data URL
 * ready to be draped via MapLibre GL's `image` source over `grid.boundsWgs84`.
 */
export function renderTerrainLensDataUrl(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  deltaGrid: Float32Array,
  slopePctGrid: Float32Array,
  options: TerrainLensOptions,
): string | null {
  if (typeof document === 'undefined') return null;

  const { width, height, rgba } = computeTerrainLensRgba(
    grid,
    insideMask,
    deltaGrid,
    slopePctGrid,
    options,
  );
  if (width < 2 || height < 2) return null;

  try {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = width;
    srcCanvas.height = height;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return null;

    const imageData = srcCtx.createImageData(width, height);
    imageData.data.set(rgba);
    srcCtx.putImageData(imageData, 0, 0);

    // Upsample smoothly for crisp satellite map draping (MapLibre GPU bilinear smooths further)
    const outW = Math.min(180, Math.max(96, width * 3));
    const outH = Math.min(180, Math.max(96, height * 3));
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return srcCanvas.toDataURL('image/png');

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(srcCanvas, 0, 0, outW, outH);
    return outCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
