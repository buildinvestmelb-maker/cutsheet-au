import { writeArrayBuffer } from 'geotiff';
import { describe, expect, it, vi } from 'vitest';
import {
  computePolygonMetrics,
  createRectPolygonFeatureCollection,
  wgs84ToMga2020,
} from '../geo/auGeoKernel';
import {
  buildSyntheticAustralianDem,
  decodeTerrariumPixel,
  gridCellToLngLat,
  loadTerrariumDemForBounds,
  parseGeoTiffDem,
  parseSurveyCsvDem,
  sampleElevationAtLngLat,
  type TerrariumTileBitmap,
} from './demLoader';

function encodeTerrariumElevation(elevM: number): [number, number, number] {
  const shifted = elevM + 32768;
  const r = Math.floor(shifted / 256);
  const rem = shifted - r * 256;
  const g = Math.floor(rem);
  const b = Math.round((rem - g) * 256);
  return [
    Math.min(255, Math.max(0, r)),
    Math.min(255, Math.max(0, g)),
    Math.min(255, Math.max(0, b)),
  ];
}

describe('Terrarium RGB decoding and tile sampling (demLoader)', () => {
  it('decodes Terrarium RGB pixels to ~3.9mm vertical accuracy across sea level, alpine, and below-sea-level AHD', () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0); // 0.000m sea level
    expect(decodeTerrariumPixel(128, 64, 64)).toBeCloseTo(64.25, 3);
    expect(decodeTerrariumPixel(136, 180, 0)).toBe(2228); // Mt Kosciuszko
    expect(decodeTerrariumPixel(127, 241, 0)).toBe(-15); // Lake Eyre basin
    expect(decodeTerrariumPixel(128, 12, 128)).toBeCloseTo(12.5, 3);

    expect(() => decodeTerrariumPixel(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() =>
      decodeTerrariumPixel(128, Number.POSITIVE_INFINITY, 0),
    ).toThrow(RangeError);
  });

  it('loads zoom-14 Terrarium tiles for Australian parcel bounds and bilinearly decodes elevations', async () => {
    const parcel = createRectPolygonFeatureCollection(
      -33.9249,
      150.7932,
      200,
      200,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const requestedUrls: string[] = [];

    const tileFetcher = vi.fn(
      async (url: string): Promise<TerrariumTileBitmap> => {
        requestedUrls.push(url);
        const width = 256;
        const height = 256;
        const rgba = new Uint8ClampedArray(width * height * 4);
        const [r, g, b] = encodeTerrariumElevation(64.5);
        for (let i = 0; i < width * height; i += 1) {
          rgba[i * 4] = r;
          rgba[i * 4 + 1] = g;
          rgba[i * 4 + 2] = b;
          rgba[i * 4 + 3] = 255;
        }
        return { width, height, rgba };
      },
    );

    const grid = await loadTerrariumDemForBounds(bbox, 16, { tileFetcher });
    expect(requestedUrls.length).toBeGreaterThanOrEqual(1);
    expect(requestedUrls[0]).toMatch(
      /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/14\/\d+\/\d+\.png$/,
    );
    expect(grid.source).toBe('terrarium');
    expect(grid.mgaZone).toBe(56);
    expect(grid.mgaEpsg).toBe('EPSG:7856');
    expect(grid.minAHD).toBeCloseTo(64.5, 2);
    expect(grid.maxAHD).toBeCloseTo(64.5, 2);
    expect(grid.meanAHD).toBeCloseTo(64.5, 2);
    expect(grid.cellSizeM).toBeGreaterThan(8);
    expect(grid.cellSizeM).toBeLessThan(16);

    // Propagates explicit error when tile fetch fails
    await expect(
      loadTerrariumDemForBounds(bbox, 16, {
        tileFetcher: async () => {
          throw new Error('Offline tile fetch blocked');
        },
      }),
    ).rejects.toThrow(/Offline tile fetch blocked/);
  });
});

