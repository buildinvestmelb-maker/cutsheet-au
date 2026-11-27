import { fromArrayBuffer } from 'geotiff';
import {
  MGA2020_MAX_ZONE,
  MGA2020_MIN_ZONE,
  isWithinAustralianBounds,
  mga2020ToWgs84,
  wgs84ToMga2020,
} from '../geo/auGeoKernel';

export type DemSourceType = 'terrarium' | 'geotiff' | 'survey-csv' | 'synthetic';

export interface ElevationGrid {
  rows: number;
  cols: number;
  cellSizeM: number;
  boundsWgs84: [number, number, number, number];
  elevationsAHD: Float32Array;
  minAHD: number;
  maxAHD: number;
  meanAHD: number;
  source: DemSourceType;
  sourceLabel: string;
  mgaZone: number;
  mgaEpsg: string;
}

export interface GridCellMetrics {
  dxM: number;
  dyM: number;
  cellAreaSqm: number;
  spanEastM: number;
  spanNorthM: number;
}

export type SurveyCsvParseResult =
  | { ok: true; grid: ElevationGrid; pointCount: number }
  | { ok: false; error: string };

export interface TerrariumTileBitmap {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface TerrariumLoadOptions {
  signal?: AbortSignal;
  tileFetcher?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<TerrariumTileBitmap>;
}

const TERRARIUM_BASE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/**
 * Decodes an AWS Mapzen Terrarium PNG RGB pixel into metres AHD with ~3.9mm vertical precision.
 * Formula: elevation_m = (R * 256 + G + B / 256) - 32768
 */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new RangeError('Terrarium RGB channels must be finite numbers.');
  }
  const rc = Math.min(255, Math.max(0, r));
  const gc = Math.min(255, Math.max(0, g));
  const bc = Math.min(255, Math.max(0, b));
  return rc * 256 + gc + bc / 256 - 32768;
}

function assertValidBounds(
  boundsWgs84: [number, number, number, number],
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = boundsWgs84;
  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat) ||
    maxLng <= minLng ||
    maxLat <= minLat
  ) {
    throw new RangeError(
      `Invalid WGS84 bounds [${boundsWgs84.join(', ')}]: expected finite [minLng, minLat, maxLng, maxLat] with min < max.`,
    );
  }
  return [minLng, minLat, maxLng, maxLat];
}

function computeGridDimensions(
  boundsWgs84: [number, number, number, number],
  targetGridSize: number,
): {
  rows: number;
  cols: number;
  cellSizeM: number;
  mgaZone: number;
  mgaEpsg: string;
} {
  const [minLng, minLat, maxLng, maxLat] = assertValidBounds(boundsWgs84);
  const clampedTarget = Math.min(
    128,
    Math.max(4, Math.round(Number.isFinite(targetGridSize) ? targetGridSize : 36)),
  );

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const centerMga = wgs84ToMga2020(centerLng, centerLat);
  const sw = wgs84ToMga2020(minLng, minLat, centerMga.mgaZone);
  const se = wgs84ToMga2020(maxLng, minLat, centerMga.mgaZone);
  const nw = wgs84ToMga2020(minLng, maxLat, centerMga.mgaZone);

  const spanEastM = Math.max(
    1,
    Math.hypot(se.easting - sw.easting, se.northing - sw.northing),
  );
  const spanNorthM = Math.max(
    1,
    Math.hypot(nw.easting - sw.easting, nw.northing - sw.northing),
  );

  let rows: number;
  let cols: number;
  if (spanEastM >= spanNorthM) {
    cols = clampedTarget;
    rows = Math.max(4, Math.min(clampedTarget, Math.round((clampedTarget * spanNorthM) / spanEastM)));
  } else {
    rows = clampedTarget;
    cols = Math.max(4, Math.min(clampedTarget, Math.round((clampedTarget * spanEastM) / spanNorthM)));
  }

  const dxM = spanEastM / cols;
  const dyM = spanNorthM / rows;
  const cellSizeM = Number(Math.sqrt(dxM * dyM).toFixed(4));

  return {
    rows,
    cols,
    cellSizeM,
    mgaZone: centerMga.mgaZone,
    mgaEpsg: centerMga.mgaEpsg,
  };
}

/**
 * Returns exact metric cell width, height, and area (m²) for an ElevationGrid in its GDA2020 MGA zone.
 */
