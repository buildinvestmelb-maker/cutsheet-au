import type { FeatureCollection, Polygon } from 'geojson';
import type { AustralianState } from '../../bridge/types';
import { wgs84ToMga2020 } from './auGeoKernel';

export function detectAuStateFromCoords(lat: number, lng: number): AustralianState {
  if (lat >= -35.95 && lat <= -35.1 && lng >= 148.75 && lng <= 149.45) return 'ACT';
  if (lat < -39.2 && lng >= 143.5 && lng <= 149.0) return 'TAS';
  if (lng < 129.0) return 'WA';
  if (lng >= 129.0 && lng < 138.0) return lat >= -26.0 ? 'NT' : 'SA';
  if (lng >= 138.0 && lng < 141.0) return lat >= -26.0 ? 'QLD' : 'SA';
  if (lat > -29.0) return 'QLD';
  if (lat < -36.5 && lng >= 141.0 && lng < 150.0) return 'VIC';
  if (lat < -34.0 && lng >= 141.0 && lng < 149.98) {
    const vicBorderLat = -34.0 - ((lng - 141.0) / 8.98) * 3.5;
    if (lat < vicBorderLat) return 'VIC';
  }
  return 'NSW';
}

export interface AuStateSpatialProfile {
  state: AustralianState;
  name: string;
  capitalLabel: string;
  capitalCode: string;
  capitalLat: number;
  capitalLng: number;
  baseAHD: number;
  authority: string;
  parcelIdSchemeLabel: string;
  planningPortalUrl: string;
  bushfireInstrument: string;
  floodDataset: string;
  /** Direct CORS-safe raster tile URL for static-only hosting (when /api/cadastre is unavailable). */
  directCorsTileUrl?: string;
  /** Tile type when rendered on Vercel (/api/cadastre proxy supports all 8 states). */
  vercelTileMode: 'wms-bbox' | 'xyz-tile' | 'vector-blocks';
  attribution: string;
}

export const AU_STATE_SPATIAL_REGISTRY: Readonly<
  Record<AustralianState, AuStateSpatialProfile>
