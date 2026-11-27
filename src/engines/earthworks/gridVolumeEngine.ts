import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { GradingPadSpec } from '../../bridge/types';
import { extractPrimaryPolygon } from '../geo/auGeoKernel';
import {
  getGridCellMetrics,
  gridCellToLngLat,
  sampleElevationAtLngLat,
  type ElevationGrid,
} from './demLoader';

export type SoilClass = 'sand' | 'clay' | 'rock';

export interface SoilRateSpec {
  soilClass: SoilClass;
  label: string;
  as2870Class: string;
  cutRate: number;
  fillRate: number;
  haulRate: number;
  importRate: number;
  defaultSwell: number;
  defaultCompaction: number;
}

/**
 * Australian civil earthworks & AS 2870 geotechnical benchmark unit rates (AUD / m³).
 */
export const SOIL_RATES_AUD: Readonly<Record<SoilClass, SoilRateSpec>> = {
  sand: {
    soilClass: 'sand',
    label: 'Sand / Silty Sand',
    as2870Class: 'AS 2870 Class A / S',
    cutRate: 18,
    fillRate: 24,
    haulRate: 28,
    importRate: 42,
    defaultSwell: 1.12,
    defaultCompaction: 0.95,
  },
  clay: {
    soilClass: 'clay',
    label: 'Reactive Clay / Silty Clay',
    as2870Class: 'AS 2870 Class M / H1–H2',
    cutRate: 28,
    fillRate: 34,
    haulRate: 38,
    importRate: 54,
    defaultSwell: 1.25,
    defaultCompaction: 0.88,
  },
  rock: {
    soilClass: 'rock',
    label: 'Shale / Basalt Rock',
    as2870Class: 'AS 2870 Class R (Rock Breaking)',
    cutRate: 85,
    fillRate: 42,
    haulRate: 48,
    importRate: 62,
    defaultSwell: 1.45,
    defaultCompaction: 0.92,
  },
};

export interface RetainingWallTier {
  heightM: number;
  rateAudPerM: number;
  specLabel: string;
}

export const RETAINING_WALL_HEIGHT_RATES: readonly RetainingWallTier[] = [
  { heightM: 1.2, rateAudPerM: 680, specLabel: '1.2m Concrete Sleeper / Segmental Block' },
  { heightM: 1.8, rateAudPerM: 940, specLabel: '1.8m Engineered Concrete Sleeper + Pier' },
  { heightM: 2.4, rateAudPerM: 1320, specLabel: '2.4m Reinforced Concrete / Geogrid Wall' },
  { heightM: 3.0, rateAudPerM: 1780, specLabel: '3.0m Structural Cantilever RC Wall' },
] as const;

export const TIPPER_TRUCK_CAPACITY_M3 = 18;
export const RETAINING_WALL_DELTA_THRESHOLD_M = 0.6;

/**
 * Interpolates retaining wall unit cost (AUD / lineal metre) across standard Australian heights (1.2m–3.0m).
 */
export function getRetainingWallRatePerLm(heightM: number): number {
  const safeH = Number.isFinite(heightM) ? Math.max(0.6, heightM) : 1.8;
  const tiers = RETAINING_WALL_HEIGHT_RATES;
  if (safeH <= tiers[0].heightM) {
    return Math.round(tiers[0].rateAudPerM * (safeH / tiers[0].heightM));
  }
  const last = tiers[tiers.length - 1];
  if (safeH >= last.heightM) {
    return Math.round(last.rateAudPerM * (safeH / last.heightM));
  }
  for (let i = 0; i < tiers.length - 1; i += 1) {
    const lo = tiers[i];
    const hi = tiers[i + 1];
    if (safeH >= lo.heightM && safeH <= hi.heightM) {
      const t = (safeH - lo.heightM) / (hi.heightM - lo.heightM);
      return Math.round(lo.rateAudPerM + t * (hi.rateAudPerM - lo.rateAudPerM));
    }
  }
  return tiers[1].rateAudPerM;
}

export type GradingStrategy =
  | 'best-fit-plane'
  | 'auto-terrace'
  | 'max-grade'
  | 'flat-pad';

export interface CivilRateOverrides {
  cutRate?: number;
  fillRate?: number;
  haulRate?: number;
  importRate?: number;
  rockBreakoutRate?: number;
  topsoilRate?: number;
  retainingRatePerLm?: number;
}

export type DevelopabilityRiskLevel =
  | 'Low Risk'
  | 'Moderate Risk'
  | 'High Risk';

export interface DevelopabilityAssessment {
  score: number;
  riskLevel: DevelopabilityRiskLevel;
  drivers: string[];
}

export const DEFAULT_ROCK_BREAKOUT_RATE_AUD = 125;
export const DEFAULT_TOPSOIL_RATE_AUD = 18;

export interface EarthworksGridParams {
  targetFflAHD: number;
  soilClass: SoilClass;
  cutSwellFactor?: number;
  fillCompactionFactor?: number;
  batterSlopeRatio?: number;
  padSlopePct?: number;
  padCrossSlopePct?: number;
  gradingPads?: GradingPadSpec[];
  retainingWallHeightM?: number;
  retainingWallLengthOverrideM?: number;
  applyBoundaryBatter?: boolean;
  /** Civil grading surface strategy. Defaults to 'flat-pad' for backward compatibility. */
  gradingStrategy?: GradingStrategy;
  /** Optional desired Cut:Fill volume ratio (e.g. 1.0 balanced, 1.10 compaction, 1.25 bulking) for Best-Fit / Terrace / Max-Grade strategies. */
  targetCutFillRatio?: number;
  /** Maximum permissible design slope (%) when gradingStrategy === 'max-grade'. Default 5.0%. */
  maxGradePct?: number;
  /** Vertical step height (m) between horizontal benches when gradingStrategy === 'auto-terrace'. Default 1.2m. */
  terraceStepM?: number;
  /** Percentage of total cut volume requiring basalt/rock hydraulic hammering (0–100%). Default 0. */
  rockBreakoutPct?: number;
  /** Topsoil strip, stockpile & respread depth (m) across site area (0–0.5m). Default 0. */
  topsoilDepthM?: number;
  /** Optional custom AUD unit rate overrides from the Edit Rates drawer. */
  customRates?: CivilRateOverrides;
  /** Optional estimated residential lot yield basis for Per-Lot civil cost calculation. */
  lotYieldBasis?: number;
  /** Optional pre-computed Net Developable Area (ha) for developability & yield scoring. */
  netDevelopableAreaHa?: number;
}