export function getGridCellMetrics(grid: ElevationGrid): GridCellMetrics {
  const [minLng, minLat, maxLng, maxLat] = grid.boundsWgs84;
  const sw = wgs84ToMga2020(minLng, minLat, grid.mgaZone);
  const se = wgs84ToMga2020(maxLng, minLat, grid.mgaZone);
  const nw = wgs84ToMga2020(minLng, maxLat, grid.mgaZone);
  const spanEastM = Math.max(
    1e-3,
    Math.hypot(se.easting - sw.easting, se.northing - sw.northing),
  );
  const spanNorthM = Math.max(
    1e-3,
    Math.hypot(nw.easting - sw.easting, nw.northing - sw.northing),
  );
  const dxM = spanEastM / Math.max(1, grid.cols);
  const dyM = spanNorthM / Math.max(1, grid.rows);
  return {
    dxM,
    dyM,
    cellAreaSqm: dxM * dyM,
    spanEastM,
    spanNorthM,
  };
}

/**
 * Maps a cell-centered (row, col) index (row 0 = North, col 0 = West) to WGS84 [lng, lat].
 */
export function gridCellToLngLat(
  grid: Pick<ElevationGrid, 'rows' | 'cols' | 'boundsWgs84'>,
  row: number,
  col: number,
): [number, number] {
  const [minLng, minLat, maxLng, maxLat] = grid.boundsWgs84;
  const u = (col + 0.5) / grid.cols;
  const v = (row + 0.5) / grid.rows;
  return [minLng + u * (maxLng - minLng), maxLat - v * (maxLat - minLat)];
}

function finalizeElevationGrid(
  rows: number,
  cols: number,
  cellSizeM: number,
  boundsWgs84: [number, number, number, number],
  elevationsAHD: Float32Array,
  source: DemSourceType,
  sourceLabel: string,
  mgaZone: number,
  mgaEpsg: string,
): ElevationGrid {
  let minAHD = Number.POSITIVE_INFINITY;
  let maxAHD = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < elevationsAHD.length; i += 1) {
    const val = elevationsAHD[i];
    if (!Number.isFinite(val)) continue;
    if (val < minAHD) minAHD = val;
    if (val > maxAHD) maxAHD = val;
    sum += val;
    validCount += 1;
  }

  const meanAHD = validCount > 0 ? sum / validCount : 0;
  if (validCount === 0) {
    minAHD = 0;
    maxAHD = 0;
  } else {
    // Replace any remaining non-finite entries with meanAHD
    for (let i = 0; i < elevationsAHD.length; i += 1) {
      if (!Number.isFinite(elevationsAHD[i])) {
        elevationsAHD[i] = meanAHD;
      }
    }
  }

  return {
    rows,
    cols,
    cellSizeM,
    boundsWgs84,
    elevationsAHD,
    minAHD: Number(minAHD.toFixed(3)),
    maxAHD: Number(maxAHD.toFixed(3)),
    meanAHD: Number(meanAHD.toFixed(3)),
    source,
    sourceLabel,
    mgaZone,
    mgaEpsg,
  };
}

/**
 * Bilinearly samples elevation (m AHD) at any WGS84 (lng, lat) coordinate on an ElevationGrid.
 */
export function sampleElevationAtLngLat(
  grid: ElevationGrid,
  lng: number,
  lat: number,
): number {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return grid.meanAHD;
  }
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

  const v00 = grid.elevationsAHD[r0 * grid.cols + c0];
  const v10 = grid.elevationsAHD[r0 * grid.cols + c1];
  const v01 = grid.elevationsAHD[r1 * grid.cols + c0];
  const v11 = grid.elevationsAHD[r1 * grid.cols + c1];

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

