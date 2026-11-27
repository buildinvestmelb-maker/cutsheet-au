import { describe, expect, it } from 'vitest';
import { STARTER_DEALS } from '../../data/starterDeals';
import {
  computePolygonMetrics,
  createRectPolygonFeatureCollection,
} from '../geo/auGeoKernel';
import { buildCutSheetPdfBlob, buildSurfaceXyzCsv } from './civilExports';
import {
  getGridCellMetrics,
  type ElevationGrid,
} from './demLoader';
import { computeGridEarthworks } from './gridVolumeEngine';
import {
  analyzeTerrainHydrology,
  computeTerrainLensRgba,
} from './hydrologyEngine';

function makeSyntheticGrid(
  rows: number,
  cols: number,
  boundsWgs84: [number, number, number, number],
  fn: (r: number, c: number, rows: number, cols: number, dxM: number, dyM: number) => number,
): ElevationGrid {
  const draft: ElevationGrid = {
    rows,
    cols,
    cellSizeM: 10,
    boundsWgs84,
    elevationsAHD: new Float32Array(rows * cols),
    minAHD: 0,
    maxAHD: 0,
    meanAHD: 0,
    source: 'synthetic',
    sourceLabel: 'Unit Test Grid',
    mgaZone: 56,
    mgaEpsg: 'EPSG:7856',
  };
  const { dxM, dyM } = getGridCellMetrics(draft);
  let minAHD = Number.POSITIVE_INFINITY;
  let maxAHD = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const z = fn(r, c, rows, cols, dxM, dyM);
      draft.elevationsAHD[r * cols + c] = z;
      if (z < minAHD) minAHD = z;
      if (z > maxAHD) maxAHD = z;
      sum += z;
    }
  }
  draft.cellSizeM = Number(Math.sqrt(dxM * dyM).toFixed(3));
  draft.minAHD = Number(minAHD.toFixed(3));
  draft.maxAHD = Number(maxAHD.toFixed(3));
  draft.meanAHD = Number((sum / (rows * cols)).toFixed(3));
  return draft;
}