export interface EarthworksGridResult {
  rows: number;
  cols: number;
  cellSizeM: number;
  cellAreaSqm: number;
  cellCountInside: number;
  insideAreaSqm: number;
  insideMask: Uint8Array;
  proposedGrid: Float32Array;
  deltaGrid: Float32Array;
  gradingStrategy: GradingStrategy;
  targetFflAHD: number;
  soilClass: SoilClass;
  cutSwellFactor: number;
  fillCompactionFactor: number;
  batterSlopeRatio: number;
  cutVolumeM3: number;
  looseCutVolumeM3: number;
  compactedCutM3: number;
  fillVolumeM3: number;
  cutFillRatio: number;
  netBalanceM3: number;
  importExportVolumeM3: number;
  balanceDirection: 'export' | 'import' | 'balanced';
  maxCutDepthM: number;
  maxFillDepthM: number;
  avgExistingGradePct: number;
  avgDesignGradePct: number;
  retainingWallLengthM: number;
  retainingWallHeightM: number;
  retainingWallRatePerLmAud: number;
  rockBreakoutPct: number;
  rockBreakoutVolumeM3: number;
  rockBreakoutCostAud: number;
  topsoilDepthM: number;
  topsoilVolumeM3: number;
  topsoilCostAud: number;
  cutCostAud: number;
  fillPlacementCostAud: number;
  haulOrImportCostAud: number;
  bulkEarthworksCostAud: number;
  retainingWallCostAud: number;
  totalPackageAud: number;
  tipperLoads: number;
  costPerSqmAud: number;
  costPerHaAud: number;
  estimatedLots: number;
  costPerLotAud: number;
  developability: DevelopabilityAssessment;
}

export interface ZeroBalanceOptimizationResult {
  optimalFflAHD: number;
  residualBalanceM3: number;
  iterations: number;
}

export interface SectionProfilePoint {
  chainageM: number;
  lng: number;
  lat: number;
  existingAHD: number;
  proposedAHD: number;
  cutFillM: number;
}

function roundTwo(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function resolveFinitePositive(val: number | undefined, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0
    ? val
    : fallback;
}

/**
 * Fits an ordinary least-squares plane z(x, y) = a + b*x + c*y across inside cells
 * in local metric coordinates (x = eastOffsetM, y = northOffsetM).
 */
function fitOlsPlane(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  centerRow: number,
  centerCol: number,
  dxM: number,
  dyM: number,
): { a: number; b: number; c: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;

  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const idx = r * grid.cols + c;
      if (insideMask[idx] === 0) continue;
      const x = (c - centerCol) * dxM;
      const y = (centerRow - r) * dyM;
      const z = grid.elevationsAHD[idx];
      n += 1;
      sx += x;
      sy += y;
      sz += z;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      sxz += x * z;
      syz += y * z;
    }
  }

  if (n < 3) {
    return { a: n > 0 ? sz / n : grid.meanAHD, b: 0, c: 0 };
  }

  // Solve 3x3 normal equations via Gaussian elimination with partial pivoting
  const M = [
    [n, sx, sy, sz],
    [sx, sxx, sxy, sxz],
    [sy, sxy, syy, syz],
  ];

  for (let col = 0; col < 3; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) {
        pivotRow = row;
      }
    }
    if (Math.abs(M[pivotRow][col]) < 1e-9) {
      return { a: sz / n, b: 0, c: 0 };
    }
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const pivot = M[col][col];
    for (let row = col + 1; row < 3; row += 1) {
      const factor = M[row][col] / pivot;
      for (let k = col; k < 4; k += 1) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  const cCoeff = M[2][3] / M[2][2];
  const bCoeff = (M[1][3] - M[1][2] * cCoeff) / M[1][1];
  const aCoeff = (M[0][3] - M[0][2] * cCoeff - M[0][1] * bCoeff) / M[0][0];

  if (
    !Number.isFinite(aCoeff) ||
    !Number.isFinite(bCoeff) ||
    !Number.isFinite(cCoeff)
  ) {
    return { a: sz / n, b: 0, c: 0 };
  }

  return { a: aCoeff, b: bCoeff, c: cCoeff };
}

/**
 * Generates a slope-clamped design surface inside the parcel whose local gradient
 * never exceeds `maxGradePct` while minimizing earthworks deviation from natural ground.
 */
function buildMaxGradeSurface(
  grid: ElevationGrid,
  insideMask: Uint8Array,
  dxM: number,
  dyM: number,
  maxGradePct: number,
): Float32Array {
  const { rows, cols, elevationsAHD } = grid;
  const surf = new Float32Array(elevationsAHD);
  const next = new Float32Array(elevationsAHD);

  const maxSlope = Math.max(0.005, Math.min(0.35, maxGradePct / 100));
  const maxStepX = maxSlope * dxM;
  const maxStepY = maxSlope * dyM;
  const maxStepD = maxSlope * Math.hypot(dxM, dyM);

  const offsets: ReadonlyArray<[number, number, number]> = [
    [-1, 0, maxStepY],
    [1, 0, maxStepY],
    [0, -1, maxStepX],
    [0, 1, maxStepX],
    [-1, -1, maxStepD],
    [-1, 1, maxStepD],
    [1, -1, maxStepD],
    [1, 1, maxStepD],
  ];

  // Iterative gradient-projection relaxation (converges smoothly in 28 passes)
  for (let iter = 0; iter < 28; iter += 1) {
    let maxChange = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        if (insideMask[idx] === 0) {
          next[idx] = elevationsAHD[idx];
          continue;
        }
        const z = surf[idx];
        let sum = z;
        let weight = 1;
        for (const [dr, dc, limit] of offsets) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (insideMask[nIdx] === 0) continue;
          const nz = surf[nIdx];
          const diff = z - nz;
          if (Math.abs(diff) > limit) {
            sum += nz + Math.sign(diff) * limit;
            weight += 1;
          }
        }
        const updated = sum / weight;
        const delta = Math.abs(updated - z);
        if (delta > maxChange) maxChange = delta;
        next[idx] = updated;
      }
    }
    surf.set(next);
    if (maxChange < 0.004) break;
  }

  return surf;
}