function lngToWebMercatorTileFloat(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToWebMercatorTileFloat(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

async function defaultFetchTerrariumTileBitmap(
  url: string,
  signal?: AbortSignal,
): Promise<TerrariumTileBitmap> {
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch Terrarium DEM tile (${url}): ${msg}`);
  }

  if (!response.ok) {
    throw new Error(
      `Terrarium DEM tile request failed (HTTP ${response.status} for ${url}).`,
    );
  }

  const blob = await response.blob();

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Unable to acquire 2D OffscreenCanvas context for DEM decoding.');
        }
        ctx.drawImage(bitmap, 0, 0);
        const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return {
          width: bitmap.width,
          height: bitmap.height,
          rgba: imgData.data,
        };
      }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Unable to acquire 2D Canvas context for DEM decoding.');
        }
        ctx.drawImage(bitmap, 0, 0);
        const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return {
          width: bitmap.width,
          height: bitmap.height,
          rgba: imgData.data,
        };
      }
    } finally {
      bitmap.close();
    }
  }

  // Fallback via HTMLImageElement + crossOrigin in browser environments without createImageBitmap
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () =>
          reject(new Error(`Unable to decode Terrarium PNG tile from ${url}.`));
        el.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 256;
      canvas.height = img.naturalHeight || 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to acquire 2D Canvas context for DEM decoding.');
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        width: canvas.width,
        height: canvas.height,
        rgba: imgData.data,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  throw new Error(
    'Canvas/ImageBitmap decoding is unavailable in this environment for Terrarium PNG tiles.',
  );
}

/**
 * Loads live AWS Mapzen Terrarium elevation PNG tiles covering boundsWgs84 (default zoom 14),
 * bilinearly samples elevations onto a uniform GDA2020 metric grid, and returns an ElevationGrid.
 */
export async function loadTerrariumDemForBounds(
  boundsWgs84: [number, number, number, number],
  targetGridSize = 36,
  signalOrOptions?: AbortSignal | TerrariumLoadOptions,
): Promise<ElevationGrid> {
  const bounds = assertValidBounds(boundsWgs84);
  const [minLng, minLat, maxLng, maxLat] = bounds;

  const opts: TerrariumLoadOptions =
    signalOrOptions && 'aborted' in signalOrOptions
      ? { signal: signalOrOptions }
      : (signalOrOptions ?? {});
  const fetchTile = opts.tileFetcher ?? defaultFetchTerrariumTileBitmap;

  // Choose zoom <= 14 such that total tile count stays bounded (<= 9 tiles)
  let zoom = 14;
  let minTx = 0;
  let maxTx = 0;
  let minTy = 0;
  let maxTy = 0;
  while (zoom >= 6) {
    minTx = Math.floor(lngToWebMercatorTileFloat(minLng, zoom));
    maxTx = Math.floor(lngToWebMercatorTileFloat(maxLng, zoom));
    minTy = Math.floor(latToWebMercatorTileFloat(maxLat, zoom));
    maxTy = Math.floor(latToWebMercatorTileFloat(minLat, zoom));
    if ((maxTx - minTx + 1) * (maxTy - minTy + 1) <= 9) {
      break;
    }
    zoom -= 1;
  }

  const tileCols = maxTx - minTx + 1;
  const tileRows = maxTy - minTy + 1;
  const tileMap = new Map<string, TerrariumTileBitmap>();

  const tileTasks: Promise<void>[] = [];
  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      const url = `${TERRARIUM_BASE_URL}/${zoom}/${tx}/${ty}.png`;
      tileTasks.push(
        fetchTile(url, opts.signal).then((bmp) => {
          tileMap.set(`${tx}:${ty}`, bmp);
        }),
      );
    }
  }
  await Promise.all(tileTasks);

  const firstTile = tileMap.values().next().value;
  const tilePx = firstTile?.width ?? 256;
  const compositeW = tileCols * tilePx;
  const compositeH = tileRows * tilePx;

  const sampleCompositeElevation = (px: number, py: number): number => {
    const cx = Math.min(compositeW - 1, Math.max(0, Math.round(px)));
    const cy = Math.min(compositeH - 1, Math.max(0, Math.round(py)));
    const tx = minTx + Math.floor(cx / tilePx);
    const ty = minTy + Math.floor(cy / tilePx);
    const localX = cx % tilePx;
    const localY = cy % tilePx;
    const tile = tileMap.get(`${tx}:${ty}`);
    if (!tile) return 0;
    const idx = (localY * tile.width + localX) * 4;
    return decodeTerrariumPixel(
      tile.rgba[idx],
      tile.rgba[idx + 1],
      tile.rgba[idx + 2],
    );
  };

  const { rows, cols, cellSizeM, mgaZone, mgaEpsg } = computeGridDimensions(
    bounds,
    targetGridSize,
  );
  const elevations = new Float32Array(rows * cols);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const [lng, lat] = gridCellToLngLat(
        { rows, cols, boundsWgs84: bounds },
        r,
        c,
      );
      const gx = (lngToWebMercatorTileFloat(lng, zoom) - minTx) * tilePx - 0.5;
      const gy = (latToWebMercatorTileFloat(lat, zoom) - minTy) * tilePx - 0.5;

      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = Math.min(1, Math.max(0, gx - x0));
      const fy = Math.min(1, Math.max(0, gy - y0));

      const e00 = sampleCompositeElevation(x0, y0);
      const e10 = sampleCompositeElevation(x0 + 1, y0);
      const e01 = sampleCompositeElevation(x0, y0 + 1);
      const e11 = sampleCompositeElevation(x0 + 1, y0 + 1);

      const top = e00 + (e10 - e00) * fx;
      const bottom = e01 + (e11 - e01) * fx;
      elevations[r * cols + c] = top + (bottom - top) * fy;
    }
  }

  return finalizeElevationGrid(
    rows,
    cols,
    cellSizeM,
    bounds,
    elevations,
    'terrarium',
    `AWS Terrarium DEM (z${zoom})`,
    mgaZone,
    mgaEpsg,
  );
}

function isSentinelNoData(value: number, noData: number | null): boolean {
  if (!Number.isFinite(value)) return true;
  if (noData !== null && Number.isFinite(noData) && Math.abs(value - noData) < 1e-4) {
    return true;
  }
  if (value <= -9000 || value >= 90000) return true;
  return false;
}

function resolveGeoTiffMgaZone(
  geoKeys: Partial<Record<string, unknown>> | null,
  fallbackZone: number,
): number {
  const projectedKey = geoKeys?.ProjectedCSTypeGeoKey;
  if (typeof projectedKey === 'number' && Number.isInteger(projectedKey)) {
    // GDA2020 MGA2020 EPSG:7849..7856
    if (projectedKey >= 7849 && projectedKey <= 7856) {
      return projectedKey - 7800;
    }
    // GDA94 MGA94 EPSG:28349..28356
    if (projectedKey >= 28349 && projectedKey <= 28356) {
      return projectedKey - 28300;
    }
  }
  return fallbackZone;
}

/**
 * Parses a binary GeoTIFF DEM (Cloud-Optimized or standard single-band elevation TIFF)
 * using `geotiff.fromArrayBuffer`, filters NoData sentinels, and resamples onto an ElevationGrid.
 */
export async function parseGeoTiffDem(
  arrayBuffer: ArrayBuffer,
  fallbackBoundsWgs84: [number, number, number, number],
  targetGridSize = 40,
): Promise<ElevationGrid> {
  const fallbackBounds = assertValidBounds(fallbackBoundsWgs84);
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 8) {
    throw new Error('GeoTIFF input buffer is empty or truncated.');
  }

  let tiff: Awaited<ReturnType<typeof fromArrayBuffer>>;
  try {
    tiff = await fromArrayBuffer(arrayBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid GeoTIFF file: ${msg}`);
  }

  const image = await tiff.getImage();
  const srcWidth = image.getWidth();
  const srcHeight = image.getHeight();
  if (srcWidth < 2 || srcHeight < 2) {
    throw new Error(
      `GeoTIFF raster dimensions (${srcWidth}×${srcHeight}) are too small for DEM gridding.`,
    );
  }

  const noData = image.getGDALNoData();
  const rasters = await image.readRasters({ samples: [0] });
  const band0 = rasters[0];
  if (!band0 || typeof band0 === 'number' || band0.length < srcWidth * srcHeight) {
    throw new Error('GeoTIFF band 0 contains no readable elevation raster data.');
  }

  let resolvedBounds = fallbackBounds;
  try {
    const rawBbox = image.getBoundingBox();
    if (
      Array.isArray(rawBbox) &&
      rawBbox.length >= 4 &&
      rawBbox.every((v) => Number.isFinite(v)) &&
      rawBbox[2] > rawBbox[0] &&
      rawBbox[3] > rawBbox[1]
    ) {
      const [x0, y0, x1, y1] = rawBbox;
      if (isWithinAustralianBounds(x0, y0) && isWithinAustralianBounds(x1, y1)) {
        resolvedBounds = [x0, y0, x1, y1];
      } else if (Math.abs(x0) > 10000 || Math.abs(y0) > 10000) {
        const fallbackCenterLng = (fallbackBounds[0] + fallbackBounds[2]) / 2;
        const fallbackZone = wgs84ToMga2020(
          fallbackCenterLng,
          (fallbackBounds[1] + fallbackBounds[3]) / 2,
        ).mgaZone;
        const zone = resolveGeoTiffMgaZone(
          image.getGeoKeys() as Partial<Record<string, unknown>> | null,
          fallbackZone,
        );
        const sw = mga2020ToWgs84(x0, y0, zone);
        const ne = mga2020ToWgs84(x1, y1, zone);
        if (
          isWithinAustralianBounds(sw.lng, sw.lat) &&
          isWithinAustralianBounds(ne.lng, ne.lat) &&
          ne.lng > sw.lng &&
          ne.lat > sw.lat
        ) {
          resolvedBounds = [sw.lng, sw.lat, ne.lng, ne.lat];
        }
      }
    }
  } catch {
    // Non-georeferenced TIFF — fall back cleanly to parcel boundsWgs84
  }

  // Compute global valid mean for filling isolated NoData pixels
  let validSum = 0;
  let validCount = 0;
  for (let i = 0; i < band0.length; i += 1) {
    const val = Number(band0[i]);
    if (!isSentinelNoData(val, noData)) {
      validSum += val;
      validCount += 1;
    }
  }
  if (validCount === 0) {
    throw new Error('GeoTIFF contains only NoData or non-finite elevation values.');
  }
  const globalMean = validSum / validCount;

  const { rows, cols, cellSizeM, mgaZone, mgaEpsg } = computeGridDimensions(
    resolvedBounds,
    targetGridSize,
  );
  const elevations = new Float32Array(rows * cols);

  const readSrc = (sx: number, sy: number): number | null => {
    const cx = Math.min(srcWidth - 1, Math.max(0, sx));
    const cy = Math.min(srcHeight - 1, Math.max(0, sy));
    const v = Number(band0[cy * srcWidth + cx]);
    return isSentinelNoData(v, noData) ? null : v;
  };

  for (let r = 0; r < rows; r += 1) {
    const syF = ((r + 0.5) / rows) * srcHeight - 0.5;
    const y0 = Math.floor(syF);
    const y1 = Math.min(srcHeight - 1, Math.max(0, y0 + 1));
    const fy = Math.min(1, Math.max(0, syF - y0));

    for (let c = 0; c < cols; c += 1) {
      const sxF = ((c + 0.5) / cols) * srcWidth - 0.5;
      const x0 = Math.floor(sxF);
      const x1 = Math.min(srcWidth - 1, Math.max(0, x0 + 1));
      const fx = Math.min(1, Math.max(0, sxF - x0));

      const s00 = readSrc(x0, y0);
      const s10 = readSrc(x1, y0);
      const s01 = readSrc(x0, y1);
      const s11 = readSrc(x1, y1);

      if (s00 !== null && s10 !== null && s01 !== null && s11 !== null) {
        const top = s00 + (s10 - s00) * fx;
        const bottom = s01 + (s11 - s01) * fx;
        elevations[r * cols + c] = top + (bottom - top) * fy;
      } else {
        const present = [s00, s10, s01, s11].filter(
          (v): v is number => v !== null,
        );
        elevations[r * cols + c] =
          present.length > 0
            ? present.reduce((a, b) => a + b, 0) / present.length
            : globalMean;
      }
    }
  }

  return finalizeElevationGrid(
    rows,
    cols,
    cellSizeM,
    resolvedBounds,
    elevations,
    'geotiff',
    `GeoTIFF DEM (${srcWidth}×${srcHeight} px)`,
    mgaZone,
    mgaEpsg,
  );
}