describe('GeoTIFF DEM parsing, Survey CSV IDW gridding, and Synthetic offline DEM', () => {
  it('parses a real Float32 binary GeoTIFF buffer, filters NoData sentinels, and resamples cleanly', async () => {
    const parcel = createRectPolygonFeatureCollection(
      -37.5418,
      144.9612,
      160,
      160,
    );
    const { bbox } = computePolygonMetrics(parcel);

    // 4x4 Float32 elevation grid (210m..219m AHD) with an embedded -9999 NoData cell
    const rasterValues = new Float32Array([
      210, 212, 214, 216,
      211, 213, 215, 217,
      212, 214, -9999, 218,
      213, 215, 217, 219,
    ]);
    const tiffBuffer = await writeArrayBuffer(rasterValues, {
      width: 4,
      height: 4,
      SampleFormat: [3],
      BitsPerSample: [32],
      GDAL_NODATA: '-9999',
    });

    const grid = await parseGeoTiffDem(tiffBuffer, bbox, 16);
    expect(grid.source).toBe('geotiff');
    expect(grid.sourceLabel).toContain('4×4');
    expect(grid.mgaZone).toBe(55);
    expect(grid.mgaEpsg).toBe('EPSG:7855');
    // NoData (-9999) must be filtered out completely
    expect(grid.minAHD).toBeGreaterThanOrEqual(210);
    expect(grid.maxAHD).toBeLessThanOrEqual(219);
    expect(grid.meanAHD).toBeGreaterThan(213);
    expect(grid.meanAHD).toBeLessThan(216);

    // Rejects corrupt / empty buffers
    await expect(parseGeoTiffDem(new ArrayBuffer(2), bbox)).rejects.toThrow(
      /empty or truncated/i,
    );
  });

  it('parses both MGA2020 Easting/Northing/RL and WGS84 Lng/Lat/Elevation survey CSVs via IDW interpolation', () => {
    // 1. MGA2020 Easting,Northing,RL in Zone 56 (Sydney)
    const center = wgs84ToMga2020(151.2093, -33.8688, 56);
    const mgaCsv = [
      'Easting,Northing,RL',
      `${(center.easting - 60).toFixed(2)},${(center.northing - 50).toFixed(2)},40.0`,
      `${(center.easting + 60).toFixed(2)},${(center.northing - 50).toFixed(2)},44.0`,
      `${(center.easting + 60).toFixed(2)},${(center.northing + 50).toFixed(2)},48.0`,
      `${(center.easting - 60).toFixed(2)},${(center.northing + 50).toFixed(2)},44.0`,
      `${center.easting.toFixed(2)},${center.northing.toFixed(2)},44.0`,
    ].join('\n');

    const mgaParsed = parseSurveyCsvDem(mgaCsv, 56, undefined, 20);
    expect(mgaParsed.ok).toBe(true);
    if (mgaParsed.ok) {
      expect(mgaParsed.pointCount).toBe(5);
      expect(mgaParsed.grid.source).toBe('survey-csv');
      expect(mgaParsed.grid.mgaZone).toBe(56);
      expect(mgaParsed.grid.minAHD).toBeGreaterThanOrEqual(39.9);
      expect(mgaParsed.grid.maxAHD).toBeLessThanOrEqual(48.1);
      // Sample at center control point recovers ~44.0m AHD
      const centerSample = sampleElevationAtLngLat(
        mgaParsed.grid,
        151.2093,
        -33.8688,
      );
      expect(centerSample).toBeCloseTo(44.0, 0);
    }

    // 2. WGS84 Lng,Lat,Elevation in Perth (Zone 50)
    const wgsCsv = [
      'Lng,Lat,Elevation',
      '115.8595,-31.9515,22.0',
      '115.8615,-31.9515,24.0',
      '115.8615,-31.9495,28.0',
      '115.8595,-31.9495,26.0',
    ].join('\n');

    const wgsParsed = parseSurveyCsvDem(wgsCsv, 50, undefined, 16);
    expect(wgsParsed.ok).toBe(true);
    if (wgsParsed.ok) {
      expect(wgsParsed.pointCount).toBe(4);
      expect(wgsParsed.grid.mgaZone).toBe(50);
      expect(wgsParsed.grid.mgaEpsg).toBe('EPSG:7850');
      const midSample = sampleElevationAtLngLat(
        wgsParsed.grid,
        115.8605,
        -31.9505,
      );
      expect(midSample).toBeCloseTo(25.0, 0);
    }

    // Validation errors
    expect(parseSurveyCsvDem('', 56).ok).toBe(false);
    expect(parseSurveyCsvDem('151.2,-33.8,50\n151.21,-33.8,52', 56).ok).toBe(
      false,
    );
    expect(parseSurveyCsvDem(wgsCsv, 42).ok).toBe(false);
    expect(
      parseSurveyCsvDem(
        '-74.01,40.71,10\n-74.00,40.71,12\n-74.00,40.72,14',
        56,
      ).ok,
    ).toBe(false);
  });

  it('builds visibly labeled Local Offline Surface synthetic DEM and interpolates smoothly via sampleElevationAtLngLat', () => {
    const parcel = createRectPolygonFeatureCollection(
      -42.8935,
      147.4342,
      180,
      120,
    );
    const { bbox } = computePolygonMetrics(parcel);
    const synthetic = buildSyntheticAustralianDem(bbox, 72.5, 8.0, 24);

    expect(synthetic.source).toBe('synthetic');
    expect(synthetic.sourceLabel).toBe('Local Offline Surface');
    expect(synthetic.mgaZone).toBe(55);
    expect(synthetic.maxAHD).toBeGreaterThan(synthetic.minAHD);

    // Exact match at cell center & safe fallback on NaN coords
    const [cellLng, cellLat] = gridCellToLngLat(synthetic, 5, 7);
    const expectedElev = synthetic.elevationsAHD[5 * synthetic.cols + 7];
    expect(sampleElevationAtLngLat(synthetic, cellLng, cellLat)).toBeCloseTo(
      expectedElev,
      4,
    );
    expect(sampleElevationAtLngLat(synthetic, Number.NaN, -42.89)).toBe(
      synthetic.meanAHD,
    );
  });
});