/**
 * Computes average metric grade (%) across inside cells of any Float32Array elevation surface.
 */
function computeMeanSurfaceGradePct(
  rows: number,
  cols: number,
  surface: Float32Array,
  insideMask: Uint8Array,
  dxM: number,
  dyM: number,
): number {
  let count = 0;
  let sumPct = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (insideMask[idx] === 0) continue;
      const z = surface[idx];
      const left =
        c > 0 && insideMask[r * cols + (c - 1)] === 1
          ? surface[r * cols + (c - 1)]
          : z;
      const right =
        c < cols - 1 && insideMask[r * cols + (c + 1)] === 1
          ? surface[r * cols + (c + 1)]
          : z;
      const up =
        r > 0 && insideMask[(r - 1) * cols + c] === 1
          ? surface[(r - 1) * cols + c]
          : z;
      const down =
        r < rows - 1 && insideMask[(r + 1) * cols + c] === 1
          ? surface[(r + 1) * cols + c]
          : z;

      const spanX =
        (c > 0 && insideMask[r * cols + (c - 1)] === 1 ? dxM : 0) +
        (c < cols - 1 && insideMask[r * cols + (c + 1)] === 1 ? dxM : 0);
      const spanY =
        (r > 0 && insideMask[(r - 1) * cols + c] === 1 ? dyM : 0) +
        (r < rows - 1 && insideMask[(r + 1) * cols + c] === 1 ? dyM : 0);

      const gx = spanX > 0 ? (right - left) / spanX : 0;
      const gy = spanY > 0 ? (up - down) / spanY : 0;
      sumPct += Math.hypot(gx, gy) * 100;
      count += 1;
    }
  }
  return count > 0 ? roundTwo(sumPct / count) : 0;
}

/**
 * Evaluates a commercial Terrain Developability Score (0–100) from slope, NDA,
 * bulk earthworks intensity (m³/m²), and retaining intensity.
 */
function scoreDevelopability(
  avgExistingGradePct: number,
  insideAreaSqm: number,
  cutVolumeM3: number,
  fillVolumeM3: number,
  retainingWallLengthM: number,
  netDevelopablePct: number,
): DevelopabilityAssessment {
  const grossHa = Math.max(0.01, insideAreaSqm / 10_000);
  const earthworksIntensity = (cutVolumeM3 + fillVolumeM3) / Math.max(1, insideAreaSqm); // avg moved depth (m)
  const retainingDensity = retainingWallLengthM / grossHa; // lm per ha

  let score = 100;
  const drivers: string[] = [];

  // Slope penalty
  if (avgExistingGradePct > 15) {
    score -= Math.min(34, (avgExistingGradePct - 10) * 2.4);
    drivers.push(`Steep natural grade (${avgExistingGradePct.toFixed(1)}%)`);
  } else if (avgExistingGradePct > 8) {
    score -= (avgExistingGradePct - 6) * 1.6;
    drivers.push(`Moderate cross-fall (${avgExistingGradePct.toFixed(1)}%)`);
  } else {
    drivers.push(`Gentle terrain (${avgExistingGradePct.toFixed(1)}% avg)`);
  }

  // NDA constraint penalty
  if (netDevelopablePct < 55) {
    score -= Math.min(26, (75 - netDevelopablePct) * 0.65);
    drivers.push(`NDA ${Math.round(netDevelopablePct)}%`);
  } else if (netDevelopablePct < 80) {
    score -= (80 - netDevelopablePct) * 0.35;
    drivers.push(`NDA ${Math.round(netDevelopablePct)}%`);
  } else {
    drivers.push(`High NDA (${Math.round(netDevelopablePct)}%)`);
  }

  // Bulk earthworks volume intensity penalty
  if (earthworksIntensity > 2.2) {
    score -= Math.min(24, (earthworksIntensity - 1.2) * 8);
    drivers.push('Heavy bulk earthworks');
  } else if (earthworksIntensity > 1.0) {
    score -= (earthworksIntensity - 0.8) * 5;
    drivers.push('Moderate earthworks');
  } else {
    drivers.push('Efficient earthworks');
  }

  // Retaining wall intensity penalty
  if (retainingDensity > 180) {
    score -= Math.min(16, (retainingDensity - 120) * 0.04);
    drivers.push('High retaining demand');
  }

  const finalScore = Math.round(Math.min(99, Math.max(8, score)));
  const riskLevel: DevelopabilityRiskLevel =
    finalScore >= 70
      ? 'Low Risk'
      : finalScore >= 45
        ? 'Moderate Risk'
        : 'High Risk';

  return {
    score: finalScore,
    riskLevel,
    drivers: drivers.slice(0, 3),
  };
}

