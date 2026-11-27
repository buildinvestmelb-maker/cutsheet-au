import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  Geometry,
  Polygon,
  Position,
} from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';
import proj4 from 'proj4';
import {
  getMga2020FromLng,
  isForbiddenObjectKey,
  type AustralianState,
} from '../../bridge/types';

export const MGA2020_MIN_ZONE = 49;
export const MGA2020_MAX_ZONE = 56;

export const AU_COORDINATE_BOUNDS = {
  minLng: 110,
  maxLng: 160,
  minLat: -45,
  maxLat: -8,
} as const;

export const OPENFREEMAP_DARK_STYLE_URL =
  'https://tiles.openfreemap.org/styles/dark';

export const ESRI_WORLD_IMAGERY_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const PHOTON_AU_BBOX = '112,-44,154,-10';

export interface Mga2020Coordinate {
  easting: number;
  northing: number;
  mgaZone: number;
  mgaEpsg: string;
}

export interface Wgs84Coordinate {
  lng: number;
  lat: number;
}

export interface PolygonMetrics {
  grossAreaSqm: number;
  grossAreaHa: number;
  perimeterM: number;
  frontageM: number;
  centroid: { lat: number; lng: number };
  bbox: [number, number, number, number];
  vertexCount: number;
}

export type ParcelParseResult =
  | { ok: true; boundary: FeatureCollection; metrics: PolygonMetrics }
  | { ok: false; error: string };

export interface AuGeocodedAddress {
  id: string;
  label: string;
  address: string;
  suburb: string;
  lga: string;
  state: AustralianState;
  postcode: string;
  lat: number;
  lng: number;
  mgaZone: number;
  mgaEpsg: string;
}

export type MapBasemapMode = 'dark-vector' | 'satellite' | 'offline-grid';

export interface AuPublicCadastreLayerSpec {
  id: string;
  state: AustralianState;
  name: string;
  authority: string;
  tileUrl: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
  defaultOpacity: number;
}

/**
 * Returns the exact PROJ4 definition string for GDA2020 / MGA2020 Zones 49–56.
 */