/**
 * Parses a surveyor CSV / XYZ elevation file in either MGA2020 (Easting, Northing, RL)
 * or WGS84 (Lng, Lat, Elevation) and interpolates onto a uniform ElevationGrid via
 * metric Inverse Distance Weighting (IDW, power = 2).
 */
export function parseSurveyCsvDem(
  rawCsv: string,
  mgaZone: number,
  fallbackBoundsWgs84?: [number, number, number, number],
  targetGridSize = 36,
): SurveyCsvParseResult {
  if (typeof rawCsv !== 'string' || rawCsv.trim().length === 0) {
    return { ok: false, error: 'Survey CSV input is empty.' };
  }
  if (
    !Number.isInteger(mgaZone) ||
    mgaZone < MGA2020_MIN_ZONE ||
    mgaZone > MGA2020_MAX_ZONE
  ) {
    return {
      ok: false,
      error: `Invalid MGA2020 zone "${String(mgaZone)}". Expected an integer between ${MGA2020_MIN_ZONE} and ${MGA2020_MAX_ZONE}.`,
    };
  }

  const lines = rawCsv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length < 3) {
    return {
      ok: false,
      error: 'Survey CSV requires at least 3 elevation points (Easting,Northing,RL or Lng,Lat,Elevation).',
    };
  }

  const splitRow = (line: string): string[] =>
    line.includes(',')
      ? line.split(',').map((s) => s.trim())
      : line.split(/[\t;\s]+/).map((s) => s.trim());

  const firstTokens = splitRow(lines[0]);
  const hasHeader = firstTokens.some((tok) => /[a-zA-Z]/.test(tok));

  let xCol = 0;
  let yCol = 1;
  let zCol = 2;
  let forceLatFirst = false;

  if (hasHeader) {
    const lower = firstTokens.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const findCol = (patterns: RegExp[]): number =>
      lower.findIndex((h) => patterns.some((p) => p.test(h)));

    const eIdx = findCol([/^east/, /^x$/, /^lng$/, /^lon/]);
    const nIdx = findCol([/^north/, /^y$/, /^lat/]);
    const zIdx = findCol([/^rl$/, /^elev/, /^ahd$/, /^z$/, /^height/]);

    if (eIdx >= 0 && nIdx >= 0 && zIdx >= 0) {
      xCol = eIdx;
      yCol = nIdx;
      zCol = zIdx;
    } else if (
      lower.length >= 3 &&
      /^lat/.test(lower[0]) &&
      /^lon|^lng/.test(lower[1])
    ) {
      forceLatFirst = true;
    }
  }

  const rawPoints: Array<{ x: number; y: number; z: number }> = [];
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i += 1) {
    const tokens = splitRow(lines[i]);
    const maxReq = Math.max(xCol, yCol, zCol);
    if (tokens.length <= maxReq) continue;

    const rawX = Number(tokens[forceLatFirst ? 1 : xCol]);
    const rawY = Number(tokens[forceLatFirst ? 0 : yCol]);
    const rawZ = Number(tokens[zCol]);

    if (
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      !Number.isFinite(rawZ)
    ) {
      continue;
    }
    if (rawZ < -100 || rawZ > 3000) {
      return {
        ok: false,
        error: `Survey elevation "${rawZ}" m AHD on line ${i + 1} is outside realistic Australian AHD range (-100 to 3000 m).`,
      };
    }
    rawPoints.push({ x: rawX, y: rawY, z: rawZ });
  }

  if (rawPoints.length < 3) {
    return {
      ok: false,
      error: `Parsed only ${rawPoints.length} valid numeric survey points; at least 3 points are required.`,
    };
  }

  const isProjectedMga = rawPoints.some(
    (p) => Math.abs(p.x) > 10000 || Math.abs(p.y) > 10000,
  );

  const points: Array<{
    lng: number;
    lat: number;
    easting: number;
    northing: number;
    z: number;
  }> = [];

  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const pt of rawPoints) {
    let lng: number;
    let lat: number;
    let easting: number;
    let northing: number;

    if (isProjectedMga) {
      try {
        const wgs = mga2020ToWgs84(pt.x, pt.y, mgaZone);
        lng = wgs.lng;
        lat = wgs.lat;
        easting = pt.x;
        northing = pt.y;
      } catch (err) {
        return {
          ok: false,
          error: `Failed to convert MGA2020 point (${pt.x}, ${pt.y}) in Zone ${mgaZone}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      lng = pt.x;
      lat = pt.y;
      if (!isWithinAustralianBounds(lng, lat)) {
        return {
          ok: false,
          error: `Survey point [${lng}, ${lat}] lies outside Australian coordinate bounds (lng 110..160, lat -45..-8).`,
        };
      }
      const mga = wgs84ToMga2020(lng, lat, mgaZone);
      easting = mga.easting;
      northing = mga.northing;
    }

    if (!isWithinAustralianBounds(lng, lat)) {
      return {
        ok: false,
        error: `Converted survey point [${lng.toFixed(5)}, ${lat.toFixed(5)}] lies outside Australia. Verify MGA2020 Zone ${mgaZone}.`,
      };
    }

    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
    points.push({ lng, lat, easting, northing, z: pt.z });
  }

  let bounds: [number, number, number, number];
  if (fallbackBoundsWgs84) {
    bounds = assertValidBounds(fallbackBoundsWgs84);
  } else {
    const padLng = Math.max((maxLng - minLng) * 0.02, 0.00005);
    const padLat = Math.max((maxLat - minLat) * 0.02, 0.00005);
    bounds = [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
  }

  const { rows, cols, cellSizeM, mgaZone: resolvedZone, mgaEpsg } =
    computeGridDimensions(bounds, targetGridSize);

  // Re-project points into resolvedZone if fallbackBoundsWgs84 straddled another zone
  const interpPoints =
    resolvedZone === mgaZone
      ? points
      : points.map((p) => {
          const m = wgs84ToMga2020(p.lng, p.lat, resolvedZone);
          return { ...p, easting: m.easting, northing: m.northing };
        });

  const elevations = new Float32Array(rows * cols);

  // Inverse Distance Weighting (IDW, power = 2) in exact metric MGA2020 plane
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const [lng, lat] = gridCellToLngLat(
        { rows, cols, boundsWgs84: bounds },
        r,
        c,
      );
      const cellMga = wgs84ToMga2020(lng, lat, resolvedZone);

      let weightedSum = 0;
      let weightTotal = 0;
      let exactHit: number | null = null;

      for (let i = 0; i < interpPoints.length; i += 1) {
        const pt = interpPoints[i];
        const dx = cellMga.easting - pt.easting;
        const dy = cellMga.northing - pt.northing;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1e-4) {
          exactHit = pt.z;
          break;
        }
        const weight = 1 / distSq; // IDW power = 2
        weightedSum += weight * pt.z;
        weightTotal += weight;
      }

      elevations[r * cols + c] =
        exactHit !== null
          ? exactHit
          : weightTotal > 0
            ? weightedSum / weightTotal
            : interpPoints[0].z;
    }
  }

  const crsTag = isProjectedMga ? `MGA2020 Z${mgaZone}` : 'WGS84';
  const grid = finalizeElevationGrid(
    rows,
    cols,
    cellSizeM,
    bounds,
    elevations,
    'survey-csv',
    `Survey CSV (${points.length} pts, ${crsTag})`,
    resolvedZone,
    mgaEpsg,
  );

  return { ok: true, grid, pointCount: points.length };
}

/**
 * Generates a deterministic local offline terrain surface anchored to site baseElevationAHD.
 * Always visibly tagged with source='synthetic' and sourceLabel='Local Offline Surface'.
 */
export function buildSyntheticAustralianDem(
  boundsWgs84: [number, number, number, number],
  baseElevationAHD: number,
  reliefM = 6.5,
  gridSize = 36,
): ElevationGrid {
  const bounds = assertValidBounds(boundsWgs84);
  const safeBase = Number.isFinite(baseElevationAHD) ? baseElevationAHD : 45.0;
  const safeRelief = Number.isFinite(reliefM) ? Math.max(0, reliefM) : 6.5;

  const { rows, cols, cellSizeM, mgaZone, mgaEpsg } = computeGridDimensions(
    bounds,
    gridSize,
  );
  const elevations = new Float32Array(rows * cols);

  // Deterministic coordinate-derived phase so every Australian parcel has stable topography
  const seed = Math.abs(bounds[0] * 31.7 + bounds[1] * 47.3);
  const phaseX = (seed % 1) * Math.PI * 2;
  const phaseY = ((seed * 1.618) % 1) * Math.PI * 2;

  for (let r = 0; r < rows; r += 1) {
    const v = rows > 1 ? r / (rows - 1) : 0.5; // 0 = North, 1 = South
    for (let c = 0; c < cols; c += 1) {
      const u = cols > 1 ? c / (cols - 1) : 0.5; // 0 = West, 1 = East
      if (safeRelief === 0) {
        elevations[r * cols + c] = safeBase;
      } else {
        // Gentle regional slope + subtle ridge/swale harmonics centered around safeBase
        const slope = (u - 0.5) * 0.65 + (0.5 - v) * 0.45;
        const undulation =
          0.22 * Math.sin(u * Math.PI * 2.1 + phaseX) * Math.cos(v * Math.PI * 1.7 + phaseY) +
          0.12 * Math.sin((u + v) * Math.PI * 3.0);
        elevations[r * cols + c] = safeBase + (slope + undulation) * safeRelief;
      }
    }
  }

  return finalizeElevationGrid(
    rows,
    cols,
    cellSizeM,
    bounds,
    elevations,
    'synthetic',
    'Local Offline Surface',
    mgaZone,
    mgaEpsg,
  );
}
