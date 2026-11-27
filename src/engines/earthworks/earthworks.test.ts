import type { LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { STARTER_DEALS } from '../../data/starterDeals';
import {
  computePolygonMetrics,
  createRectPolygonFeatureCollection,
} from '../geo/auGeoKernel';
import {
  buildEarthworksBoqCsv,
  buildEarthworksContoursDxf,
  buildEarthworksGeoJson,
  buildLandXmlSurface,
} from './civilExports';
import { generateElevationContours } from './contourGenerator';
import {
  buildSyntheticAustralianDem,
  sampleElevationAtLngLat,
  type ElevationGrid,
} from './demLoader';
import {
  SOIL_RATES_AUD,
  computeGridEarthworks,
  getRetainingWallRatePerLm,
  optimizeZeroBalanceFfl,
  sampleSectionProfile,
} from './gridVolumeEngine';

describe('Polygon-clipped grid earthworks volume integration & Zero-Balance FFL optimizer', () => {
  it('integrates exact cut and fill prism volumes on a known 100m x 100m flat parcel', () => {
    const parcel = createRectPolygonFeatureCollection(
      -33.8688,
      151.2093,
      100,
      100,
    );
    const { bbox } = computePolygonMetrics(parcel);
    // Perfectly flat 50.0 m AHD surface across 100m x 100m = 10,000 m²
    const flatGrid = buildSyntheticAustralianDem(bbox, 50.0, 0, 25);

    // 1. Uniform 2.0m cut prism -> exact 20,000 m³ cut, 0 m³ fill
    const cutRes = computeGridEarthworks(flatGrid, parcel, {
      targetFflAHD: 48.0,
      soilClass: 'clay',
      applyBoundaryBatter: false,
    });
    expect(cutRes.cellCountInside).toBe(flatGrid.rows * flatGrid.cols);
    expect(cutRes.cutVolumeM3).toBeGreaterThan(19_850);
    expect(cutRes.cutVolumeM3).toBeLessThan(20_150);
    expect(cutRes.fillVolumeM3).toBe(0);
    expect(cutRes.compactedCutM3).toBeCloseTo(
      cutRes.cutVolumeM3 * SOIL_RATES_AUD.clay.defaultCompaction,
      0,
    );
    expect(cutRes.looseCutVolumeM3).toBeCloseTo(
      cutRes.cutVolumeM3 * SOIL_RATES_AUD.clay.defaultSwell,
      0,
    );
    expect(cutRes.balanceDirection).toBe('export');
    expect(cutRes.tipperLoads).toBeGreaterThan(1000);
    // 2.0m step around 400m perimeter triggers ~400m auto-detected retaining wall
    expect(cutRes.retainingWallLengthM).toBeGreaterThan(380);
    expect(cutRes.retainingWallLengthM).toBeLessThan(420);

    // 2. Uniform 1.5m fill prism -> exact 15,000 m³ fill, 0 m³ cut
    const fillRes = computeGridEarthworks(flatGrid, parcel, {
      targetFflAHD: 51.5,
      soilClass: 'sand',
      applyBoundaryBatter: false,
    });
    expect(fillRes.cutVolumeM3).toBe(0);
    expect(fillRes.fillVolumeM3).toBeGreaterThan(14_850);
    expect(fillRes.fillVolumeM3).toBeLessThan(15_150);
    expect(fillRes.balanceDirection).toBe('import');

    // 3. AS 2870 geotechnical rate ordering: rock > clay > sand for identical cut prism
    const sandCost = computeGridEarthworks(flatGrid, parcel, {
      targetFflAHD: 48.0,
      soilClass: 'sand',
      applyBoundaryBatter: false,
    }).bulkEarthworksCostAud;
    const clayCost = cutRes.bulkEarthworksCostAud;
    const rockCost = computeGridEarthworks(flatGrid, parcel, {
      targetFflAHD: 48.0,
      soilClass: 'rock',
      applyBoundaryBatter: false,
    }).bulkEarthworksCostAud;
    expect(rockCost).toBeGreaterThan(clayCost);
    expect(clayCost).toBeGreaterThan(sandCost);
  });

  it('clips grid cells strictly to parcel polygon, applies batter slope clamping & grading pads, and honours retaining override', () => {
    const outerParcel = createRectPolygonFeatureCollection(
      -37.8136,
      144.9631,
      200,
      200,
    );
    const innerParcel = createRectPolygonFeatureCollection(
      -37.8136,
      144.9631,
      100,
      100,
    );
    const { bbox: outerBbox } = computePolygonMetrics(outerParcel);
    const grid = buildSyntheticAustralianDem(outerBbox, 60.0, 0, 24);

    // Clipped to inner 100x100 parcel (~25% of outer 200x200 area = ~10,000 m²)
    const clipped = computeGridEarthworks(grid, innerParcel, {
      targetFflAHD: 58.0,
      soilClass: 'clay',
      applyBoundaryBatter: false,
      retainingWallLengthOverrideM: 120,
      retainingWallHeightM: 2.4,
    });
    expect(clipped.cellCountInside).toBeLessThan(grid.rows * grid.cols * 0.35);
    expect(clipped.insideAreaSqm).toBeGreaterThan(8_500);
    expect(clipped.insideAreaSqm).toBeLessThan(11_500);
    expect(clipped.retainingWallLengthM).toBe(120);
    expect(clipped.retainingWallRatePerLmAud).toBe(1320);
    expect(clipped.retainingWallCostAud).toBe(120 * 1320);

    // Batter slope 1:3 smoothly tapers perimeter cut, reducing total cut volume vs vertical face
    const battered = computeGridEarthworks(grid, innerParcel, {
      targetFflAHD: 58.0,
      soilClass: 'clay',
      batterSlopeRatio: 3,
      applyBoundaryBatter: true,
    });
    expect(battered.cutVolumeM3).toBeLessThan(clipped.cutVolumeM3);
    expect(battered.cutVolumeM3).toBeGreaterThan(0);

    // Retaining wall height interpolation check
    expect(getRetainingWallRatePerLm(1.2)).toBe(680);
    expect(getRetainingWallRatePerLm(1.8)).toBe(940);
    expect(getRetainingWallRatePerLm(2.4)).toBe(1320);
    expect(getRetainingWallRatePerLm(3.0)).toBe(1780);
    expect(getRetainingWallRatePerLm(2.1)).toBe(1130);
  });

  it('converges Zero-Balance FFL binary search to |netBalanceM3| < 5 m³ in <= 24 iterations across sloped terrains and soils', () => {
    const parcel = createRectPolygonFeatureCollection(
      -42.8935,
      147.4342,
      200,
      150,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const slopedGrid = buildSyntheticAustralianDem(bbox, 72.5, 9.0, 28);

    for (const soilClass of ['sand', 'clay', 'rock'] as const) {
      const opt = optimizeZeroBalanceFfl(slopedGrid, parcel, {
        targetFflAHD: slopedGrid.meanAHD,
        soilClass,
        batterSlopeRatio: 3,
      });
      expect(opt.iterations).toBeLessThanOrEqual(24);
      expect(Math.abs(opt.residualBalanceM3)).toBeLessThan(5);

      const verified = computeGridEarthworks(slopedGrid, parcel, {
        targetFflAHD: opt.optimalFflAHD,
        soilClass,
        batterSlopeRatio: 3,
      });
      expect(Math.abs(verified.netBalanceM3)).toBeLessThan(5);
      expect(verified.balanceDirection).toBe('balanced');
    }
  });

  it('samples A–A’ section profile with accurate metric chainage and exact existing - proposed = cutFillM', () => {
    const parcel = createRectPolygonFeatureCollection(
      -33.9249,
      150.7932,
      200,
      100,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const grid = buildSyntheticAustralianDem(bbox, 64.2, 6.0, 24);
    const ew = computeGridEarthworks(grid, parcel, {
      targetFflAHD: 64.2,
      soilClass: 'clay',
    });

    const midLat = (bbox[1] + bbox[3]) / 2;
    const profile = sampleSectionProfile(
      grid,
      ew.deltaGrid,
      [bbox[0], midLat],
      [bbox[2], midLat],
      40,
    );

    expect(profile).toHaveLength(40);
    expect(profile[0].chainageM).toBe(0);
    expect(profile[39].chainageM).toBeGreaterThan(195);
    expect(profile[39].chainageM).toBeLessThan(205);
    for (const pt of profile) {
      expect(pt.existingAHD - pt.proposedAHD).toBeCloseTo(pt.cutFillM, 2);
    }
  });
});

describe('Marching Squares elevation contours & Civil Exports (LandXML 1.2, DXF, GeoJSON, BOQ CSV)', () => {
  it('generates accurate Marching Squares contours matching grid elevations and tagging every 5th index contour', () => {
    const parcel = createRectPolygonFeatureCollection(
      -27.6764,
      152.7965,
      200,
      200,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const baseGrid = buildSyntheticAustralianDem(bbox, 48.0, 0, 20);

    // Construct an exact linear planar ramp from 45.0m (West) to 55.0m (East)
    const rampElevations = new Float32Array(baseGrid.rows * baseGrid.cols);
    for (let r = 0; r < baseGrid.rows; r += 1) {
      for (let c = 0; c < baseGrid.cols; c += 1) {
        const u = c / (baseGrid.cols - 1);
        rampElevations[r * baseGrid.cols + c] = 45.0 + u * 10.0;
      }
    }
    const rampGrid: ElevationGrid = {
      ...baseGrid,
      elevationsAHD: rampElevations,
      minAHD: 45.0,
      maxAHD: 55.0,
      meanAHD: 50.0,
    };

    const contours = generateElevationContours(rampGrid, 1.0);
    expect(contours.features.length).toBeGreaterThanOrEqual(9);

    const indexContours = contours.features.filter(
      (f) => f.properties?.isIndex === true,
    );
    expect(indexContours.length).toBeGreaterThanOrEqual(1);
    expect(
      indexContours.some((f) => f.properties?.elevationAHD === 50),
    ).toBe(true);

    // Every generated contour vertex must lie on its contour elevation within 0.05m
    for (const feat of contours.features) {
      const targetElev = Number(feat.properties?.elevationAHD);
      const coords = (feat.geometry as LineString).coordinates;
      expect(coords.length).toBeGreaterThanOrEqual(2);
      for (const [lng, lat] of coords) {
        const sampled = sampleElevationAtLngLat(rampGrid, lng, lat);
        expect(Math.abs(sampled - targetElev)).toBeLessThan(0.05);
      }
    }
  });

  it('exports valid LandXML 1.2 TIN Surface, MGA2020 Contours DXF, GeoJSON bundle, and RFC 4180 BOQ CSV', () => {
    const project = STARTER_DEALS[0].project; // NSW Zone 56
    const parcel = createRectPolygonFeatureCollection(
      project.location.lat,
      project.location.lng,
      200,
      160,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const grid = buildSyntheticAustralianDem(bbox, 64.2, 6.5, 16);
    const ew = computeGridEarthworks(grid, parcel, {
      targetFflAHD: 64.2,
      soilClass: 'clay',
    });
    const contours = generateElevationContours(grid, 0.5);

    // 1. LandXML 1.2 TIN Surface
    const landXml = buildLandXmlSurface(project, grid);
    expect(landXml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(landXml).toContain('xmlns="http://www.landxml.org/schema/LandXML-1.2"');
    expect(landXml).toContain('horizontalDatum="GDA2020" verticalDatum="AHD"');
    expect(landXml).toContain('surfType="TIN"');

    const parsedXml = new DOMParser().parseFromString(landXml, 'text/xml');
    expect(parsedXml.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(parsedXml.getElementsByTagName('P')).toHaveLength(
      grid.rows * grid.cols,
    );
    expect(parsedXml.getElementsByTagName('F')).toHaveLength(
      2 * (grid.rows - 1) * (grid.cols - 1),
    );

    // 2. Contours ASCII DXF in MGA2020 meters
    const dxf = buildEarthworksContoursDxf(contours, 56);
    expect(dxf).toContain('EPSG:7856');
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('CONTOUR_MINOR');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(() => buildEarthworksContoursDxf(contours, 42)).toThrow(RangeError);

    // 3. Combined GeoJSON bundle
    const geoJsonRaw = buildEarthworksGeoJson(
      contours,
      [
        {
          id: 'pad-1',
          name: 'Stage 1 Pad',
          targetFflAHD: 64.2,
          slopePct: 1.0,
          batterSlopeRatio: 3,
          boundaryGeoJson: parcel,
        },
      ],
      parcel,
    );
    const parsedGeo = JSON.parse(geoJsonRaw) as {
      type: string;
      features: Array<{ properties: { layer: string } }>;
    };
    expect(parsedGeo.type).toBe('FeatureCollection');
    expect(
      parsedGeo.features.some((f) => f.properties.layer === 'parcel-boundary'),
    ).toBe(true);
    expect(
      parsedGeo.features.some((f) => f.properties.layer === 'grading-pad'),
    ).toBe(true);
    expect(
      parsedGeo.features.some((f) => f.properties.layer === 'elevation-contour'),
    ).toBe(true);

    // 4. BOQ CSV
    const csv = buildEarthworksBoqCsv(project, ew);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('EW-01');
    expect(csv).toContain('RW-01');
    expect(csv).toContain('TOTAL');
    expect(csv).toContain(ew.totalPackageAud.toFixed(2));
  });
});