function computeDistanceToOutsideCells(
  rows: number,
  cols: number,
  insideMask: Uint8Array,
  dxM: number,
  dyM: number,
): Float32Array {
  const dist = new Float32Array(rows * cols);
  const INF = 1e9;
  const avgStep = (dxM + dyM) / 2;
  const diagStep = Math.hypot(dxM, dyM);

  // Initialize boundary inside cells touching any outside cell or grid perimeter
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (insideMask[idx] === 0) {
        dist[idx] = 0;
        continue;
      }
      const touchesBoundary =
        r === 0 ||
        r === rows - 1 ||
        c === 0 ||
        c === cols - 1 ||
        insideMask[(r - 1) * cols + c] === 0 ||
        insideMask[(r + 1) * cols + c] === 0 ||
        insideMask[r * cols + (c - 1)] === 0 ||
        insideMask[r * cols + (c + 1)] === 0;
      dist[idx] = touchesBoundary ? avgStep * 0.5 : INF;
    }
  }

  // Two-pass chamfer distance transform (O(rows * cols), deterministic)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (insideMask[idx] === 0) continue;
      let d = dist[idx];
      if (r > 0) d = Math.min(d, dist[(r - 1) * cols + c] + dyM);
      if (c > 0) d = Math.min(d, dist[r * cols + (c - 1)] + dxM);
      if (r > 0 && c > 0) d = Math.min(d, dist[(r - 1) * cols + (c - 1)] + diagStep);
      if (r > 0 && c < cols - 1) {
        d = Math.min(d, dist[(r - 1) * cols + (c + 1)] + diagStep);
      }
      dist[idx] = d;
    }
  }

  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      const idx = r * cols + c;
      if (insideMask[idx] === 0) continue;
      let d = dist[idx];
      if (r < rows - 1) d = Math.min(d, dist[(r + 1) * cols + c] + dyM);
      if (c < cols - 1) d = Math.min(d, dist[r * cols + (c + 1)] + dxM);
      if (r < rows - 1 && c < cols - 1) {
        d = Math.min(d, dist[(r + 1) * cols + (c + 1)] + diagStep);
      }
      if (r < rows - 1 && c > 0) {
        d = Math.min(d, dist[(r + 1) * cols + (c - 1)] + diagStep);
      }
      dist[idx] = d;
    }
  }

  return dist;
}

function buildInsideMask(
  grid: ElevationGrid,
  primaryPolygon: Feature<Polygon> | null,
): { insideMask: Uint8Array; cellCountInside: number; centerRow: number; centerCol: number } {
  const total = grid.rows * grid.cols;
  const insideMask = new Uint8Array(total);
  let cellCountInside = 0;
  let rowSum = 0;
  let colSum = 0;

  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const idx = r * grid.cols + c;
      let inside = true;
      if (primaryPolygon) {
        const pt = gridCellToLngLat(grid, r, c);
        inside = turf.booleanPointInPolygon(pt, primaryPolygon);
      }
      if (inside) {
        insideMask[idx] = 1;
        cellCountInside += 1;
        rowSum += r;
        colSum += c;
      }
    }
  }

  // Fallback if a tiny sliver polygon missed all cell centers: include nearest center cell
  if (cellCountInside === 0 && total > 0) {
    const midR = Math.floor(grid.rows / 2);
    const midC = Math.floor(grid.cols / 2);
    insideMask[midR * grid.cols + midC] = 1;
    return { insideMask, cellCountInside: 1, centerRow: midR, centerCol: midC };
  }

  return {
    insideMask,
    cellCountInside,
    centerRow: rowSum / cellCountInside,
    centerCol: colSum / cellCountInside,
  };
}

/**
 * Computes polygon-clipped bulk earthworks volumes across 4 civil grading strategies
 * (Best-Fit Plane, Auto-Terrace, Max Grade %, Flat Pad), per-cell cut/fill deltas,
 * bulking/compaction balance, retaining wall detection, rock/topsoil allowances,
 * tipper loads, developability score, and AUD costs.
 */