export function getMga2020Proj4Def(zone: number): string {
  assertValidMgaZone(zone);
  return `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;
}

function assertValidMgaZone(zone: number): void {
  if (
    !Number.isInteger(zone) ||
    zone < MGA2020_MIN_ZONE ||
    zone > MGA2020_MAX_ZONE
  ) {
    throw new RangeError(
      `Invalid MGA2020 zone "${String(zone)}". Expected an integer between ${MGA2020_MIN_ZONE} and ${MGA2020_MAX_ZONE}.`,
    );
  }
}

// Register GDA2020 / MGA2020 Zones 49–56 (EPSG:7849–EPSG:7856) with proj4 on module load.
for (let z = MGA2020_MIN_ZONE; z <= MGA2020_MAX_ZONE; z += 1) {
  proj4.defs(`EPSG:${7800 + z}`, getMga2020Proj4Def(z));
}

export function isWithinAustralianBounds(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= AU_COORDINATE_BOUNDS.minLng &&
    lng <= AU_COORDINATE_BOUNDS.maxLng &&
    lat >= AU_COORDINATE_BOUNDS.minLat &&
    lat <= AU_COORDINATE_BOUNDS.maxLat
  );
}

/**
 * Projects WGS84 / GDA2020 geographic coordinates (lng, lat) to GDA2020 / MGA2020
 * Easting and Northing meters using proj4 (Zones 49–56 / EPSG:7849–EPSG:7856).
 */
export function wgs84ToMga2020(
  lng: number,
  lat: number,
  forcedZone?: number,
): Mga2020Coordinate {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new RangeError(
      'WGS84 coordinates must be finite numbers (lng, lat).',
    );
  }
  if (lng < -180 || lng > 180 || lat <= -90 || lat >= 90) {
    throw new RangeError(
      `WGS84 coordinates out of range: lng=${lng}, lat=${lat}.`,
    );
  }

  let mgaZone: number;
  let mgaEpsg: string;
  if (forcedZone !== undefined) {
    assertValidMgaZone(forcedZone);
    mgaZone = forcedZone;
    mgaEpsg = `EPSG:${7800 + mgaZone}`;
  } else {
    const resolved = getMga2020FromLng(lng);
    mgaZone = resolved.mgaZone;
    mgaEpsg = resolved.mgaEpsg;
  }

  const [easting, northing] = proj4('EPSG:4326', mgaEpsg, [lng, lat]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    throw new RangeError(
      `Failed to project (${lng}, ${lat}) into ${mgaEpsg}.`,
    );
  }

  return {
    easting,
    northing,
    mgaZone,
    mgaEpsg,
  };
}

/**
 * Inverse-projects GDA2020 / MGA2020 Easting and Northing meters in the specified
 * zone (49–56) back to WGS84 / GDA2020 geographic coordinates (lng, lat).
 */
export function mga2020ToWgs84(
  easting: number,
  northing: number,
  mgaZone: number,
): Wgs84Coordinate {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    throw new RangeError(
      'MGA2020 easting and northing must be finite numbers.',
    );
  }
  assertValidMgaZone(mgaZone);

  const mgaEpsg = `EPSG:${7800 + mgaZone}`;
  const [lng, lat] = proj4(mgaEpsg, 'EPSG:4326', [easting, northing]);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new RangeError(
      `Failed to inverse-project (${easting}, ${northing}) from ${mgaEpsg}.`,
    );
  }

  return { lng, lat };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasForbiddenKeysDeep(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasForbiddenKeysDeep(item, seen)) return true;
    }
    return false;
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (isForbiddenObjectKey(key)) return true;
    if (hasForbiddenKeysDeep((value as Record<string, unknown>)[key], seen)) {
      return true;
    }
  }
  return false;
}

function sanitizeRing(
  rawRing: unknown,
  enforceWgs84Range = true,
): Position[] | null {
  if (!Array.isArray(rawRing) || rawRing.length < 3) return null;

  const cleaned: Position[] = [];
  for (const rawCoord of rawRing) {
    if (!Array.isArray(rawCoord) || rawCoord.length < 2) return null;
    const lng = rawCoord[0];
    const lat = rawCoord[1];
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      return null;
    }
    if (
      enforceWgs84Range &&
      (lng < -180 || lng > 180 || lat < -90 || lat > 90)
    ) {
      return null;
    }

    const prev = cleaned[cleaned.length - 1];
    if (
      prev &&
      Math.abs(prev[0] - lng) <= 1e-11 &&
      Math.abs(prev[1] - lat) <= 1e-11
    ) {
      continue;
    }
    cleaned.push([lng, lat]);
  }

  if (cleaned.length < 3) return null;

  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  const isAlreadyClosed =
    Math.abs(first[0] - last[0]) <= 1e-11 &&
    Math.abs(first[1] - last[1]) <= 1e-11;

  if (isAlreadyClosed) {
    // Ensure exact closing match and at least 3 distinct points
    cleaned[cleaned.length - 1] = [first[0], first[1]];
    if (cleaned.length < 4) return null;
  } else {
    cleaned.push([first[0], first[1]]);
  }

  return cleaned;
}

function normalizePolygonCoordinates(
  rawRings: unknown,
  enforceWgs84Range = true,
): Position[][] | null {
  if (!Array.isArray(rawRings) || rawRings.length === 0) return null;
  const outer = sanitizeRing(rawRings[0], enforceWgs84Range);
  if (!outer) return null;

  const rings: Position[][] = [outer];
  for (let i = 1; i < rawRings.length; i += 1) {
    const hole = sanitizeRing(rawRings[i], enforceWgs84Range);
    if (hole) {
      rings.push(hole);
    }
  }
  return rings;
}

function collectPolygonFeatures(
  node: unknown,
  out: Feature<Polygon>[],
  inheritedProperties?: Record<string, unknown>,
  enforceWgs84Range = true,
): void {
  if (!isRecord(node) || typeof node.type !== 'string') return;

  switch (node.type) {
    case 'FeatureCollection': {
      if (Array.isArray(node.features)) {
        for (const feat of node.features) {
          collectPolygonFeatures(feat, out, undefined, enforceWgs84Range);
        }
      }
      break;
    }
    case 'Feature': {
      const props = isRecord(node.properties) ? { ...node.properties } : {};
      collectPolygonFeatures(node.geometry, out, props, enforceWgs84Range);
      break;
    }
    case 'GeometryCollection': {
      if (Array.isArray(node.geometries)) {
        for (const geom of node.geometries) {
          collectPolygonFeatures(
            geom,
            out,
            inheritedProperties,
            enforceWgs84Range,
          );
        }
      }
      break;
    }
    case 'Polygon': {
      const rings = normalizePolygonCoordinates(
        node.coordinates,
        enforceWgs84Range,
      );
      if (rings) {
        out.push({
          type: 'Feature',
          properties: inheritedProperties ? { ...inheritedProperties } : {},
          geometry: {
            type: 'Polygon',
            coordinates: rings,
          },
        });
      }
      break;
    }
    case 'MultiPolygon': {
      if (Array.isArray(node.coordinates)) {
        for (const polyCoords of node.coordinates) {
          const rings = normalizePolygonCoordinates(
            polyCoords,
            enforceWgs84Range,
          );
          if (rings) {
            out.push({
              type: 'Feature',
              properties: inheritedProperties ? { ...inheritedProperties } : {},
              geometry: {
                type: 'Polygon',
                coordinates: rings,
              },
            });
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Extracts the primary (largest-area valid) Polygon feature from any GeoJSON
 * FeatureCollection, Feature, GeometryCollection, Polygon, or MultiPolygon.
 * Auto-closes open rings and skips degenerate/invalid geometries.
 */
export function extractPrimaryPolygon(
  fc: FeatureCollection | GeoJsonObject | undefined,
): Feature<Polygon> | null {
  if (!fc || typeof fc !== 'object') return null;

  const candidates: Feature<Polygon>[] = [];
  collectPolygonFeatures(fc, candidates);
  if (candidates.length === 0) return null;

  let best: Feature<Polygon> | null = null;
  let bestArea = 0;

  for (const candidate of candidates) {
    const areaSqm = turf.area(candidate);
    if (Number.isFinite(areaSqm) && areaSqm > bestArea) {
      bestArea = areaSqm;
      best = candidate;
    }
  }

  return best;
}

function angularDeltaDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function estimateFrontageMeters(
  outerRing: Position[],
  perimeterM: number,
  bbox: [number, number, number, number],
  centroidLat: number,
): number {
  interface Segment {
    lengthM: number;
    bearingDeg: number;
    midLat: number;
    midLng: number;
  }

  const segments: Segment[] = [];
  for (let i = 0; i < outerRing.length - 1; i += 1) {
    const p1 = outerRing[i];
    const p2 = outerRing[i + 1];
    const lengthM = turf.distance(p1, p2, { units: 'meters' });
    if (!Number.isFinite(lengthM) || lengthM <= 0.01) continue;
    const bearingDeg = turf.bearing(p1, p2);
    segments.push({
      lengthM,
      bearingDeg,
      midLat: (p1[1] + p2[1]) / 2,
      midLng: (p1[0] + p2[0]) / 2,
    });
  }

  if (segments.length === 0) return 0;

  // Merge consecutive nearly-collinear segments (within 5° bearing tolerance)
  // so curved/densified boundaries are treated as coherent macro-sides.
  const COLLINEAR_TOLERANCE_DEG = 5;
  const macroEdges: Array<{
    lengthM: number;
    bearingDeg: number;
    weightedLatSum: number;
    weightedLngSum: number;
  }> = [];

  for (const seg of segments) {
    const prev = macroEdges[macroEdges.length - 1];
    if (
      prev &&
      angularDeltaDeg(prev.bearingDeg, seg.bearingDeg) <=
        COLLINEAR_TOLERANCE_DEG
    ) {
      prev.lengthM += seg.lengthM;
      prev.weightedLatSum += seg.midLat * seg.lengthM;
      prev.weightedLngSum += seg.midLng * seg.lengthM;
    } else {
      macroEdges.push({
        lengthM: seg.lengthM,
        bearingDeg: seg.bearingDeg,
        weightedLatSum: seg.midLat * seg.lengthM,
        weightedLngSum: seg.midLng * seg.lengthM,
      });
    }
  }

  // Merge wrap-around last and first macro-edges if collinear
  if (macroEdges.length > 1) {
    const first = macroEdges[0];
    const last = macroEdges[macroEdges.length - 1];
    if (
      angularDeltaDeg(first.bearingDeg, last.bearingDeg) <=
      COLLINEAR_TOLERANCE_DEG
    ) {
      first.lengthM += last.lengthM;
      first.weightedLatSum += last.weightedLatSum;
      first.weightedLngSum += last.weightedLngSum;
      macroEdges.pop();
    }
  }

  const maxMacroLen = Math.max(...macroEdges.map((e) => e.lengthM));
  if (maxMacroLen < perimeterM * 0.08) {
    // Smooth curve / circular parcel fallback: East-West span at centroid latitude
    const span = turf.distance(
      [bbox[0], centroidLat],
      [bbox[2], centroidLat],
      { units: 'meters' },
    );
    return Number.isFinite(span) ? Number(span.toFixed(2)) : 0;
  }

  // Exclude minor corner truncation splays (< 15% of the longest macro-edge)
  const significantEdges = macroEdges.filter(
    (e) => e.lengthM >= maxMacroLen * 0.15,
  );
  const candidates = significantEdges.length > 0 ? significantEdges : macroEdges;

  // Pick the southernmost significant boundary edge (aligns with primary street
  // frontage on standard rectangles & Australian cadastral parcels).
  let chosen = candidates[0];
  let chosenMidLat = chosen.weightedLatSum / chosen.lengthM;

  for (let i = 1; i < candidates.length; i += 1) {
    const edge = candidates[i];
    const edgeMidLat = edge.weightedLatSum / edge.lengthM;
    if (edgeMidLat < chosenMidLat - 1e-7) {
      chosen = edge;
      chosenMidLat = edgeMidLat;
    }
  }

  return Number(chosen.lengthM.toFixed(2));
}

/**
 * Computes true geodesic area, perimeter, frontage, centroid, bounding box,
 * and exterior vertex count for a parcel GeoJSON using @turf/turf.
 */
export function computePolygonMetrics(
  fc: FeatureCollection | GeoJsonObject,
): PolygonMetrics {
  const primary = extractPrimaryPolygon(fc);
  if (!primary) {
    throw new Error(
      'Cannot compute polygon metrics: no valid polygon geometry found.',
    );
  }

  const outerRing = primary.geometry.coordinates[0];
  const rawAreaSqm = turf.area(primary);
  const rawPerimeterM = turf.length(turf.lineString(outerRing), {
    units: 'meters',
  });
  const centroidFeat = turf.centroid(primary);
  const rawBbox = turf.bbox(primary);

  const bbox: [number, number, number, number] = [
    rawBbox[0],
    rawBbox[1],
    rawBbox[2],
    rawBbox[3],
  ];
  const centroid = {
    lat: Number(centroidFeat.geometry.coordinates[1].toFixed(7)),
    lng: Number(centroidFeat.geometry.coordinates[0].toFixed(7)),
  };

  const grossAreaSqm = Number(rawAreaSqm.toFixed(2));
  const grossAreaHa = Number((rawAreaSqm / 10000).toFixed(6));
  const perimeterM = Number(rawPerimeterM.toFixed(2));
  const frontageM = estimateFrontageMeters(
    outerRing,
    rawPerimeterM,
    bbox,
    centroid.lat,
  );
  const vertexCount = Math.max(0, outerRing.length - 1);

  return {
    grossAreaSqm,
    grossAreaHa,
    perimeterM,
    frontageM,
    centroid,
    bbox,
    vertexCount,
  };
}

/**
 * Builds an exact metric rectangular parcel FeatureCollection centered at (lat, lng)
 * with dimensions widthM (East-West) by depthM (North-South) using GDA2020 / MGA2020
 * proj4 offsets rather than approximate degree deltas.
 */
export function createRectPolygonFeatureCollection(
  lat: number,
  lng: number,
  widthM: number,
  depthM: number,
): FeatureCollection {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(widthM) ||
    !Number.isFinite(depthM)
  ) {
    throw new RangeError(
      'lat, lng, widthM, and depthM must all be finite numbers.',
    );
  }
  if (widthM <= 0 || depthM <= 0) {
    throw new RangeError('widthM and depthM must be strictly positive.');
  }

  const center = wgs84ToMga2020(lng, lat);
  const halfW = widthM / 2;
  const halfD = depthM / 2;

  // Counter-clockwise ring starting at SW corner (RFC 7946 right-hand rule)
  const sw = mga2020ToWgs84(
    center.easting - halfW,
    center.northing - halfD,
    center.mgaZone,
  );
  const se = mga2020ToWgs84(
    center.easting + halfW,
    center.northing - halfD,
    center.mgaZone,
  );
  const ne = mga2020ToWgs84(
    center.easting + halfW,
    center.northing + halfD,
    center.mgaZone,
  );
  const nw = mga2020ToWgs84(
    center.easting - halfW,
    center.northing + halfD,
    center.mgaZone,
  );

  const ring: Position[] = [
    [sw.lng, sw.lat],
    [se.lng, se.lat],
    [ne.lng, ne.lat],
    [nw.lng, nw.lat],
    [sw.lng, sw.lat],
  ];

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          role: 'parcel-boundary',
          widthM,
          depthM,
          mgaZone: center.mgaZone,
          mgaEpsg: center.mgaEpsg,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };
}

function validatePolygonInAustralia(polygon: Feature<Polygon>): string | null {
  let looksSwapped = false;
  for (const ring of polygon.geometry.coordinates) {
    for (const pos of ring) {
      const [lng, lat] = pos;
      if (!isWithinAustralianBounds(lng, lat)) {
        if (isWithinAustralianBounds(lat, lng)) {
          looksSwapped = true;
        }
        return looksSwapped
          ? `Parcel vertex [${lng}, ${lat}] lies outside Australia (lng 110..160, lat -45..-8) and appears to be in [lat, lng] order instead of [lng, lat].`
          : `Parcel vertex [${lng}, ${lat}] lies outside Australian coordinate bounds (lng ${AU_COORDINATE_BOUNDS.minLng}..${AU_COORDINATE_BOUNDS.maxLng}, lat ${AU_COORDINATE_BOUNDS.minLat}..${AU_COORDINATE_BOUNDS.maxLat}).`;
      }
    }
  }
  return null;
}

function finalizeParsedPolygon(
  primary: Feature<Polygon>,
  sourceFormat: string,
): ParcelParseResult {
  const boundsError = validatePolygonInAustralia(primary);
  if (boundsError) {
    return { ok: false, error: boundsError };
  }

  const areaSqm = turf.area(primary);
  if (!Number.isFinite(areaSqm) || areaSqm < 1) {
    return {
      ok: false,
      error: `${sourceFormat} polygon has negligible or zero area (${areaSqm.toFixed(2)} m²).`,
    };
  }

  const boundary: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          role: 'parcel-boundary',
          ...(primary.properties ?? {}),
        },
        geometry: primary.geometry,
      },
    ],
  };

  return {
    ok: true,
    boundary,
    metrics: computePolygonMetrics(boundary),
  };
}

/**
 * Parses and validates an Australian parcel boundary from a GeoJSON string.
 * Supports Polygon, MultiPolygon (extracts largest ring), Feature, FeatureCollection,
 * and GeometryCollection; auto-closes open rings; validates AU bounds.
 */
export function parseParcelGeoJson(raw: string): ParcelParseResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'GeoJSON input is empty.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Invalid GeoJSON syntax: ${detail}` };
  }

  if (hasForbiddenKeysDeep(parsed)) {
    return {
      ok: false,
      error: 'Rejected unsafe GeoJSON payload containing forbidden object keys.',
    };
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return {
      ok: false,
      error: 'GeoJSON payload must be an object with a valid "type" property.',
    };
  }

  const candidates: Feature<Polygon>[] = [];
  collectPolygonFeatures(parsed, candidates, undefined, false);

  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        'GeoJSON contains no valid Polygon or MultiPolygon boundary with at least 3 distinct finite vertices.',
    };
  }

  // Validate Australian coordinate bounds before computing geodesic area so
  // swapped [lat, lng] or overseas payloads return clear diagnostics.
  const validAuCandidates: Feature<Polygon>[] = [];
  let firstBoundsError: string | null = null;
  for (const candidate of candidates) {
    const boundsErr = validatePolygonInAustralia(candidate);
    if (boundsErr) {
      firstBoundsError ??= boundsErr;
      continue;
    }
    validAuCandidates.push(candidate);
  }

  if (validAuCandidates.length === 0) {
    return {
      ok: false,
      error:
        firstBoundsError ??
        'GeoJSON polygon vertices lie outside Australian coordinate bounds.',
    };
  }

  // Pick largest valid Australian polygon
  let primary: Feature<Polygon> | null = null;
  let bestArea = -1;
  for (const candidate of validAuCandidates) {
    const areaSqm = turf.area(candidate);
    if (Number.isFinite(areaSqm) && areaSqm > bestArea) {
      bestArea = areaSqm;
      primary = candidate;
    }
  }

  if (!primary) {
    return {
      ok: false,
      error: 'Unable to extract a valid polygon from GeoJSON payload.',
    };
  }

  return finalizeParsedPolygon(primary, 'GeoJSON');
}