> = {
  NSW: {
    state: 'NSW',
    name: 'New South Wales',
    capitalLabel: 'Sydney',
    capitalCode: 'SYD',
    capitalLat: -33.8688,
    capitalLng: 151.2093,
    baseAHD: 36,
    authority: 'Spatial Services NSW (DCS) • ePlanning',
    parcelIdSchemeLabel: 'Lot / DP',
    planningPortalUrl: 'https://www.planningportal.nsw.gov.au/spatialviewer/',
    bushfireInstrument: 'NSW PBP 2019 / AS 3959',
    floodDataset: 'NSW Flood Data Portal (1% AEP)',
    directCorsTileUrl:
      'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    vercelTileMode: 'wms-bbox',
    attribution: '© State of New South Wales (Spatial Services)',
  },
  VIC: {
    state: 'VIC',
    name: 'Victoria',
    capitalLabel: 'Melbourne',
    capitalCode: 'MEL',
    capitalLat: -37.8136,
    capitalLng: 144.9631,
    baseAHD: 42,
    authority: 'Land Use Victoria (Vicmap Property) • VicPlan',
    parcelIdSchemeLabel: 'SPI (Lot\\Plan)',
    planningPortalUrl: 'https://mapshare.vic.gov.au/vicplan/',
    bushfireInstrument: 'VPP Clause 44.06 (BMO) / AS 3959',
    floodDataset: 'Victoria Flood Database (LSIO / FO)',
    directCorsTileUrl:
      'https://opendata.maps.vic.gov.au/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=open-data-platform:v_parcel_mp&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png8&transparent=true',
    vercelTileMode: 'wms-bbox',
    attribution: '© State of Victoria (DEECA / Vicmap)',
  },
  QLD: {
    state: 'QLD',
    name: 'Queensland',
    capitalLabel: 'Brisbane',
    capitalCode: 'BNE',
    capitalLat: -27.4698,
    capitalLng: 153.0251,
    baseAHD: 28,
    authority: 'QLD Dept of Resources (DCDB) • QSpatial',
    parcelIdSchemeLabel: 'Lot / Plan',
    planningPortalUrl: 'https://qldglobe.information.qld.gov.au/',
    bushfireInstrument: 'QLD SPP Bushfire Prone / AS 3959',
    floodDataset: 'FloodCheck Queensland (1% AEP)',
    directCorsTileUrl:
      'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    vercelTileMode: 'wms-bbox',
    attribution: '© State of Queensland (Department of Resources)',
  },
  WA: {
    state: 'WA',
    name: 'Western Australia',
    capitalLabel: 'Perth',
    capitalCode: 'PER',
    capitalLat: -31.9505,
    capitalLng: 115.8605,
    baseAHD: 22,
    authority: 'Landgate WA (SLIP) • PlanWA',
    parcelIdSchemeLabel: 'SLIP Lot / Plan',
    planningPortalUrl: 'https://catalogue.data.wa.gov.au/',
    bushfireInstrument: 'WA SPP 3.7 / DFES Bushfire Prone',
    floodDataset: 'DWER Floodplain Mapping (1% AEP)',
    vercelTileMode: 'wms-bbox',
    attribution: '© Western Australian Land Information Authority (Landgate)',
  },
  SA: {
    state: 'SA',
    name: 'South Australia',
    capitalLabel: 'Adelaide',
    capitalCode: 'ADL',
    capitalLat: -34.9285,
    capitalLng: 138.6007,
    baseAHD: 48,
    authority: 'Location SA • PlanSA SAPPA',
    parcelIdSchemeLabel: 'CT / PlanSA',
    planningPortalUrl: 'https://sappa.plan.sa.gov.au/',
    bushfireInstrument: 'SAPPA Hazards (Bushfire) / AS 3959',
    floodDataset: 'WaterConnect / SAPPA Floodplain',
    vercelTileMode: 'xyz-tile',
    attribution: '© Government of South Australia (Location SA / PlanSA)',
  },
  TAS: {
    state: 'TAS',
    name: 'Tasmania',
    capitalLabel: 'Hobart',
    capitalCode: 'HBA',
    capitalLat: -42.8821,
    capitalLng: 147.3272,
    baseAHD: 38,
    authority: 'Land Tasmania (theLIST) • TasPlanning',
    parcelIdSchemeLabel: 'CT Vol/Fol • PID',
    planningPortalUrl: 'https://maps.thelist.tas.gov.au/',
    bushfireInstrument: 'TasPlanning Bushfire-Prone Code / AS 3959',
    floodDataset: 'theLIST Flood-Prone Hazard Overlay',
    vercelTileMode: 'wms-bbox',
    attribution: '© State of Tasmania (theLIST)',
  },
  ACT: {
    state: 'ACT',
    name: 'Australian Capital Territory',
    capitalLabel: 'Canberra',
    capitalCode: 'CBR',
    capitalLat: -35.2809,
    capitalLng: 149.1300,
    baseAHD: 577,
    authority: 'ACT Government (ACTmapi) • Territory Plan',
    parcelIdSchemeLabel: 'Block / Section',
    planningPortalUrl: 'https://www.actmapi.act.gov.au/',
    bushfireInstrument: 'ACT Bushfire Prone Area / AS 3959',
    floodDataset: 'ACT Territory Flood Overlay',
    vercelTileMode: 'vector-blocks',
    attribution: '© Australian Capital Territory (ACTmapi)',
  },
  NT: {
    state: 'NT',
    name: 'Northern Territory',
    capitalLabel: 'Darwin',
    capitalCode: 'DRW',
    capitalLat: -12.4634,
    capitalLng: 130.8456,
    baseAHD: 26,
    authority: 'NT DEPWS (NT Cadastre) • NR Maps',
    parcelIdSchemeLabel: 'Lot / Town / LAIS',
    planningPortalUrl: 'https://nrmaps.nt.gov.au/',
    bushfireInstrument: 'Bushfires NT / Cyclone AS 1170.2',
    floodDataset: 'NT NR Maps Storm Surge & Floodplain',
    vercelTileMode: 'wms-bbox',
    attribution: '© Northern Territory of Australia (DEPWS)',
  },
};