describe('HydrologyEngine: Horn 3x3 Slope, Priority-Flood Depressions, D8 Overland Flow & Draped Lens', () => {
  it('classifies flat, moderate (8%), and steep (20%) synthetic slopes accurately into 4 civil bands', () => {
    const parcel = createRectPolygonFeatureCollection(-33.8688, 151.2093, 200, 200);
    const { bbox } = computePolygonMetrics(parcel);
    const fullMask = new Uint8Array(20 * 20).fill(1);

    // 1. Perfectly flat 50m plane -> 100% 0-5% Flat
    const flatGrid = makeSyntheticGrid(20, 20, bbox, () => 50);
    const flatMetrics = getGridCellMetrics(flatGrid);
    const flatHydro = analyzeTerrainHydrology(flatGrid, fullMask, flatMetrics.cellAreaSqm);
    expect(flatHydro.avgSlopePct).toBeCloseTo(0, 2);
    expect(flatHydro.slopeBands[0].pct).toBeCloseTo(100, 1);
    expect(flatHydro.steepAreaHa).toBe(0);

    // 2. Uniform 8% east-west plane -> falls into 5-10% Moderate band
    const modGrid = makeSyntheticGrid(20, 20, bbox, (_r, c, _rows, _cols, dxM) => 40 + c * dxM * 0.08);
    const modHydro = analyzeTerrainHydrology(modGrid, fullMask, flatMetrics.cellAreaSqm);
    expect(modHydro.avgSlopePct).toBeGreaterThan(7.0);
    expect(modHydro.avgSlopePct).toBeLessThan(8.5);
    expect(modHydro.slopeBands[1].pct).toBeGreaterThan(80);

    // 3. Steep 20% hillside -> majority in >15% Steep band and reduces NDA
    const steepGrid = makeSyntheticGrid(20, 20, bbox, (r, _c, _rows, _cols, _dxM, dyM) => 100 - r * dyM * 0.2);
    const steepHydro = analyzeTerrainHydrology(steepGrid, fullMask, flatMetrics.cellAreaSqm);
    expect(steepHydro.avgSlopePct).toBeGreaterThan(17.5);
    expect(steepHydro.slopeBands[3].pct).toBeGreaterThan(80);
    expect(steepHydro.steepAreaHa).toBeGreaterThan(3.0);
    expect(steepHydro.netDevelopablePct).toBeLessThan(25);
  });

  it('detects an enclosed Priority-Flood depression basin and computes accurate natural storage volume', () => {
    const parcel = createRectPolygonFeatureCollection(-33.9, 150.8, 200, 200);
    const { bbox } = computePolygonMetrics(parcel);
    const rows = 20;
    const cols = 20;
    const fullMask = new Uint8Array(rows * cols).fill(1);

    // Create a flat 50m plateau with a 1.5m deep closed bowl centered at (10, 10)
    const bowlGrid = makeSyntheticGrid(rows, cols, bbox, (r, c) => {
      const dist = Math.hypot(r - 10, c - 10);
      if (dist < 4.5) {
        return 50 - 1.5 * (1 - dist / 4.5);
      }
      return 50;
    });
    const metrics = getGridCellMetrics(bowlGrid);
    const hydro = analyzeTerrainHydrology(bowlGrid, fullMask, metrics.cellAreaSqm, {
      depressionThresholdM: 0.15,
    });

    expect(hydro.depressions.length).toBeGreaterThanOrEqual(1);
    expect(hydro.maxDepressionDepthM).toBeGreaterThan(1.3);
    expect(hydro.maxDepressionDepthM).toBeLessThanOrEqual(1.55);
    expect(hydro.naturalStorageM3).toBeGreaterThan(1500);
    expect(hydro.depressionsGeoJson.features.length).toBe(hydro.depressions.length);
  });

  it('routes D8 overland flow along a V-shaped valley and emits connected GeoJSON reaches', () => {
    const parcel = createRectPolygonFeatureCollection(-37.81, 144.96, 300, 300);
    const { bbox } = computePolygonMetrics(parcel);
    const rows = 24;
    const cols = 24;
    const fullMask = new Uint8Array(rows * cols).fill(1);

    // V-shaped valley sloping north-to-south down column 12
    const valleyGrid = makeSyntheticGrid(rows, cols, bbox, (r, c, _rows, _cols, dxM, dyM) => {
      const distFromChannelM = Math.abs(c - 12) * dxM;
      const longitudinalDropM = r * dyM * 0.04;
      return 80 + distFromChannelM * 0.08 - longitudinalDropM;
    });
    const metrics = getGridCellMetrics(valleyGrid);
    const hydro = analyzeTerrainHydrology(valleyGrid, fullMask, metrics.cellAreaSqm, {
      catchmentThresholdHa: 0.5,
    });

    expect(hydro.activeReaches).toBeGreaterThanOrEqual(1);
    expect(hydro.peakCatchmentHa).toBeGreaterThan(3.0);
    expect(hydro.flowLinesGeoJson.features.length).toBe(hydro.activeReaches);
    for (const feat of hydro.flowLinesGeoJson.features) {
      expect(feat.geometry.type).toBe('LineString');
      expect(feat.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('renders transparent outside cells and opaque shaded inside cells across all 3 terrain lens modes', () => {
    const parcel = createRectPolygonFeatureCollection(-33.8688, 151.2093, 150, 150);
    const { bbox } = computePolygonMetrics(parcel);
    const grid = makeSyntheticGrid(12, 12, bbox, (r, c) => 50 + r * 0.4 - c * 0.2);
    const mask = new Uint8Array(12 * 12);
    // Only interior 6x6 cells are inside
    for (let r = 3; r < 9; r += 1) {
      for (let c = 3; c < 9; c += 1) mask[r * 12 + c] = 1;
    }
    const delta = new Float32Array(12 * 12).map((_, i) => (i % 2 === 0 ? 1.1 : -0.9));
    const slope = new Float32Array(12 * 12).fill(12);

    for (const mode of ['hillshade', 'slope-bands', 'cut-fill'] as const) {
      const buf = computeTerrainLensRgba(grid, mask, delta, slope, {
        mode,
        sunAzimuthDeg: 315,
        sunAltitudeDeg: 42,
        verticalExaggeration: 3,
      });
      expect(buf.width).toBe(12);
      expect(buf.height).toBe(12);
      expect(buf.rgba.length).toBe(12 * 12 * 4);
      // Corner (0,0) is outside -> alpha 0
      expect(buf.rgba[3]).toBe(0);
      // Center (5,5) is inside -> opaque alpha > 0
      const centerAlpha = buf.rgba[(5 * 12 + 5) * 4 + 3];
      expect(centerAlpha).toBeGreaterThan(150);
    }
  });
});

describe('Multi-Strategy Civil Grading Solvers & Commercial PDF / XYZ Exports', () => {
  it('Best-Fit Plane dramatically reduces earthworks vs Flat Pad on a tilted slope and honours Target Cut:Fill Ratio', () => {
    const parcel = createRectPolygonFeatureCollection(-33.9249, 150.7932, 200, 150);
    const { bbox } = computePolygonMetrics(parcel);
    // Tilted undulating hillside (~8% grade + small local humps)
    const hillGrid = makeSyntheticGrid(24, 24, bbox, (r, c, _rows, _cols, dxM, dyM) => {
      return 60 + c * dxM * 0.06 + r * dyM * 0.04 + Math.sin(r * 0.6) * 0.6;
    });

    const flatRes = computeGridEarthworks(hillGrid, parcel, {
      targetFflAHD: hillGrid.meanAHD,
      soilClass: 'clay',
      gradingStrategy: 'flat-pad',
      applyBoundaryBatter: false,
    });
    const bestFitRes = computeGridEarthworks(hillGrid, parcel, {
      targetFflAHD: hillGrid.meanAHD,
      soilClass: 'clay',
      gradingStrategy: 'best-fit-plane',
      targetCutFillRatio: 1.1,
      applyBoundaryBatter: false,
    });

    expect(bestFitRes.cutVolumeM3 + bestFitRes.fillVolumeM3).toBeLessThan(
      (flatRes.cutVolumeM3 + flatRes.fillVolumeM3) * 0.35,
    );
    expect(bestFitRes.cutFillRatio).toBeGreaterThan(1.02);
    expect(bestFitRes.cutFillRatio).toBeLessThan(1.18);
  });

  it('Auto-Terrace detects inter-bench retaining walls and Max-Grade clamps steep terrain grades', () => {
    const parcel = createRectPolygonFeatureCollection(-27.47, 153.02, 200, 200);
    const { bbox } = computePolygonMetrics(parcel);
    const steepHill = makeSyntheticGrid(22, 22, bbox, (r, _c, _rows, _cols, _dxM, dyM) => {
      return 90 - r * dyM * 0.14; // 14% slope
    });

    const terraceRes = computeGridEarthworks(steepHill, parcel, {
      targetFflAHD: steepHill.meanAHD,
      soilClass: 'clay',
      gradingStrategy: 'auto-terrace',
      terraceStepM: 1.5,
      targetCutFillRatio: 1.0,
      applyBoundaryBatter: false,
    });
    expect(terraceRes.retainingWallLengthM).toBeGreaterThan(200);
    expect(terraceRes.avgDesignGradePct).toBeLessThan(steepHill.maxAHD);

    const maxGradeRes = computeGridEarthworks(steepHill, parcel, {
      targetFflAHD: steepHill.meanAHD,
      soilClass: 'clay',
      gradingStrategy: 'max-grade',
      maxGradePct: 5.0,
      targetCutFillRatio: 1.0,
      applyBoundaryBatter: false,
      rockBreakoutPct: 15,
      topsoilDepthM: 0.15,
    });
    expect(maxGradeRes.avgDesignGradePct).toBeLessThan(maxGradeRes.avgExistingGradePct);
    expect(maxGradeRes.rockBreakoutCostAud).toBeGreaterThan(0);
    expect(maxGradeRes.topsoilCostAud).toBeGreaterThan(0);
    expect(maxGradeRes.costPerLotAud).toBeGreaterThan(0);
    expect(maxGradeRes.developability.score).toBeGreaterThanOrEqual(8);
    expect(maxGradeRes.developability.score).toBeLessThanOrEqual(99);
  });

  it('exports valid MGA2020 Surface XYZ CSV and commercial CutSheet PDF report Blob', () => {
    const deal = STARTER_DEALS[0].project;
    const parcel = createRectPolygonFeatureCollection(
      deal.location.lat,
      deal.location.lng,
      200,
      200,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const grid = makeSyntheticGrid(14, 14, bbox, (r, c) => 62 + r * 0.25 + c * 0.15);

    const ew = computeGridEarthworks(grid, parcel, {
      targetFflAHD: 64.2,
      soilClass: 'clay',
      gradingStrategy: 'best-fit-plane',
      targetCutFillRatio: 1.1,
      rockBreakoutPct: 10,
      topsoilDepthM: 0.15,
    });
    const hydro = analyzeTerrainHydrology(grid, ew.insideMask, ew.cellAreaSqm);

    const xyzCsv = buildSurfaceXyzCsv(grid, ew);
    const lines = xyzCsv.trim().split('\r\n');
    expect(lines[0]).toContain('Easting_MGA2020_m,Northing_MGA2020_m');
    expect(lines.length).toBe(14 * 14 + 1);
    expect(lines[1]).toContain('EPSG:7856');

    const pdfBlob = buildCutSheetPdfBlob(deal, ew, hydro);
    expect(pdfBlob).toBeInstanceOf(Blob);
    expect(pdfBlob.size).toBeGreaterThan(1500);
  });
});