function parseKmlCoordinatesText(text: string): Position[] | null {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0);
  if (tokens.length < 3) return null;

  const rawCoords: Position[] = [];
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length < 2) return null;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    rawCoords.push([lng, lat]);
  }

  return sanitizeRing(rawCoords, false);
}

function extractKmlPolygonsViaDom(rawXml: string): {
  polygons: Feature<Polygon>[];
  parseError?: string;
} | null {
  if (typeof DOMParser === 'undefined') return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawXml, 'text/xml');

  const parserErrors = doc.getElementsByTagName('parsererror');
  if (parserErrors.length > 0) {
    const errText = parserErrors[0].textContent?.trim() || 'Malformed XML.';
    return { polygons: [], parseError: `Invalid KML XML: ${errText}` };
  }

  const findByLocalName = (root: Document | Element, localName: string): Element[] => {
    const all = root.getElementsByTagName('*');
    const matched: Element[] = [];
    const target = localName.toLowerCase();
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i];
      const name = (el.localName || el.tagName.split(':').pop() || '').toLowerCase();
      if (name === target) {
        matched.push(el);
      }
    }
    return matched;
  };

  const docNames = findByLocalName(doc, 'name');
  const fallbackName = docNames[0]?.textContent?.trim();

  const polygonEls = findByLocalName(doc, 'Polygon');
  const polygons: Feature<Polygon>[] = [];

  for (const polyEl of polygonEls) {
    const outerEls = findByLocalName(polyEl, 'outerBoundaryIs');
    const outerCoordEl =
      outerEls.length > 0
        ? findByLocalName(outerEls[0], 'coordinates')[0]
        : findByLocalName(polyEl, 'coordinates')[0];

    if (!outerCoordEl?.textContent) continue;
    const outerRing = parseKmlCoordinatesText(outerCoordEl.textContent);
    if (!outerRing) continue;

    const rings: Position[][] = [outerRing];
    const innerEls = findByLocalName(polyEl, 'innerBoundaryIs');
    for (const innerEl of innerEls) {
      const innerCoordEl = findByLocalName(innerEl, 'coordinates')[0];
      if (!innerCoordEl?.textContent) continue;
      const holeRing = parseKmlCoordinatesText(innerCoordEl.textContent);
      if (holeRing) rings.push(holeRing);
    }

    // Look for nearest enclosing Placemark <name>
    let placemarkName = fallbackName;
    let parent = polyEl.parentElement;
    while (parent) {
      const pName = (parent.localName || parent.tagName.split(':').pop() || '').toLowerCase();
      if (pName === 'placemark') {
        const directName = findByLocalName(parent, 'name')[0]?.textContent?.trim();
        if (directName) placemarkName = directName;
        break;
      }
      parent = parent.parentElement;
    }

    polygons.push({
      type: 'Feature',
      properties: placemarkName ? { name: placemarkName } : {},
      geometry: {
        type: 'Polygon',
        coordinates: rings,
      },
    });
  }

  return { polygons };
}