export const ALL_8_AU_CAPITALS: readonly AuStateSpatialProfile[] = [
  AU_STATE_SPATIAL_REGISTRY.NSW,
  AU_STATE_SPATIAL_REGISTRY.VIC,
  AU_STATE_SPATIAL_REGISTRY.QLD,
  AU_STATE_SPATIAL_REGISTRY.WA,
  AU_STATE_SPATIAL_REGISTRY.SA,
  AU_STATE_SPATIAL_REGISTRY.TAS,
  AU_STATE_SPATIAL_REGISTRY.ACT,
  AU_STATE_SPATIAL_REGISTRY.NT,
] as const;

export interface LegalParcelSnapResult {
  matched: boolean;
  state: AustralianState;
  mgaEpsg: string;
  authority: string;
  parcelId: string;
  parcelLabel: string;
  address: string;
  tenure: string;
  zoneName: string;
  areaSqm: number;
  provenance: 'live-state-cadastre' | 'osm-footprint' | 'screening-fallback' | 'unavailable';
  upstreamUnavailable?: boolean;
  message?: string;
  featureCollection?: FeatureCollection<Polygon>;
}

/**
 * Returns true when running on an origin that supports Vercel /api serverless routes
 * (i.e. not github.io static pages or file://).
 */
export function supportsServerlessCadastreApi(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (window.location.protocol === 'file:') return false;
  if (host.endsWith('.github.io')) return false;
  // Local vite dev/preview does not execute Vercel api/ functions unless vercel dev runs
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return true;
}

export interface StateCadastreTileConfig {
  mode: 'raster' | 'act-vector' | 'none';
  tileUrl?: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  opacity: number;
  attribution: string;
  authority: string;
}

/**
 * Returns the live cadastre overlay configuration for ANY of the 8 Australian states.
 * On Vercel, all 8 states render live official cadastre boundaries via /api/cadastre proxy
 * (or native CORS vector blocks for ACT). On static hosts, uses CORS-verified direct endpoints.
 */
export function getUniversalCadastreOverlayConfig(
  state: AustralianState,
  forceServerProxy?: boolean,
): StateCadastreTileConfig {
  const profile = AU_STATE_SPATIAL_REGISTRY[state];
  const useProxy = forceServerProxy ?? supportsServerlessCadastreApi();

  if (state === 'ACT') {
    return {
      mode: 'act-vector',
      tileSize: 256,
      minzoom: 14,
      maxzoom: 20,
      opacity: 0.82,
      attribution: profile.attribution,
      authority: profile.authority,
    };
  }

  if (useProxy) {
    const tileUrl =
      profile.vercelTileMode === 'xyz-tile'
        ? `/api/cadastre?action=tile&state=${state}&z={z}&x={x}&y={y}`
        : `/api/cadastre?action=tile&state=${state}&bbox={bbox-epsg-3857}`;
    return {
      mode: 'raster',
      tileUrl,
      tileSize: 256,
      minzoom: 13,
      maxzoom: 20,
      opacity: state === 'SA' ? 0.58 : 0.82,
      attribution: profile.attribution,
      authority: profile.authority,
    };
  }

  if (profile.directCorsTileUrl) {
    return {
      mode: 'raster',
      tileUrl: profile.directCorsTileUrl,
      tileSize: 256,
      minzoom: 13,
      maxzoom: 20,
      opacity: 0.8,
      attribution: profile.attribution,
      authority: profile.authority,
    };
  }

  return {
    mode: 'none',
    tileSize: 256,
    minzoom: 13,
    maxzoom: 20,
    opacity: 0.8,
    attribution: profile.attribution,
    authority: profile.authority,
  };
}

export function isWithinAustraliaBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -44.5 &&
    lat <= -9.0 &&
    lng >= 112.0 &&
    lng <= 155.0
  );
}

function normalizeMultiToPolygonFc(
  geometry: unknown,
  props: Record<string, unknown>,
): FeatureCollection<Polygon> | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  let ring: number[][] | null = null;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
    ring = g.coordinates[0] as number[][];
  } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    let bestLen = -1;
    for (const poly of g.coordinates) {
      if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length > bestLen) {
        bestLen = poly[0].length;
        ring = poly[0] as number[][];
      }
    }
  }
  if (!ring || ring.length < 4) return null;
  const closed =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'Polygon',
          coordinates: [closed],
        },
      },
    ],
  };
}

function estimateRingAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let meanLat = 0;
  for (const pt of ring) meanLat += pt[1] ?? 0;
  meanLat /= ring.length;
  const mLat = 111132.92;
  const mLng = 111319.49 * Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum +=
      ring[i][0] * mLng * (ring[i + 1][1] * mLat) -
      ring[i + 1][0] * mLng * (ring[i][1] * mLat);
  }
  return Math.round(Math.abs(sum) * 0.5);
}

/**
 * Direct CORS fallback for static hosts (VIC GeoServer WFS and ACT FeatureServer allow CORS *).
 */
async function tryDirectCorsParcelSnap(
  state: AustralianState,
  lat: number,
  lng: number,
  mgaEpsg: string,
): Promise<LegalParcelSnapResult | null> {
  try {
    if (state === 'VIC') {
      const cql = encodeURIComponent(`INTERSECTS(geom,SRID=4326;POINT(${lng} ${lat}))`);
      const url = `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:v_parcel_mp&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${cql}&count=4`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> }>;
      };
      const feats = json.features ?? [];
      const chosen =
        feats.find((f) => String(f.properties?.parcel_road ?? '').toUpperCase() !== 'Y') ??
        feats[0];
      const fc = normalizeMultiToPolygonFc(chosen?.geometry, {
        role: 'parcel-boundary',
        state: 'VIC',
      });
      if (chosen && fc) {
        const spi = String(chosen.properties?.parcel_spi ?? '').trim() || 'Vicmap Parcel';
        const areaSqm = estimateRingAreaSqm(fc.features[0].geometry.coordinates[0]);
        return {
          matched: true,
          state: 'VIC',
          mgaEpsg,
          authority: AU_STATE_SPATIAL_REGISTRY.VIC.authority,
          parcelId: spi,
          parcelLabel: spi,
          address: '',
          tenure: 'Vicmap Titled Parcel',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: fc,
        };
      }
    }

    if (state === 'ACT') {
      const where = encodeURIComponent("CURRENT_LIFECYCLE_STAGE='REGISTERED'");
      const url = `https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_BLOCKS/FeatureServer/0/query?geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&where=${where}&outFields=BLOCK_NUMBER,SECTION_NUMBER,DIVISION_NAME,ADDRESSES&returnGeometry=true&outSR=4326&f=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> }>;
      };
      const feat = json.features?.[0];
      const fc = normalizeMultiToPolygonFc(feat?.geometry, {
        role: 'parcel-boundary',
        state: 'ACT',
      });
      if (feat && fc) {
        const p = feat.properties ?? {};
        const parcelId = [
          p.BLOCK_NUMBER ? `Block ${String(p.BLOCK_NUMBER)}` : '',
          p.SECTION_NUMBER ? `Section ${String(p.SECTION_NUMBER)}` : '',
          p.DIVISION_NAME ? String(p.DIVISION_NAME) : '',
        ]
          .filter(Boolean)
          .join(' ') || 'ACT Block';
        const areaSqm = estimateRingAreaSqm(fc.features[0].geometry.coordinates[0]);
        return {
          matched: true,
          state: 'ACT',
          mgaEpsg,
          authority: AU_STATE_SPATIAL_REGISTRY.ACT.authority,
          parcelId,
          parcelLabel: parcelId,
          address: String(p.ADDRESSES ?? '').trim(),
          tenure: 'ACT Crown Lease Block',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: fc,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Universal 8-state 1-Tap Legal Parcel Snap.
 * Calls the Vercel /api/cadastre proxy (supporting NSW, VIC, QLD, WA, SA, TAS, ACT, NT),
 * with automatic direct-CORS fallback on static previews and clean error/outage handling.
 */
export async function snapLegalParcelAtPoint(
  lat: number,
  lng: number,
  explicitState?: AustralianState,
): Promise<LegalParcelSnapResult> {
  if (!isWithinAustraliaBounds(lat, lng)) {
    return {
      matched: false,
      state: explicitState ?? 'NSW',
      mgaEpsg: 'EPSG:7856',
      authority: 'Australian Spatial Registry',
      parcelId: '',
      parcelLabel: '',
      address: '',
      tenure: '',
      zoneName: '',
      areaSqm: 0,
      provenance: 'unavailable',
      message: 'Selected location is outside Australia. Tap inside Australia to snap a parcel.',
    };
  }

  const state: AustralianState = explicitState ?? detectAuStateFromCoords(lat, lng);
  const mga = wgs84ToMga2020(lng, lat);
  const profile = AU_STATE_SPATIAL_REGISTRY[state];

  if (supportsServerlessCadastreApi()) {
    try {
      const res = await fetch(
        `/api/cadastre?action=parcel&lat=${encodeURIComponent(lat.toFixed(6))}&lng=${encodeURIComponent(lng.toFixed(6))}&state=${state}`,
        { signal: AbortSignal.timeout(9500) },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          matched?: boolean;
          state?: AustralianState;
          authority?: string;
          parcelId?: string;
          parcelLabel?: string;
          address?: string;
          tenure?: string;
          zoneName?: string;
          areaSqm?: number;
          provenance?: LegalParcelSnapResult['provenance'];
          upstreamUnavailable?: boolean;
          message?: string;
          featureCollection?: FeatureCollection<Polygon>;
        };
        if (data.matched && data.featureCollection?.features?.length) {
          return {
            matched: true,
            state: data.state ?? state,
            mgaEpsg: mga.mgaEpsg,
            authority: data.authority || profile.authority,
            parcelId: data.parcelId || `${state} Parcel`,
            parcelLabel: data.parcelLabel || data.parcelId || `${state} Parcel`,
            address: data.address || '',
            tenure: data.tenure || `${state} Cadastre`,
            zoneName: data.zoneName || '',
            areaSqm: data.areaSqm || 0,
            provenance: data.provenance ?? 'live-state-cadastre',
            featureCollection: data.featureCollection,
          };
        }
        return {
          matched: false,
          state,
          mgaEpsg: mga.mgaEpsg,
          authority: data.authority || profile.authority,
          parcelId: '',
          parcelLabel: '',
          address: '',
          tenure: '',
          zoneName: data.zoneName || '',
          areaSqm: 0,
          provenance: 'unavailable',
          upstreamUnavailable: Boolean(data.upstreamUnavailable),
          message:
            data.message ||
            `No titled ${state} parcel matched this exact point. Tap inside a parcel or draw manually.`,
        };
      }
    } catch {
      return {
        matched: false,
        state,
        mgaEpsg: mga.mgaEpsg,
        authority: profile.authority,
        parcelId: '',
        parcelLabel: '',
        address: '',
        tenure: '',
        zoneName: '',
        areaSqm: 0,
        provenance: 'unavailable',
        upstreamUnavailable: true,
        message: `Could not reach the ${state} cadastre proxy right now. Retry or trace your site boundary manually.`,
      };
    }
  }

  // Static preview / local dev fallback: try direct CORS-enabled state WFS/FeatureServer first
  const directMatch = await tryDirectCorsParcelSnap(state, lat, lng, mga.mgaEpsg);
  if (directMatch) return directMatch;

  return {
    matched: false,
    state,
    mgaEpsg: mga.mgaEpsg,
    authority: profile.authority,
    parcelId: '',
    parcelLabel: '',
    address: '',
    tenure: '',
    zoneName: '',
    areaSqm: 0,
    provenance: 'screening-fallback',
    message: `Placed a calibrated screening parcel in ${state} (${mga.mgaEpsg}). Deploy on Vercel for live server-proxied ${state} legal lot boundaries, or use Polygon/Rectangle to refine.`,
  };
}

/**
 * Fetches live ACT cadastral block outlines (CORS-open) within the current viewport bounds
 * for native MapLibre vector rendering when viewing Canberra / ACT at zoom >= 14.
 */
export async function fetchActBlocksGeoJson(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): Promise<FeatureCollection<Polygon> | null> {
  try {
    const geom = encodeURIComponent(
      `${bounds.west.toFixed(5)},${bounds.south.toFixed(5)},${bounds.east.toFixed(5)},${bounds.north.toFixed(5)}`,
    );
    const where = encodeURIComponent("CURRENT_LIFECYCLE_STAGE='REGISTERED'");
    const url = `https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_BLOCKS/FeatureServer/0/query?geometry=${geom}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=${where}&outFields=BLOCK_NUMBER,SECTION_NUMBER,DIVISION_NAME&returnGeometry=true&outSR=4326&resultRecordCount=150&f=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const fc = (await res.json()) as FeatureCollection<Polygon>;
    return fc && fc.type === 'FeatureCollection' ? fc : null;
  } catch {
    return null;
  }
}