export function computeGridEarthworks(
  grid: ElevationGrid,
  boundaryGeoJson: FeatureCollection | undefined,
  params: EarthworksGridParams,
): EarthworksGridResult {
  const soilClass: SoilClass = SOIL_RATES_AUD[params.soilClass]
    ? params.soilClass
    : 'clay';
  const baseRates = SOIL_RATES_AUD[soilClass];
  const cutRate = resolveFinitePositive(params.customRates?.cutRate, baseRates.cutRate);
  const fillRate = resolveFinitePositive(params.customRates?.fillRate, baseRates.fillRate);
  const haulRate = resolveFinitePositive(params.customRates?.haulRate, baseRates.haulRate);
  const importRate = resolveFinitePositive(params.customRates?.importRate, baseRates.importRate);
  const rockBreakoutRate = resolveFinitePositive(
    params.customRates?.rockBreakoutRate,
    DEFAULT_ROCK_BREAKOUT_RATE_AUD,
  );
  const topsoilRate = resolveFinitePositive(
    params.customRates?.topsoilRate,
    DEFAULT_TOPSOIL_RATE_AUD,
  );

  const gradingStrategy: GradingStrategy = params.gradingStrategy ?? 'flat-pad';

  const targetFflAHD = Number.isFinite(params.targetFflAHD)
    ? params.targetFflAHD
    : grid.meanAHD;
  const cutSwellFactor =
    typeof params.cutSwellFactor === 'number' &&
    Number.isFinite(params.cutSwellFactor) &&
    params.cutSwellFactor > 0
      ? Math.min(2.5, Math.max(0.8, params.cutSwellFactor))
      : baseRates.defaultSwell;
  const fillCompactionFactor =
    typeof params.fillCompactionFactor === 'number' &&
    Number.isFinite(params.fillCompactionFactor) &&
    params.fillCompactionFactor > 0
      ? Math.min(1.2, Math.max(0.5, params.fillCompactionFactor))
      : baseRates.defaultCompaction;
  const batterSlopeRatio =
    typeof params.batterSlopeRatio === 'number' &&
    Number.isFinite(params.batterSlopeRatio)
      ? Math.min(10, Math.max(0, params.batterSlopeRatio))
      : 3;
  const applyBoundaryBatter =
    params.applyBoundaryBatter !== undefined
      ? params.applyBoundaryBatter
      : batterSlopeRatio > 0;
  const padSlopePct =
    typeof params.padSlopePct === 'number' && Number.isFinite(params.padSlopePct)
      ? Math.min(25, Math.max(-25, params.padSlopePct))
      : 0;
  const padCrossSlopePct =
    typeof params.padCrossSlopePct === 'number' &&
    Number.isFinite(params.padCrossSlopePct)
      ? Math.min(25, Math.max(-25, params.padCrossSlopePct))
      : 0;
  const retainingWallHeightM =
    typeof params.retainingWallHeightM === 'number' &&
    Number.isFinite(params.retainingWallHeightM)
      ? Math.min(6, Math.max(0.6, params.retainingWallHeightM))
      : 1.8;
  const maxGradePct =
    typeof params.maxGradePct === 'number' && Number.isFinite(params.maxGradePct)
      ? Math.min(20, Math.max(1, params.maxGradePct))
      : 5.0;
  const terraceStepM =
    typeof params.terraceStepM === 'number' && Number.isFinite(params.terraceStepM)
      ? Math.min(3.6, Math.max(0.4, params.terraceStepM))
      : 1.2;
  const rockBreakoutPct =
    typeof params.rockBreakoutPct === 'number' &&
    Number.isFinite(params.rockBreakoutPct)
      ? Math.min(100, Math.max(0, params.rockBreakoutPct))
      : 0;
  const topsoilDepthM =
    typeof params.topsoilDepthM === 'number' && Number.isFinite(params.topsoilDepthM)
      ? Math.min(0.6, Math.max(0, params.topsoilDepthM))
      : 0;

  const { dxM, dyM, cellAreaSqm: rawCellAreaSqm } = getGridCellMetrics(grid);
  const primaryPolygon = extractPrimaryPolygon(boundaryGeoJson);
  const { insideMask, cellCountInside, centerRow, centerCol } = buildInsideMask(
    grid,
    primaryPolygon,
  );

  // Eliminate raster boundary quantization drift when the parcel polygon is
  // fully contained within the DEM extent by matching exact geodesic polygon area.
  let cellAreaSqm = rawCellAreaSqm;
  if (primaryPolygon && cellCountInside > 0) {
    const polyBbox = turf.bbox(primaryPolygon);
    const [gMinLng, gMinLat, gMaxLng, gMaxLat] = grid.boundsWgs84;
    const eps = 1e-5;
    const isContained =
      polyBbox[0] >= gMinLng - eps &&
      polyBbox[1] >= gMinLat - eps &&
      polyBbox[2] <= gMaxLng + eps &&
      polyBbox[3] <= gMaxLat + eps;
    if (isContained) {
      const exactPolyArea = turf.area(primaryPolygon);
      if (Number.isFinite(exactPolyArea) && exactPolyArea > 0) {
        cellAreaSqm = exactPolyArea / cellCountInside;
      }
    }
  }

  // Pre-extract any valid grading pad polygons
  const preparedPads: Array<{
    spec: GradingPadSpec;
    polygon: Feature<Polygon> | null;
    centroidLngLat: [number, number] | null;
  }> = (params.gradingPads ?? []).map((spec) => {
    const poly = extractPrimaryPolygon(spec.boundaryGeoJson);
    const centroid = poly
      ? (turf.centroid(poly).geometry.coordinates as [number, number])
      : null;
    return { spec, polygon: poly, centroidLngLat: centroid };
  });

  const distToEdgeM =
    applyBoundaryBatter && batterSlopeRatio > 0
      ? computeDistanceToOutsideCells(
          grid.rows,
          grid.cols,
          insideMask,
          dxM,
          dyM,
        )
      : null;

  const totalCells = grid.rows * grid.cols;

  // Step 1: Build base unshifted proposed surface according to selected grading strategy
  const baseProposed = new Float32Array(totalCells);
  let strategyMeanAHD = targetFflAHD;

  if (gradingStrategy === 'flat-pad') {
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const idx = r * grid.cols + c;
        if (insideMask[idx] === 0) {
          baseProposed[idx] = grid.elevationsAHD[idx];
          continue;
        }
        const northOffsetM = (centerRow - r) * dyM;
        const eastOffsetM = (c - centerCol) * dxM;
        baseProposed[idx] =
          targetFflAHD +
          (padSlopePct / 100) * northOffsetM +
          (padCrossSlopePct / 100) * eastOffsetM;
      }
    }
  } else if (gradingStrategy === 'best-fit-plane') {
    const plane = fitOlsPlane(grid, insideMask, centerRow, centerCol, dxM, dyM);
    strategyMeanAHD = plane.a;
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const idx = r * grid.cols + c;
        if (insideMask[idx] === 0) {
          baseProposed[idx] = grid.elevationsAHD[idx];
          continue;
        }
        const eastOffsetM = (c - centerCol) * dxM;
        const northOffsetM = (centerRow - r) * dyM;
        baseProposed[idx] = plane.a + plane.b * eastOffsetM + plane.c * northOffsetM;
      }
    }
  } else if (gradingStrategy === 'auto-terrace') {
    const plane = fitOlsPlane(grid, insideMask, centerRow, centerCol, dxM, dyM);
    strategyMeanAHD = plane.a;
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const idx = r * colsSafe(grid.cols) + c;
        if (insideMask[idx] === 0) {
          baseProposed[idx] = grid.elevationsAHD[idx];
          continue;
        }
        const eastOffsetM = (c - centerCol) * dxM;
        const northOffsetM = (centerRow - r) * dyM;
        const trendZ = plane.a + plane.b * eastOffsetM + plane.c * northOffsetM;
        // Quantize smoothly to civil retaining benches around mean plane
        const stepIdx = Math.round((trendZ - plane.a) / terraceStepM);
        baseProposed[idx] = plane.a + stepIdx * terraceStepM;
      }
    }
  } else {
    // 'max-grade' slope-clamped surface
    const clamped = buildMaxGradeSurface(
      grid,
      insideMask,
      dxM,
      dyM,
      maxGradePct,
    );
    let insideSum = 0;
    for (let i = 0; i < totalCells; i += 1) {
      baseProposed[i] = clamped[i];
      if (insideMask[i] === 1) insideSum += clamped[i];
    }
    strategyMeanAHD =
      cellCountInside > 0 ? insideSum / cellCountInside : grid.meanAHD;
  }

  // Step 2: Optional vertical shift so non-flat strategies match targetCutFillRatio (e.g. 1.10:1)
  let verticalShiftM = 0;
  const hasTargetRatio =
    typeof params.targetCutFillRatio === 'number' &&
    Number.isFinite(params.targetCutFillRatio) &&
    params.targetCutFillRatio >= 0.6 &&
    params.targetCutFillRatio <= 2.0;

  if (gradingStrategy !== 'flat-pad' && hasTargetRatio) {
    const desiredRatio = params.targetCutFillRatio as number;
    const evalRatioResidual = (shift: number): number => {
      let cut = 0;
      let fill = 0;
      for (let i = 0; i < totalCells; i += 1) {
        if (insideMask[i] === 0) continue;
        const d = grid.elevationsAHD[i] - (baseProposed[i] + shift);
        if (d > 0) cut += d;
        else if (d < 0) fill += -d;
      }
      // cut - desiredRatio * fill decreases monotonically as shift increases
      return cut - desiredRatio * fill;
    };

    let lo = -(grid.maxAHD - grid.minAHD + 6);
    let hi = grid.maxAHD - grid.minAHD + 6;
    for (let iter = 0; iter < 22; iter += 1) {
      const mid = (lo + hi) / 2;
      const res = evalRatioResidual(mid);
      if (Math.abs(res) < 1e-4) {
        verticalShiftM = mid;
        break;
      }
      if (res > 0) {
        lo = mid;
      } else {
        hi = mid;
      }
      verticalShiftM = mid;
    }
  } else if (gradingStrategy !== 'flat-pad' && !hasTargetRatio) {
    // Allow explicit FFL shifting when optimizeZeroBalanceFfl or manual FFL is driving the datum
    verticalShiftM = targetFflAHD - strategyMeanAHD;
  }

  const effectiveDatumFfl =
    gradingStrategy === 'flat-pad'
      ? targetFflAHD
      : strategyMeanAHD + verticalShiftM;

  // Step 3: Apply named grading pad overrides, perimeter batter clamping, and integrate volumes
  const proposedGrid = new Float32Array(totalCells);
  const deltaGrid = new Float32Array(totalCells);

  let cutVolumeM3 = 0;
  let fillVolumeM3 = 0;
  let maxCutDepthM = 0;
  let maxFillDepthM = 0;

  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const idx = r * grid.cols + c;
      const existingAHD = grid.elevationsAHD[idx];

      if (insideMask[idx] === 0) {
        proposedGrid[idx] = existingAHD;
        deltaGrid[idx] = 0;
        continue;
      }

      let proposedAHD = baseProposed[idx] + verticalShiftM;
      let cellBatterRatio = batterSlopeRatio;

      // Apply grading pad overrides if cell falls inside a named pad polygon
      if (preparedPads.length > 0) {
        const cellLngLat = gridCellToLngLat(grid, r, c);
        for (const pad of preparedPads) {
          if (
            pad.polygon &&
            turf.booleanPointInPolygon(cellLngLat, pad.polygon)
          ) {
            const padSlope = Number.isFinite(pad.spec.slopePct)
              ? pad.spec.slopePct
              : 0;
            const padBaseFfl = Number.isFinite(pad.spec.targetFflAHD)
              ? pad.spec.targetFflAHD
              : effectiveDatumFfl;
            const padNorthOffsetM = pad.centroidLngLat
              ? (cellLngLat[1] - pad.centroidLngLat[1]) * 111_132
              : 0;
            proposedAHD = padBaseFfl + (padSlope / 100) * padNorthOffsetM;
            if (
              Number.isFinite(pad.spec.batterSlopeRatio) &&
              pad.spec.batterSlopeRatio >= 0
            ) {
              cellBatterRatio = pad.spec.batterSlopeRatio;
            }
            break;
          }
        }
      }

      // Apply perimeter batter transition (1:N slope towards natural ground at boundary)
      if (applyBoundaryBatter && cellBatterRatio > 0 && distToEdgeM) {
        const edgeDist = distToEdgeM[idx];
        const maxDeltaAtEdge = edgeDist / cellBatterRatio;
        const rawDelta = existingAHD - proposedAHD;
        if (Math.abs(rawDelta) > maxDeltaAtEdge) {
          const clampedDelta = Math.sign(rawDelta) * maxDeltaAtEdge;
          proposedAHD = existingAHD - clampedDelta;
        }
      }

      const delta = existingAHD - proposedAHD; // > 0 = Cut, < 0 = Fill
      proposedGrid[idx] = proposedAHD;
      deltaGrid[idx] = delta;

      if (delta > 0) {
        cutVolumeM3 += delta * cellAreaSqm;
        if (delta > maxCutDepthM) maxCutDepthM = delta;
      } else if (delta < 0) {
        const fillDepth = -delta;
        fillVolumeM3 += fillDepth * cellAreaSqm;
        if (fillDepth > maxFillDepthM) maxFillDepthM = fillDepth;
      }
    }
  }

  // Detect retaining wall length along boundary / inter-pad / inter-terrace grade transitions where |delta| > 0.6m
  let detectedRetainingLengthM = 0;
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const idx = r * grid.cols + c;
      if (insideMask[idx] === 0) continue;

      const absDelta = Math.abs(deltaGrid[idx]);
      const prop = proposedGrid[idx];

      // North / South boundary edges (width dxM)
      const northOutside = r === 0 || insideMask[(r - 1) * grid.cols + c] === 0;
      const southOutside =
        r === grid.rows - 1 || insideMask[(r + 1) * grid.cols + c] === 0;
      if (northOutside && absDelta > RETAINING_WALL_DELTA_THRESHOLD_M) {
        detectedRetainingLengthM += dxM;
      }
      if (southOutside && absDelta > RETAINING_WALL_DELTA_THRESHOLD_M) {
        detectedRetainingLengthM += dxM;
      }

      // West / East boundary edges (height dyM)
      const westOutside = c === 0 || insideMask[r * grid.cols + (c - 1)] === 0;
      const eastOutside =
        c === grid.cols - 1 || insideMask[r * grid.cols + (c + 1)] === 0;
      if (westOutside && absDelta > RETAINING_WALL_DELTA_THRESHOLD_M) {
        detectedRetainingLengthM += dyM;
      }
      if (eastOutside && absDelta > RETAINING_WALL_DELTA_THRESHOLD_M) {
        detectedRetainingLengthM += dyM;
      }

      // Internal pad / terrace step transitions (check South and East neighbors to avoid double counting)
      if (!southOutside) {
        const southProp = proposedGrid[(r + 1) * grid.cols + c];
        if (Math.abs(prop - southProp) > RETAINING_WALL_DELTA_THRESHOLD_M) {
          detectedRetainingLengthM += dxM;
        }
      }
      if (!eastOutside) {
        const eastProp = proposedGrid[r * grid.cols + (c + 1)];
        if (Math.abs(prop - eastProp) > RETAINING_WALL_DELTA_THRESHOLD_M) {
          detectedRetainingLengthM += dyM;
        }
      }
    }
  }

  const retainingWallLengthM =
    typeof params.retainingWallLengthOverrideM === 'number' &&
    Number.isFinite(params.retainingWallLengthOverrideM) &&
    params.retainingWallLengthOverrideM >= 0
      ? roundTwo(params.retainingWallLengthOverrideM)
      : roundTwo(detectedRetainingLengthM);

  const compactedCutM3 = cutVolumeM3 * fillCompactionFactor;
  const looseCutVolumeM3 = cutVolumeM3 * cutSwellFactor;
  const netBalanceM3 = compactedCutM3 - fillVolumeM3;
  const importExportVolumeM3 = Math.abs(netBalanceM3);
  const balanceDirection: EarthworksGridResult['balanceDirection'] =
    importExportVolumeM3 < 10
      ? 'balanced'
      : netBalanceM3 > 0
        ? 'export'
        : 'import';

  const cutFillRatio =
    fillVolumeM3 > 0.01
      ? roundTwo(cutVolumeM3 / fillVolumeM3)
      : cutVolumeM3 > 0.01
        ? 99.99
        : 1.0;

  const insideAreaSqm = roundTwo(cellCountInside * cellAreaSqm);
  const insideAreaHa = insideAreaSqm / 10_000;

  // Cost calculation (AUD) — exact baseline when rockBreakoutPct & topsoilDepthM are 0
  const cutCostAud = roundTwo(cutVolumeM3 * cutRate);
  const onSiteFillM3 = Math.min(compactedCutM3, fillVolumeM3);
  const fillPlacementCostAud = roundTwo(onSiteFillM3 * fillRate);
  const haulLooseM3 = importExportVolumeM3 * cutSwellFactor;
  const haulOrImportCostAud = roundTwo(
    netBalanceM3 >= 0
      ? haulLooseM3 * haulRate
      : importExportVolumeM3 * importRate,
  );
  const rockBreakoutVolumeM3 = roundTwo(cutVolumeM3 * (rockBreakoutPct / 100));
  const rockBreakoutCostAud = roundTwo(rockBreakoutVolumeM3 * rockBreakoutRate);
  const topsoilVolumeM3 = roundTwo(insideAreaSqm * topsoilDepthM);
  const topsoilCostAud = roundTwo(topsoilVolumeM3 * topsoilRate);

  const bulkEarthworksCostAud = roundTwo(
    cutCostAud +
      fillPlacementCostAud +
      haulOrImportCostAud +
      rockBreakoutCostAud +
      topsoilCostAud,
  );

  const retainingWallRatePerLmAud = resolveFinitePositive(
    params.customRates?.retainingRatePerLm,
    getRetainingWallRatePerLm(retainingWallHeightM),
  );
  const retainingWallCostAud = roundTwo(
    retainingWallLengthM * retainingWallRatePerLmAud,
  );
  const totalPackageAud = roundTwo(
    bulkEarthworksCostAud + retainingWallCostAud,
  );

  const tipperLoads =
    importExportVolumeM3 < 0.01
      ? 0
      : Math.ceil(haulLooseM3 / TIPPER_TRUCK_CAPACITY_M3);
  const costPerSqmAud =
    insideAreaSqm > 0 ? roundTwo(totalPackageAud / insideAreaSqm) : 0;
  const costPerHaAud =
    insideAreaHa > 0 ? roundTwo(totalPackageAud / insideAreaHa) : 0;

  const ndaHa =
    typeof params.netDevelopableAreaHa === 'number' &&
    Number.isFinite(params.netDevelopableAreaHa) &&
    params.netDevelopableAreaHa >= 0
      ? params.netDevelopableAreaHa
      : insideAreaHa * 0.78;
  const ndaPct = insideAreaHa > 0 ? Math.min(100, (ndaHa / insideAreaHa) * 100) : 78;

  const estimatedLots =
    typeof params.lotYieldBasis === 'number' &&
    Number.isFinite(params.lotYieldBasis) &&
    params.lotYieldBasis >= 1
      ? Math.round(params.lotYieldBasis)
      : Math.max(1, Math.round(ndaHa * 15));
  const costPerLotAud = roundTwo(totalPackageAud / estimatedLots);

  const avgExistingGradePct = computeMeanSurfaceGradePct(
    grid.rows,
    grid.cols,
    grid.elevationsAHD,
    insideMask,
    dxM,
    dyM,
  );
  const avgDesignGradePct = computeMeanSurfaceGradePct(
    grid.rows,
    grid.cols,
    proposedGrid,
    insideMask,
    dxM,
    dyM,
  );

  const developability = scoreDevelopability(
    avgExistingGradePct,
    insideAreaSqm,
    cutVolumeM3,
    fillVolumeM3,
    retainingWallLengthM,
    ndaPct,
  );

  return {
    rows: grid.rows,
    cols: grid.cols,
    cellSizeM: grid.cellSizeM,
    cellAreaSqm: roundTwo(cellAreaSqm),
    cellCountInside,
    insideAreaSqm,
    insideMask,
    proposedGrid,
    deltaGrid,
    gradingStrategy,
    targetFflAHD: Number(effectiveDatumFfl.toFixed(3)),
    soilClass,
    cutSwellFactor,
    fillCompactionFactor,
    batterSlopeRatio,
    cutVolumeM3: roundTwo(cutVolumeM3),
    looseCutVolumeM3: roundTwo(looseCutVolumeM3),
    compactedCutM3: roundTwo(compactedCutM3),
    fillVolumeM3: roundTwo(fillVolumeM3),
    cutFillRatio,
    netBalanceM3: roundTwo(netBalanceM3),
    importExportVolumeM3: roundTwo(importExportVolumeM3),
    balanceDirection,
    maxCutDepthM: Number(maxCutDepthM.toFixed(3)),
    maxFillDepthM: Number(maxFillDepthM.toFixed(3)),
    avgExistingGradePct,
    avgDesignGradePct,
    retainingWallLengthM,
    retainingWallHeightM,
    retainingWallRatePerLmAud,
    rockBreakoutPct,
    rockBreakoutVolumeM3,
    rockBreakoutCostAud,
    topsoilDepthM,
    topsoilVolumeM3,
    topsoilCostAud,
    cutCostAud,
    fillPlacementCostAud,
    haulOrImportCostAud,
    bulkEarthworksCostAud,
    retainingWallCostAud,
    totalPackageAud,
    tipperLoads,
    costPerSqmAud,
    costPerHaAud,
    estimatedLots,
    costPerLotAud,
    developability,
  };
}