function extractKmlPolygonsViaRegex(rawXml: string): Feature<Polygon>[] {
  const polygons: Feature<Polygon>[] = [];
  const nameMatch = /<(?:[a-zA-Z0-9_-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?name>/i.exec(
    rawXml,
  );
  const fallbackName = nameMatch?.[1]?.trim();

  const polygonRegex =
    /<(?:[a-zA-Z0-9_-]+:)?Polygon\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Polygon>/gi;
  const outerRegex =
    /<(?:[a-zA-Z0-9_-]+:)?outerBoundaryIs\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?outerBoundaryIs>/i;
  const innerRegex =
    /<(?:[a-zA-Z0-9_-]+:)?innerBoundaryIs\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?innerBoundaryIs>/gi;
  const coordRegex =
    /<(?:[a-zA-Z0-9_-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?coordinates>/i;

  let polyMatch: RegExpExecArray | null;
  while ((polyMatch = polygonRegex.exec(rawXml)) !== null) {
    const polyBody = polyMatch[1];
    const outerMatch = outerRegex.exec(polyBody);
    const coordSource = outerMatch ? outerMatch[1] : polyBody;
    const outerCoordMatch = coordRegex.exec(coordSource);
    if (!outerCoordMatch) continue;

    const outerRing = parseKmlCoordinatesText(outerCoordMatch[1]);
    if (!outerRing) continue;

    const rings: Position[][] = [outerRing];
    innerRegex.lastIndex = 0;
    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = innerRegex.exec(polyBody)) !== null) {
      const innerCoordMatch = coordRegex.exec(innerMatch[1]);
      if (!innerCoordMatch) continue;
      const holeRing = parseKmlCoordinatesText(innerCoordMatch[1]);
      if (holeRing) rings.push(holeRing);
    }

    polygons.push({
      type: 'Feature',
      properties: fallbackName ? { name: fallbackName } : {},
      geometry: {
        type: 'Polygon',
        coordinates: rings,
      },
    });
  }

  return polygons;
}

/**
 * Parses and validates an Australian parcel boundary from KML 2.2 XML.
 * Uses DOMParser when available and falls back to pure-TS XML extraction.
 */
export function parseParcelKml(rawXml: string): ParcelParseResult {
  if (typeof rawXml !== 'string' || rawXml.trim().length === 0) {
    return { ok: false, error: 'KML input is empty.' };
  }

  if (!rawXml.includes('<')) {
    return { ok: false, error: 'Invalid KML XML: input does not contain XML tags.' };
  }

  let polygons: Feature<Polygon>[] = [];
  const domResult = extractKmlPolygonsViaDom(rawXml);
  if (domResult) {
    if (domResult.parseError) {
      return { ok: false, error: domResult.parseError };
    }
    polygons = domResult.polygons;
  }

  if (polygons.length === 0) {
    polygons = extractKmlPolygonsViaRegex(rawXml);
  }

  if (polygons.length === 0) {
    return {
      ok: false,
      error:
        'KML contains no valid <Polygon> geometry with <coordinates> tuples.',
    };
  }

  const validAuPolygons: Feature<Polygon>[] = [];
  let firstBoundsError: string | null = null;
  for (const candidate of polygons) {
    const boundsErr = validatePolygonInAustralia(candidate);
    if (boundsErr) {
      firstBoundsError ??= boundsErr;
      continue;
    }
    validAuPolygons.push(candidate);
  }

  if (validAuPolygons.length === 0) {
    return {
      ok: false,
      error:
        firstBoundsError ??
        'KML polygon vertices lie outside Australian coordinate bounds.',
    };
  }

  let primary = validAuPolygons[0];
  let bestArea = turf.area(primary);
  for (let i = 1; i < validAuPolygons.length; i += 1) {
    const area = turf.area(validAuPolygons[i]);
    if (Number.isFinite(area) && area > bestArea) {
      bestArea = area;
      primary = validAuPolygons[i];
    }
  }

  return finalizeParsedPolygon(primary, 'KML');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatKmlRingCoordinates(ring: Position[]): string {
  const closed = sanitizeRing(ring) ?? ring;
  return closed
    .map((pos) => `${Number(pos[0]).toFixed(7)},${Number(pos[1]).toFixed(7)},0`)
    .join(' ');
}

/**
 * Exports a GeoJSON FeatureCollection of polygon boundaries to valid KML 2.2 XML
 * with strict XML character escaping.
 */
export function exportFeatureCollectionToKml(
  fc: FeatureCollection,
  documentName: string,
): string {
  const polygons: Feature<Polygon>[] = [];
  collectPolygonFeatures(fc, polygons);

  if (polygons.length === 0) {
    throw new Error(
      'Cannot export KML: FeatureCollection contains no valid polygon geometries.',
    );
  }

  const safeDocName = escapeXml(documentName.trim() || 'devaware-os Parcel');

  const placemarks = polygons.map((poly, index) => {
    const rawName =
      typeof poly.properties?.name === 'string' &&
      poly.properties.name.trim().length > 0
        ? poly.properties.name.trim()
        : polygons.length === 1
          ? documentName.trim() || 'Parcel Boundary'
          : `Parcel ${index + 1}`;
    const safeName = escapeXml(rawName);
    const [outerRing, ...holes] = poly.geometry.coordinates;

    const innerBlocks = holes
      .map(
        (hole) =>
          `        <innerBoundaryIs>\n          <LinearRing>\n            <coordinates>${formatKmlRingCoordinates(hole)}</coordinates>\n          </LinearRing>\n        </innerBoundaryIs>`,
      )
      .join('\n');

    return [
      '    <Placemark>',
      `      <name>${safeName}</name>`,
      '      <Polygon>',
      '        <outerBoundaryIs>',
      '          <LinearRing>',
      `            <coordinates>${formatKmlRingCoordinates(outerRing)}</coordinates>`,
      '          </LinearRing>',
      '        </outerBoundaryIs>',
      ...(innerBlocks ? [innerBlocks] : []),
      '      </Polygon>',
      '    </Placemark>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${safeDocName}</name>`,
    ...placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

interface ParsedDxfPolyline {
  layer: string;
  closedFlag: boolean;
  vertices: Array<[number, number]>;
}

function detectMgaZoneFromDxfComment(comment: string): number | null {
  const epsgMatch = /EPSG[:\s]*78(49|5[0-6])\b/i.exec(comment);
  if (epsgMatch) {
    return Number(epsgMatch[1]);
  }
  const zoneMatch = /MGA(?:2020)?[\s_-]*(?:ZONE|Z)?[\s_-]*(49|5[0-6])\b/i.exec(
    comment,
  );
  if (zoneMatch) {
    return Number(zoneMatch[1]);
  }
  return null;
}

/**
 * Parses an ASCII DXF string containing LWPOLYLINE or POLYLINE/VERTEX entities.
 * Automatically detects MGA2020 Easting/Northing coordinates (|x| > 10000 or |y| > 10000)
 * and transforms them via mga2020ToWgs84, or accepts WGS84 lng/lat vertices directly.
 */
export function parseParcelDxf(
  rawDxf: string,
  fallbackMgaZone?: number,
): ParcelParseResult {
  if (typeof rawDxf !== 'string' || rawDxf.trim().length === 0) {
    return { ok: false, error: 'DXF input is empty.' };
  }

  if (fallbackMgaZone !== undefined) {
    if (
      !Number.isInteger(fallbackMgaZone) ||
      fallbackMgaZone < MGA2020_MIN_ZONE ||
      fallbackMgaZone > MGA2020_MAX_ZONE
    ) {
      return {
        ok: false,
        error: `Invalid fallback MGA2020 zone "${String(fallbackMgaZone)}". Expected an integer between ${MGA2020_MIN_ZONE} and ${MGA2020_MAX_ZONE}.`,
      };
    }
  }

  const lines = rawDxf.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length < 4) {
    return {
      ok: false,
      error: 'Invalid ASCII DXF: file is too short to contain polyline entities.',
    };
  }

  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i].trim();
    const code = Number(codeStr);
    if (!Number.isInteger(code)) {
      return {
        ok: false,
        error: `Malformed ASCII DXF group code "${codeStr}" at line ${i + 1}.`,
      };
    }
    pairs.push({ code, value: lines[i + 1].trim() });
  }

  const polylines: ParsedDxfPolyline[] = [];
  let detectedZoneFromHeader: number | null = null;

  let mode: 'none' | 'lwpolyline' | 'polyline' | 'vertex' = 'none';
  let current: ParsedDxfPolyline | null = null;
  let pendingX: number | null = null;
  let pendingY: number | null = null;

  const flushVertex = (): void => {
    if (
      current &&
      pendingX !== null &&
      pendingY !== null &&
      Number.isFinite(pendingX) &&
      Number.isFinite(pendingY)
    ) {
      current.vertices.push([pendingX, pendingY]);
    }
    pendingX = null;
    pendingY = null;
  };

  const finalizeCurrent = (): void => {
    flushVertex();
    if (current && current.vertices.length >= 3) {
      polylines.push(current);
    }
    current = null;
  };

  for (const { code, value } of pairs) {
    if (code === 999) {
      const hint = detectMgaZoneFromDxfComment(value);
      if (hint !== null && detectedZoneFromHeader === null) {
        detectedZoneFromHeader = hint;
      }
      continue;
    }

    if (code === 0) {
      const upper = value.toUpperCase();
      if (mode === 'lwpolyline') {
        finalizeCurrent();
        mode = 'none';
      } else if (mode === 'vertex') {
        flushVertex();
        if (upper === 'VERTEX') {
          mode = 'vertex';
          continue;
        }
        if (upper === 'SEQEND') {
          finalizeCurrent();
          mode = 'none';
          continue;
        }
        finalizeCurrent();
        mode = 'none';
      } else if (mode === 'polyline') {
        if (upper === 'VERTEX') {
          mode = 'vertex';
          continue;
        }
        if (upper === 'SEQEND') {
          finalizeCurrent();
          mode = 'none';
          continue;
        }
        finalizeCurrent();
        mode = 'none';
      }

      if (upper === 'LWPOLYLINE') {
        mode = 'lwpolyline';
        current = { layer: '0', closedFlag: false, vertices: [] };
      } else if (upper === 'POLYLINE') {
        mode = 'polyline';
        current = { layer: '0', closedFlag: false, vertices: [] };
      }
      continue;
    }

    if (!current) continue;

    if (mode === 'lwpolyline') {
      if (code === 8 && value) {
        current.layer = value;
      } else if (code === 70) {
        const flags = Number(value);
        if (Number.isFinite(flags)) {
          current.closedFlag = (flags & 1) === 1;
        }
      } else if (code === 10) {
        if (pendingX !== null && pendingY !== null) {
          flushVertex();
        }
        const x = Number(value);
        if (!Number.isFinite(x)) {
          return {
            ok: false,
            error: `Invalid DXF LWPOLYLINE X coordinate "${value}".`,
          };
        }
        pendingX = x;
      } else if (code === 20) {
        const y = Number(value);
        if (!Number.isFinite(y)) {
          return {
            ok: false,
            error: `Invalid DXF LWPOLYLINE Y coordinate "${value}".`,
          };
        }
        pendingY = y;
        if (pendingX !== null) {
          flushVertex();
        }
      }
    } else if (mode === 'polyline') {
      if (code === 8 && value) {
        current.layer = value;
      } else if (code === 70) {
        const flags = Number(value);
        if (Number.isFinite(flags)) {
          current.closedFlag = (flags & 1) === 1;
        }
      }
    } else if (mode === 'vertex') {
      if (code === 10) {
        const x = Number(value);
        if (!Number.isFinite(x)) {
          return {
            ok: false,
            error: `Invalid DXF VERTEX X coordinate "${value}".`,
          };
        }
        pendingX = x;
      } else if (code === 20) {
        const y = Number(value);
        if (!Number.isFinite(y)) {
          return {
            ok: false,
            error: `Invalid DXF VERTEX Y coordinate "${value}".`,
          };
        }
        pendingY = y;
      }
    }
  }

  finalizeCurrent();

  if (polylines.length === 0) {
    return {
      ok: false,
      error:
        'DXF contains no valid LWPOLYLINE or POLYLINE parcel boundary with at least 3 vertices.',
    };
  }

  const resolvedZone = fallbackMgaZone ?? detectedZoneFromHeader ?? 56;
  const candidateFeatures: Feature<Polygon>[] = [];
  let lastError: string | null = null;

  for (const poly of polylines) {
    const isProjectedMga = poly.vertices.some(
      ([x, y]) => Math.abs(x) > 10000 || Math.abs(y) > 10000,
    );

    const wgsCoords: Position[] = [];
    let conversionError: string | null = null;

    for (const [x, y] of poly.vertices) {
      if (isProjectedMga) {
        try {
          const { lng, lat } = mga2020ToWgs84(x, y, resolvedZone);
          wgsCoords.push([lng, lat]);
        } catch (err) {
          conversionError =
            err instanceof Error ? err.message : String(err);
          break;
        }
      } else {
        wgsCoords.push([x, y]);
      }
    }

    if (conversionError) {
      lastError = conversionError;
      continue;
    }

    const closedRing = sanitizeRing(wgsCoords, false);
    if (!closedRing) {
      lastError = 'DXF polyline must contain at least 3 distinct finite vertices.';
      continue;
    }

    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {
        layer: poly.layer,
        sourceCrs: isProjectedMga ? `EPSG:${7800 + resolvedZone}` : 'EPSG:4326',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing],
      },
    };

    const boundsErr = validatePolygonInAustralia(feature);
    if (boundsErr) {
      lastError = isProjectedMga
        ? `${boundsErr} Check whether the MGA2020 zone (used Zone ${resolvedZone}) matches your CAD file.`
        : boundsErr;
      continue;
    }

    candidateFeatures.push(feature);
  }

  if (candidateFeatures.length === 0) {
    return {
      ok: false,
      error:
        lastError ??
        'DXF polylines could not be converted into a valid Australian parcel polygon.',
    };
  }

  let primary = candidateFeatures[0];
  let bestArea = turf.area(primary);
  for (let i = 1; i < candidateFeatures.length; i += 1) {
    const area = turf.area(candidateFeatures[i]);
    if (Number.isFinite(area) && area > bestArea) {
      bestArea = area;
      primary = candidateFeatures[i];
    }
  }

  return finalizeParsedPolygon(primary, 'DXF');
}

/**
 * Exports a GeoJSON FeatureCollection of parcel polygons to a clean ASCII DXF
 * (AC1015 / R2000 compatible) with closed LWPOLYLINE entities projected into
 * GDA2020 / MGA2020 meters.
 */
export function exportFeatureCollectionToDxf(
  fc: FeatureCollection,
  mgaZone: number,
  layerName = 'PARCEL_BOUNDARY',
): string {
  assertValidMgaZone(mgaZone);

  const polygons: Feature<Polygon>[] = [];
  collectPolygonFeatures(fc, polygons);

  if (polygons.length === 0) {
    throw new Error(
      'Cannot export DXF: FeatureCollection contains no valid polygon geometries.',
    );
  }

  const cleanLayer =
    layerName.replace(/[\r\n]+/g, ' ').trim() || 'PARCEL_BOUNDARY';

  interface ProjectedRing {
    layer: string;
    points: Array<[number, number]>;
  }

  const projectedRings: ProjectedRing[] = [];
  let minE = Number.POSITIVE_INFINITY;
  let minN = Number.POSITIVE_INFINITY;
  let maxE = Number.NEGATIVE_INFINITY;
  let maxN = Number.NEGATIVE_INFINITY;

  for (const poly of polygons) {
    const featLayer =
      typeof poly.properties?.layer === 'string' &&
      poly.properties.layer.trim().length > 0
        ? poly.properties.layer.replace(/[\r\n]+/g, ' ').trim()
        : cleanLayer;

    for (const ring of poly.geometry.coordinates) {
      const closed = sanitizeRing(ring);
      if (!closed || closed.length < 4) continue;
      // Exclude duplicate closing vertex since LWPOLYLINE flag 70=1 closes the ring
      const uniqueVertices = closed.slice(0, -1);
      const pts: Array<[number, number]> = [];
      for (const pos of uniqueVertices) {
        const { easting, northing } = wgs84ToMga2020(pos[0], pos[1], mgaZone);
        minE = Math.min(minE, easting);
        minN = Math.min(minN, northing);
        maxE = Math.max(maxE, easting);
        maxN = Math.max(maxN, northing);
        pts.push([easting, northing]);
      }
      projectedRings.push({ layer: featLayer, points: pts });
    }
  }

  if (projectedRings.length === 0) {
    throw new Error(
      'Cannot export DXF: no valid closed polygon rings found in FeatureCollection.',
    );
  }

  const lines: string[] = [
    '999',
    `devaware-os GDA2020 / MGA2020 Zone ${mgaZone} (EPSG:${7800 + mgaZone})`,
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1015',
    '9',
    '$INSUNITS',
    '70',
    '6',
    '9',
    '$EXTMIN',
    '10',
    minE.toFixed(3),
    '20',
    minN.toFixed(3),
    '30',
    '0.000',
    '9',
    '$EXTMAX',
    '10',
    maxE.toFixed(3),
    '20',
    maxN.toFixed(3),
    '30',
    '0.000',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  for (const ring of projectedRings) {
    lines.push(
      '0',
      'LWPOLYLINE',
      '100',
      'AcDbEntity',
      '8',
      ring.layer,
      '100',
      'AcDbPolyline',
      '90',
      String(ring.points.length),
      '70',
      '1',
    );
    for (const [easting, northing] of ring.points) {
      lines.push('10', easting.toFixed(3), '20', northing.toFixed(3));
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\n');
}

const STATE_NAME_LOOKUP: Readonly<Record<string, AustralianState>> = {
  NSW: 'NSW',
  'NEW SOUTH WALES': 'NSW',
  VIC: 'VIC',
  VICTORIA: 'VIC',
  QLD: 'QLD',
  QUEENSLAND: 'QLD',
  WA: 'WA',
  'WESTERN AUSTRALIA': 'WA',
  SA: 'SA',
  'SOUTH AUSTRALIA': 'SA',
  TAS: 'TAS',
  TASMANIA: 'TAS',
  ACT: 'ACT',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  CANBERRA: 'ACT',
  NT: 'NT',
  'NORTHERN TERRITORY': 'NT',
};

/**
 * Normalizes a raw state/territory string (abbreviation or full name) to a canonical
 * AustralianState code, falling back to coordinate-based Australian boundary heuristics
 * when the string is omitted or unrecognized.
 */
export function normalizeAustralianState(
  raw: string | undefined,
  lat: number,
  lng: number,
): AustralianState {
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/\s+/g, ' ').toUpperCase();
    const direct = STATE_NAME_LOOKUP[cleaned];
    if (direct) return direct;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'NSW';
  }

  // Tasmania (Bass Strait & main island)
  if (lat <= -39.2 && lng >= 143.5 && lng <= 149.0) {
    return 'TAS';
  }

  // Western Australia (west of 129°E)
  if (lng < 129.0) {
    return 'WA';
  }

  // Northern Territory (129°E–138°E, north of 26°S)
  if (lng < 138.0 && lat > -26.0) {
    return 'NT';
  }

  // South Australia (129°E–141°E, south of 26°S)
  if (lng < 141.0 && lat <= -26.0) {
    return 'SA';
  }

  // Australian Capital Territory bounding region
  if (lat <= -35.12 && lat >= -35.93 && lng >= 148.76 && lng <= 149.4) {
    return 'ACT';
  }

  // Queensland (north of 29°S inland / 28.16°S coastal Tweed border)
  const qldBorderLat = lng > 152.0 ? -28.16 : -29.0;
  if (lat > qldBorderLat) {
    return 'QLD';
  }

  // Victoria (south of approximate Murray River / Black-Allan line)
  if (lat < -37.55) {
    return 'VIC';
  }
  if (lng >= 141.0 && lng <= 150.0 && lat <= -34.0) {
    const vicBorderLat =
      lng <= 147.0
        ? -34.0 - ((lng - 141.0) / 6.0) * 2.05
        : -36.05 - ((lng - 147.0) / 3.0) * 1.45;
    if (lat < vicBorderLat) {
      return 'VIC';
    }
  }

  return 'NSW';
}

interface PhotonFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildAuAddressParts(
  props: Record<string, unknown>,
  state: AustralianState,
): { label: string; address: string; suburb: string; lga: string; postcode: string } {
  const name = asTrimmedString(props.name);
  const houseNumber = asTrimmedString(props.housenumber);
  const street = asTrimmedString(props.street);
  const suburb =
    asTrimmedString(props.suburb) ||
    asTrimmedString(props.district) ||
    asTrimmedString(props.locality) ||
    asTrimmedString(props.city) ||
    asTrimmedString(props.town) ||
    asTrimmedString(props.village);
  const lga =
    asTrimmedString(props.county) ||
    asTrimmedString(props.city) ||
    asTrimmedString(props.district) ||
    suburb;
  const postcode = asTrimmedString(props.postcode);

  const streetLine = [houseNumber, street].filter(Boolean).join(' ').trim();
  const primaryLine = streetLine || name || suburb || 'Australian Site';

  const localityTail = [suburb, state, postcode]
    .filter((part, idx) => {
      if (!part) return false;
      // Avoid repeating suburb if primaryLine is already the exact suburb name
      if (idx === 0 && part.toLowerCase() === primaryLine.toLowerCase()) {
        return false;
      }
      return true;
    })
    .join(' ')
    .trim();

  const address = localityTail ? `${primaryLine}, ${localityTail}` : primaryLine;
  const label =
    name && streetLine && name.toLowerCase() !== streetLine.toLowerCase()
      ? `${name} — ${address}`
      : address;

  return { label, address, suburb, lga, postcode };
}

/**
 * Searches live Australian addresses via Photon Komoot strictly bounded and filtered
 * to Australia. Throws a descriptive Error on HTTP or network failure.
 */
export async function searchAustralianAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AuGeocodedAddress[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const url = `${PHOTON_ENDPOINT}?q=${encodeURIComponent(trimmed)}&limit=6&bbox=${PHOTON_AU_BBOX}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Australian address lookup network error: ${message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Australian address lookup failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON from Australian address lookup: ${message}`);
  }

  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    throw new Error(
      'Unexpected response format from Photon geocoder: missing "features" array.',
    );
  }

  const results: AuGeocodedAddress[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < payload.features.length; i += 1) {
    const rawFeat = payload.features[i] as PhotonFeature;
    if (
      !rawFeat ||
      rawFeat.geometry?.type !== 'Point' ||
      !Array.isArray(rawFeat.geometry.coordinates) ||
      rawFeat.geometry.coordinates.length < 2
    ) {
      continue;
    }

    const lng = rawFeat.geometry.coordinates[0];
    const lat = rawFeat.geometry.coordinates[1];
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      !isWithinAustralianBounds(lng, lat)
    ) {
      continue;
    }

    const props = isRecord(rawFeat.properties) ? rawFeat.properties : {};
    const countryCode = asTrimmedString(props.countrycode).toUpperCase();
    const country = asTrimmedString(props.country);

    // Strictly filter to Australia
    if (countryCode && countryCode !== 'AU') {
      continue;
    }
    if (!countryCode && country && !/australia/i.test(country)) {
      continue;
    }

    const state = normalizeAustralianState(
      asTrimmedString(props.state) || undefined,
      lat,
      lng,
    );
    const { label, address, suburb, lga, postcode } = buildAuAddressParts(
      props,
      state,
    );
    const { mgaZone, mgaEpsg } = getMga2020FromLng(lng);

    const osmType = asTrimmedString(props.osm_type);
    const osmId =
      typeof props.osm_id === 'number' || typeof props.osm_id === 'string'
        ? String(props.osm_id)
        : '';
    const id =
      osmType && osmId
        ? `photon-${osmType}-${osmId}`
        : `photon-${i}-${lat.toFixed(5)}-${lng.toFixed(5)}`;

    const dedupeKey = `${label.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    results.push({
      id,
      label,
      address,
      suburb,
      lga,
      state,
      postcode,
      lat,
      lng,
      mgaZone,
      mgaEpsg,
    });
  }

  return results;
}

function buildOfflineGraticuleGeoJson(): FeatureCollection {
  const features: Feature<Geometry>[] = [];

  // Meridians across Australia (110°E to 160°E every 2°)
  for (let lng = 110; lng <= 160; lng += 2) {
    features.push({
      type: 'Feature',
      properties: { major: lng % 6 === 0 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, -45],
          [lng, -8],
        ],
      },
    });
  }

  // Parallels across Australia (-44°S to -8°S every 2°)
  for (let lat = -44; lat <= -8; lat += 2) {
    features.push({
      type: 'Feature',
      properties: { major: lat % 6 === 0 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [110, lat],
          [160, lat],
        ],
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Returns the MapLibre style URL or StyleSpecification for the requested basemap mode.
 * - 'dark-vector': OpenFreeMap Dark vector style URL
 * - 'satellite': Esri World Imagery raster tile StyleSpecification
 * - 'offline-grid': Zero-network dark graticule StyleSpecification
 */
export function getMapStyleConfig(
  mode: MapBasemapMode,
): string | StyleSpecification {
  switch (mode) {
    case 'dark-vector':
      return OPENFREEMAP_DARK_STYLE_URL;

    case 'satellite':
      return {
        version: 8,
        name: 'devaware-os Satellite (Esri World Imagery)',
        sources: {
          'esri-world-imagery': {
            type: 'raster',
            tiles: [ESRI_WORLD_IMAGERY_TILE_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#090d16' },
          },
          {
            id: 'esri-world-imagery-layer',
            type: 'raster',
            source: 'esri-world-imagery',
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };

    case 'offline-grid':
      return {
        version: 8,
        name: 'devaware-os Offline Dark Graticule',
        sources: {
          'au-offline-graticule': {
            type: 'geojson',
            data: buildOfflineGraticuleGeoJson(),
          },
        },
        layers: [
          {
            id: 'offline-background',
            type: 'background',
            paint: { 'background-color': '#070b14' },
          },
          {
            id: 'offline-graticule-minor',
            type: 'line',
            source: 'au-offline-graticule',
            filter: ['!=', ['get', 'major'], true],
            paint: {
              'line-color': '#1e293b',
              'line-width': 0.8,
              'line-opacity': 0.55,
            },
          },
          {
            id: 'offline-graticule-major',
            type: 'line',
            source: 'au-offline-graticule',
            filter: ['==', ['get', 'major'], true],
            paint: {
              'line-color': '#0ea5e9',
              'line-width': 1.1,
              'line-opacity': 0.35,
            },
          },
        ],
      };
  }
}

/**
 * Verified CORS-enabled public Australian cadastral MapServer raster overlays.
 */
export const AU_PUBLIC_CADASTRE_LAYERS: readonly AuPublicCadastreLayerSpec[] = [
  {
    id: 'nsw-cadastre',
    state: 'NSW',
    name: 'NSW Spatial Services Cadastre',
    authority: 'Spatial Services NSW (DCS)',
    tileUrl:
      'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    tileSize: 256,
    minzoom: 13,
    maxzoom: 20,
    attribution: '© State of New South Wales (Spatial Services)',
    defaultOpacity: 0.78,
  },
  {
    id: 'qld-cadastre',
    state: 'QLD',
    name: 'QLD Land Parcel Property Framework',
    authority: 'Queensland Department of Resources',
    tileUrl:
      'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    tileSize: 256,
    minzoom: 13,
    maxzoom: 20,
    attribution: '© State of Queensland (Department of Resources)',
    defaultOpacity: 0.78,
  },
] as const;

export function getPublicCadastreLayerForState(
  state: AustralianState,
): AuPublicCadastreLayerSpec | null {
  return AU_PUBLIC_CADASTRE_LAYERS.find((layer) => layer.state === state) ?? null;
}