function colsSafe(cols: number): number {
  return Math.max(1, cols);
}

/**
 * Solves the optimal target Finished Floor Level (m AHD) via binary search across
 * [grid.minAHD - 2, grid.maxAHD + 2] that minimizes |netBalanceM3| to < 5 m³ in <= 24 iterations.
 */
export function optimizeZeroBalanceFfl(
  grid: ElevationGrid,
  boundaryGeoJson: FeatureCollection | undefined,
  params: EarthworksGridParams,
): ZeroBalanceOptimizationResult {
  let lo = grid.minAHD - 2;
  let hi = grid.maxAHD + 2;

  const evalBalance = (ffl: number): number =>
    computeGridEarthworks(grid, boundaryGeoJson, {
      ...params,
      targetCutFillRatio: undefined,
      targetFflAHD: ffl,
    }).netBalanceM3;

  // Ensure bracket spans zero if steep padSlopePct shifted effective range
  let fLo = evalBalance(lo);
  let fHi = evalBalance(hi);
  let guard = 0;
  while (fLo < 0 && guard < 4) {
    lo -= 10;
    fLo = evalBalance(lo);
    guard += 1;
  }
  guard = 0;
  while (fHi > 0 && guard < 4) {
    hi += 10;
    fHi = evalBalance(hi);
    guard += 1;
  }

  let bestFfl = (lo + hi) / 2;
  let bestBalance = evalBalance(bestFfl);
  let iterations = 0;

  for (let i = 1; i <= 24; i += 1) {
    iterations = i;
    const mid = (lo + hi) / 2;
    const balance = evalBalance(mid);
    if (Math.abs(balance) < Math.abs(bestBalance)) {
      bestFfl = mid;
      bestBalance = balance;
    }
    if (Math.abs(balance) < 0.25 || Math.abs(hi - lo) < 1e-5) {
      bestFfl = mid;
      bestBalance = balance;
      break;
    }
    // netBalanceM3 decreases monotonically as FFL increases
    if (balance > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const roundedFfl = Number(bestFfl.toFixed(4));
  const verifiedBalance = evalBalance(roundedFfl);

  return {
    optimalFflAHD: roundedFfl,
    residualBalanceM3: roundTwo(verifiedBalance),
    iterations,
  };
}

function sampleFloatGridBilinear(
  grid: ElevationGrid,
  data: Float32Array,
  lng: number,
  lat: number,
): number {
  const [minLng, minLat, maxLng, maxLat] = grid.boundsWgs84;
  const colF = Math.min(
    grid.cols - 1,
    Math.max(0, ((lng - minLng) / (maxLng - minLng)) * grid.cols - 0.5),
  );
  const rowF = Math.min(
    grid.rows - 1,
    Math.max(0, ((maxLat - lat) / (maxLat - minLat)) * grid.rows - 0.5),
  );
  const c0 = Math.floor(colF);
  const r0 = Math.floor(rowF);
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const fx = colF - c0;
  const fy = rowF - r0;

  const v00 = data[r0 * grid.cols + c0] ?? 0;
  const v10 = data[r0 * grid.cols + c1] ?? 0;
  const v01 = data[r1 * grid.cols + c0] ?? 0;
  const v11 = data[r1 * grid.cols + c1] ?? 0;

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Samples existing AHD, proposed AHD, cut/fill depth, and metric chainage along an A–A' transect.
 */
export function sampleSectionProfile(
  grid: ElevationGrid,
  deltaGrid: Float32Array,
  startLngLat: [number, number],
  endLngLat: [number, number],
  samples = 48,
): SectionProfilePoint[] {
  const count = Math.min(
    256,
    Math.max(2, Math.round(Number.isFinite(samples) ? samples : 48)),
  );
  const totalDistanceM = turf.distance(startLngLat, endLngLat, {
    units: 'meters',
  });
  const safeDistanceM = Number.isFinite(totalDistanceM) ? totalDistanceM : 0;

  const profile: SectionProfilePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const lng = startLngLat[0] + (endLngLat[0] - startLngLat[0]) * t;
    const lat = startLngLat[1] + (endLngLat[1] - startLngLat[1]) * t;
    const existingAHD = sampleElevationAtLngLat(grid, lng, lat);
    const cutFillM = sampleFloatGridBilinear(grid, deltaGrid, lng, lat);
    const proposedAHD = existingAHD - cutFillM;

    profile.push({
      chainageM: Number((safeDistanceM * t).toFixed(2)),
      lng: Number(lng.toFixed(7)),
      lat: Number(lat.toFixed(7)),
      existingAHD: Number(existingAHD.toFixed(3)),
      proposedAHD: Number(proposedAHD.toFixed(3)),
      cutFillM: Number(cutFillM.toFixed(3)),
    });
  }
  return profile;
}
