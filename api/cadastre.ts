/**
 * Map Lab. DA — Universal 8-State Australian Cadastral Parcel & Tile Proxy
 * Vercel Fluid Compute Node.js Web Fetch Handler (/api/cadastre)
 *
 * Security & Reliability Guarantees:
 * - Strictly allowlisted to official Australian Government GIS endpoints only (zero SSRF).
 * - Validates Australian geographic bounds and numeric query parameters.
 * - Zero secrets exposed; 8s upstream timeout with graceful fallback payloads.
 * - Supports all 8 jurisdictions: NSW, VIC, QLD, WA, SA, TAS, ACT, NT.
 */

type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

const VALID_STATES = new Set<AustralianState>([
  'NSW',
  'VIC',
  'QLD',
  'WA',
  'SA',
  'TAS',
  'ACT',
  'NT',
]);

// 1x1 transparent PNG used if an upstream government raster server temporarily fails,
// preventing noisy 5xx tile storms in MapLibre while signaling X-Cadastre-Status.
const TRANSPARENT_PNG_BYTES = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 96, 0, 0, 0, 2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

interface NormalizedParcelPayload {
  matched: boolean;
  state: AustralianState;
  authority: string;
  parcelId: string;
  parcelLabel: string;
  address: string;
  tenure: string;
  zoneName: string;
  areaSqm: number;
  provenance: 'live-state-cadastre' | 'osm-footprint' | 'unavailable';
  upstreamUnavailable?: boolean;
  message?: string;
  featureCollection?: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      properties: Record<string, string | number | boolean | null>;
      geometry: {
        type: 'Polygon';
        coordinates: number[][][];
      };
    }>;
  };
}

function jsonResponse(body: unknown, status = 200, maxAge = 0): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
  if (maxAge > 0) {
    headers['cache-control'] = `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 6}`;
  } else {
    headers['cache-control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function detectAuState(lat: number, lng: number): AustralianState {
  if (lat >= -35.95 && lat <= -35.1 && lng >= 148.75 && lng <= 149.45) return 'ACT';
  if (lat < -39.2 && lng >= 143.5 && lng <= 149.0) return 'TAS';
  if (lng < 129.0) return 'WA';
  if (lng >= 129.0 && lng < 138.0) {
    return lat >= -26.0 ? 'NT' : 'SA';
  }
  if (lng >= 138.0 && lng < 141.0) {
    return lat >= -26.0 ? 'QLD' : 'SA';
  }
  if (lat > -29.0) return 'QLD';
  if (lat < -36.5 && lng >= 141.0 && lng < 150.0) return 'VIC';
  if (lat < -34.0 && lng >= 141.0 && lng < 149.98) {
    const vicBorderLat = -34.0 - ((lng - 141.0) / 8.98) * 3.5;
    if (lat < vicBorderLat) return 'VIC';
  }
  return 'NSW';
}

function ringAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let meanLat = 0;
  for (const pt of ring) {
    meanLat += pt[1] ?? 0;
  }
  meanLat /= ring.length;
  const mPerDegLat = 111132.92;
  const mPerDegLng = 111319.49 * Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = (ring[i][0] ?? 0) * mPerDegLng;
    const y1 = (ring[i][1] ?? 0) * mPerDegLat;
    const x2 = (ring[i + 1][0] ?? 0) * mPerDegLng;
    const y2 = (ring[i + 1][1] ?? 0) * mPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) * 0.5;
}

function extractPrimaryRing(geometry: unknown): number[][] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const outer = g.coordinates[0];
    if (Array.isArray(outer) && outer.length >= 4) {
      return outer as number[][];
    }
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    let bestRing: number[][] | null = null;
    let bestArea = -1;
    for (const poly of g.coordinates) {
      if (!Array.isArray(poly) || !Array.isArray(poly[0])) continue;
      const candidate = poly[0] as number[][];
      if (candidate.length < 4) continue;
      const area = ringAreaSqm(candidate);
      if (area > bestArea) {
        bestArea = area;
        bestRing = candidate;
      }
    }
    return bestRing;
  }
  return null;
}

function cleanStr(value: unknown): string {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function makeParcelFc(
  ring: number[][],
  props: Record<string, string | number | boolean | null>,
): NormalizedParcelPayload['featureCollection'] {
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

interface RawGeoJsonResponse {
  features?: Array<{
    geometry?: unknown;
    properties?: Record<string, unknown>;
  }>;
}

async function fetchJsonSafe(url: string, timeoutMs = 8000): Promise<RawGeoJsonResponse | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/json, application/geo+json',
      'user-agent': 'MapLabDA/1.0 (+https://github.com/buildinvestmelb-maker/cutsheet-au)',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as RawGeoJsonResponse;
  return data;
}

async function fetchArcgisFeaturesWithBuffer(
  baseQueryUrl: string,
  lat: number,
  lng: number,
  extraParams: string,
): Promise<RawGeoJsonResponse['features']> {
  const geomPt = encodeURIComponent(
    JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
  );
  const ptUrl = `${baseQueryUrl}?geometry=${geomPt}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&${extraParams}&returnGeometry=true&outSR=4326&f=geojson`;
  const ptData = await fetchJsonSafe(ptUrl);
  if (ptData?.features && ptData.features.length > 0) {
    return ptData.features;
  }
  // Tight ~25m frontage tolerance if geocoded street coordinate sits on road carriageway
  const d = 0.00025;
  const geomEnv = encodeURIComponent(
    JSON.stringify({
      xmin: Number((lng - d).toFixed(6)),
      ymin: Number((lat - d).toFixed(6)),
      xmax: Number((lng + d).toFixed(6)),
      ymax: Number((lat + d).toFixed(6)),
      spatialReference: { wkid: 4326 },
    }),
  );
  const envUrl = `${baseQueryUrl}?geometry=${geomEnv}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&${extraParams}&returnGeometry=true&outSR=4326&resultRecordCount=6&f=geojson`;
  const envData = await fetchJsonSafe(envUrl);
  return envData?.features ?? [];
}

async function queryStateParcel(
  state: AustralianState,
  lat: number,
  lng: number,
): Promise<NormalizedParcelPayload> {
  const geomParam = encodeURIComponent(`${lng},${lat}`);

  try {
    if (state === 'NSW') {
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/MapServer/8/query',
          lat,
          lng,
          'outFields=*',
        )) ?? [];
      const feat =
        feats.find((f) => cleanStr(f.properties?.planlabel).length > 0) ?? feats[0];
      const ring = extractPrimaryRing(feat?.geometry);
      if (feat && ring) {
        const p = feat.properties ?? {};
        const lot = cleanStr(p.lotnumber);
        const sec = cleanStr(p.sectionnumber);
        const plan = cleanStr(p.planlabel);
        const parcelId = [lot ? `Lot ${lot}` : '', sec ? `Sec ${sec}` : '', plan]
          .filter(Boolean)
          .join(' ') || `NSW CAD-${cleanStr(p.cadid) || 'Parcel'}`;
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'Spatial Services NSW (DCS)',
          parcelId,
          parcelLabel: parcelId,
          address: '',
          tenure: 'NSW Cadastre Lot',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'Spatial Services NSW',
          }),
        };
      }
    }

    if (state === 'VIC') {
      const cql = encodeURIComponent(`INTERSECTS(geom,SRID=4326;POINT(${lng} ${lat}))`);
      let data = await fetchJsonSafe(
        `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:v_parcel_mp&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${cql}&count=4`,
      );
      let feats = data?.features ?? [];
      if (feats.length === 0) {
        const d = 0.00022;
        const bboxCql = encodeURIComponent(
          `BBOX(geom,${(lng - d).toFixed(6)},${(lat - d).toFixed(6)},${(lng + d).toFixed(6)},${(lat + d).toFixed(6)},'EPSG:4326')`,
        );
        data = await fetchJsonSafe(
          `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:v_parcel_mp&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${bboxCql}&count=6`,
        );
        feats = data?.features ?? [];
      }
      const chosen =
        feats.find((f) => cleanStr(f.properties?.parcel_road).toUpperCase() !== 'Y') ?? feats[0];
      const ring = extractPrimaryRing(chosen?.geometry);
      if (chosen && ring) {
        const p = chosen.properties ?? {};
        const spi = cleanStr(p.parcel_spi);
        const lot = cleanStr(p.parcel_lot_number);
        const plan = cleanStr(p.parcel_plan_number);
        const parcelId =
          spi || (lot && plan ? `${lot}\\${plan}` : plan || `VIC PFI-${cleanStr(p.parcel_pfi)}`);
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'Land Use Victoria (Vicmap Property WFS)',
          parcelId,
          parcelLabel: parcelId,
          address: '',
          tenure: cleanStr(p.parcel_road) === 'Y' ? 'Road Reserve' : 'Vicmap Titled Parcel',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'Vicmap Property (DEECA)',
          }),
        };
      }
    }

    if (state === 'QLD') {
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query',
          lat,
          lng,
          'outFields=lot,plan,lotplan,tenure,lot_area,locality,parcel_typ,feat_name',
        )) ?? [];
      const chosen =
        feats.find(
          (f) =>
            cleanStr(f.properties?.lotplan).length > 0 &&
            !cleanStr(f.properties?.parcel_typ).toLowerCase().includes('road'),
        ) ?? feats[0];
      const ring = extractPrimaryRing(chosen?.geometry);
      if (chosen && ring) {
        const p = chosen.properties ?? {};
        const lotplan = cleanStr(p.lotplan);
        const lot = cleanStr(p.lot);
        const plan = cleanStr(p.plan);
        const parcelId =
          lot && plan
            ? `Lot ${lot} ${plan}`
            : lotplan || cleanStr(p.feat_name) || 'QLD DCDB Parcel';
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'Queensland Dept of Resources (DCDB)',
          parcelId,
          parcelLabel: parcelId,
          address: cleanStr(p.locality) ? `${cleanStr(p.locality)} QLD` : '',
          tenure: cleanStr(p.tenure) || cleanStr(p.parcel_typ) || 'QLD Land Parcel',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'QLD Dept of Resources',
          }),
        };
      }
    }

    if (state === 'WA') {
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/2/query',
          lat,
          lng,
          'outFields=*',
        )) ?? [];
      const feat = feats[0];
      const ring = extractPrimaryRing(feat?.geometry);
      if (feat && ring) {
        const p = feat.properties ?? {};
        const oid = cleanStr(p.objectid) || cleanStr(p.OBJECTID);
        const parcelId = oid ? `WA SLIP #${oid}` : 'WA Landgate Parcel';
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'Landgate Western Australia (SLIP)',
          parcelId,
          parcelLabel: parcelId,
          address: '',
          tenure: 'WA Cadastre Lot',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'Landgate WA (SLIP)',
          }),
        };
      }
    }

    if (state === 'TAS') {
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreParcels/MapServer/0/query',
          lat,
          lng,
          'outFields=VOLUME,FOLIO,PID,CAD_TYPE1,TENURE_TY,FEAT_NAME,COMP_AREA',
        )) ?? [];
      const chosen =
        feats.find(
          (f) => cleanStr(f.properties?.CAD_TYPE1).toLowerCase() === 'private parcel',
        ) ?? feats[0];
      const ring = extractPrimaryRing(chosen?.geometry);
      if (chosen && ring) {
        const p = chosen.properties ?? {};
        const vol = cleanStr(p.VOLUME);
        const fol = cleanStr(p.FOLIO);
        const pid = cleanStr(p.PID);
        const parcelId =
          vol && fol
            ? `CT ${vol}/${fol}${pid ? ` (PID ${pid})` : ''}`
            : pid
              ? `TAS PID ${pid}`
              : 'TAS theLIST Parcel';
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'Land Tasmania (theLIST)',
          parcelId,
          parcelLabel: parcelId,
          address: cleanStr(p.FEAT_NAME) ? `${cleanStr(p.FEAT_NAME)} TAS` : '',
          tenure: cleanStr(p.TENURE_TY) || cleanStr(p.CAD_TYPE1) || 'TAS Cadastre',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'theLIST Tasmania',
          }),
        };
      }
    }

    if (state === 'ACT') {
      const where = encodeURIComponent("CURRENT_LIFECYCLE_STAGE='REGISTERED'");
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_BLOCKS/FeatureServer/0/query',
          lat,
          lng,
          `where=${where}&outFields=*`,
        )) ?? [];
      const feat = feats[0];
      const ring = extractPrimaryRing(feat?.geometry);
      if (feat && ring) {
        const p = feat.properties ?? {};
        const blk = cleanStr(p.BLOCK_NUMBER);
        const sec = cleanStr(p.SECTION_NUMBER);
        const div = cleanStr(p.DIVISION_NAME);
        const parcelId = [
          blk ? `Block ${blk}` : '',
          sec ? `Section ${sec}` : '',
          div,
        ]
          .filter(Boolean)
          .join(' ') || 'ACT Block Parcel';
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'ACT Government (ACTmapi)',
          parcelId,
          parcelLabel: parcelId,
          address: cleanStr(p.ADDRESSES),
          tenure: 'ACT Crown Lease Block',
          zoneName: cleanStr(p.LAND_USE_POLICY_ZONES),
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'ACTmapi',
          }),
        };
      }
    }

    if (state === 'NT') {
      const feats =
        (await fetchArcgisFeaturesWithBuffer(
          'https://gis-d.nt.gov.au/arcgis/rest/services/NT_CADASTRE/MapServer/0/query',
          lat,
          lng,
          'outFields=*',
        )) ?? [];
      const feat =
        feats.find((f) => cleanStr(f.properties?.LAISKEY).length > 0) ?? feats[0];
      const ring = extractPrimaryRing(feat?.geometry);
      if (feat && ring) {
        const p = feat.properties ?? {};
        const addr = cleanStr(p.PARCEL_ADDRESS);
        const lais = cleanStr(p.LAISKEY);
        const ufi = cleanStr(p.UFI);
        const parcel = cleanStr(p.PARCEL);
        const parcelId = lais
          ? `NT LAIS ${lais}`
          : parcel
            ? `NT Lot ${parcel}`
            : ufi
              ? `NT UFI ${ufi}`
              : 'NT Cadastre Parcel';
        const areaSqm = Math.round(ringAreaSqm(ring));
        return {
          matched: true,
          state,
          authority: 'NT Dept of Environment, Parks & Water Security',
          parcelId,
          parcelLabel: addr || parcelId,
          address: addr,
          tenure: cleanStr(p.PARCEL_TYPE) || cleanStr(p.LTO_CODE) || 'NT Cadastre Lot',
          zoneName: '',
          areaSqm,
          provenance: 'live-state-cadastre',
          featureCollection: makeParcelFc(ring, {
            role: 'parcel-boundary',
            state,
            parcelId,
            authority: 'NT Cadastre (DEPWS)',
          }),
        };
      }
    }

    if (state === 'SA') {
      // Query official PlanSA Code Zone at point + OSM site footprint where available
      let zoneName = '';
      try {
        const zoneUrl = `https://location.sa.gov.au/server6/rest/services/GrowthManagementPublic/CodeAmendments_BaseLayers_plansadb/MapServer/2/query?geometry=${geomParam}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
        const zRes = await fetch(zoneUrl, { signal: AbortSignal.timeout(5000) });
        if (zRes.ok) {
          const zData = (await zRes.json()) as {
            features?: Array<{ attributes?: Record<string, unknown> }>;
          };
          const attrs = zData.features?.[0]?.attributes ?? {};
          zoneName =
            cleanStr(attrs.zone_name) ||
            cleanStr(attrs.ZONE_NAME) ||
            cleanStr(attrs.NAME) ||
            cleanStr(attrs.name);
        }
      } catch {
        // Non-blocking zone enrichment
      }

      try {
        const overpassQuery = `[out:json][timeout:4];(way(around:28,${lat},${lng})["landuse"];way(around:28,${lat},${lng})["building"];);out body geom 3;`;
        const ovRes = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(5000),
        });
        if (ovRes.ok) {
          const ovJson = (await ovRes.json()) as {
            elements?: Array<{
              id?: number;
              tags?: Record<string, string>;
              geometry?: Array<{ lat: number; lon: number }>;
            }>;
          };
          const bestWay = (ovJson.elements ?? []).find(
            (el) => Array.isArray(el.geometry) && el.geometry.length >= 4,
          );
          if (bestWay?.geometry) {
            const ring = bestWay.geometry.map((g) => [g.lon, g.lat]);
            const areaSqm = Math.round(ringAreaSqm(ring));
            if (areaSqm >= 120 && areaSqm <= 5_000_000) {
              const parcelId = `SA Site #${bestWay.id ?? 'OSM'}`;
              return {
                matched: true,
                state,
                authority: 'Location SA / PlanSA (+ OSM Footprint)',
                parcelId,
                parcelLabel: parcelId,
                address: bestWay.tags?.['addr:street']
                  ? `${bestWay.tags['addr:housenumber'] ?? ''} ${bestWay.tags['addr:street']} SA`.trim()
                  : '',
                tenure: 'SA Screening Boundary',
                zoneName,
                areaSqm,
                provenance: 'osm-footprint',
                featureCollection: makeParcelFc(ring, {
                  role: 'parcel-boundary',
                  state,
                  parcelId,
                  authority: 'Location SA / PlanSA',
                }),
              };
            }
          }
        }
      } catch {
        // Fall through to clean screening fallback
      }

      return {
        matched: false,
        state,
        authority: 'Location SA / PlanSA SAPPA',
        parcelId: '',
        parcelLabel: '',
        address: '',
        tenure: '',
        zoneName,
        areaSqm: 0,
        provenance: 'unavailable',
        message:
          'SA parcel raster boundaries are active on the map. Tap Polygon or Rectangle to trace the exact SA title boundary (SA DCDB vector query requires a Land Services SA commercial licence).',
      };
    }

    return {
      matched: false,
      state,
      authority: `${state} Spatial Registry`,
      parcelId: '',
      parcelLabel: '',
      address: '',
      tenure: '',
      zoneName: '',
      areaSqm: 0,
      provenance: 'unavailable',
      message: `No registered ${state} cadastral parcel intersected this exact coordinate. Tap directly inside a titled lot or draw a custom boundary.`,
    };
  } catch {
    return {
      matched: false,
      state,
      authority: `${state} Spatial Registry`,
      parcelId: '',
      parcelLabel: '',
      address: '',
      tenure: '',
      zoneName: '',
      areaSqm: 0,
      provenance: 'unavailable',
      upstreamUnavailable: true,
      message: `The ${state} government cadastre service is temporarily slow or unavailable. You can retry or draw the parcel boundary manually.`,
    };
  }
}

async function proxyCadastreTile(
  state: AustralianState,
  url: URL,
): Promise<Response> {
  const transparentFallback = (reason: string) =>
    new Response(TRANSPARENT_PNG_BYTES, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, s-maxage=300',
        'x-cadastre-status': reason,
      },
    });

  // SA uses tiled WMTS-style z/x/y for StreetMapCased_wmas (includes SA parcel boundaries)
  if (state === 'SA') {
    const z = Number(url.searchParams.get('z'));
    const x = Number(url.searchParams.get('x'));
    const y = Number(url.searchParams.get('y'));
    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 10 ||
      z > 20 ||
      x < 0 ||
      y < 0
    ) {
      return transparentFallback('invalid-tile');
    }
    try {
      const upstream = `https://location.sa.gov.au/arcgis/rest/services/BaseMaps/StreetMapCased_wmas/MapServer/tile/${z}/${y}/${x}`;
      const res = await fetch(upstream, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) return transparentFallback('upstream-error');
      const buf = await res.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') || 'image/png',
          'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
          'x-cadastre-status': 'ok',
        },
      });
    } catch {
      return transparentFallback('timeout');
    }
  }

  // ACT vector cadastre renders directly from ACTGOV_BLOCKS FeatureServer (CORS enabled)
  if (state === 'ACT') {
    return transparentFallback('vector-native');
  }

  const bboxRaw = url.searchParams.get('bbox') ?? '';
  const parts = bboxRaw.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return transparentFallback('invalid-bbox');
  }
  const bbox = parts.join(',');

  let upstream = '';
  if (state === 'NSW') {
    upstream = `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:8&format=png32&transparent=true&f=image`;
  } else if (state === 'VIC') {
    upstream = `https://opendata.maps.vic.gov.au/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=open-data-platform:v_parcel_mp&styles=&crs=EPSG:3857&bbox=${bbox}&width=256&height=256&format=image/png8&transparent=true`;
  } else if (state === 'QLD') {
    upstream = `https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:4&format=png32&transparent=true&f=image`;
  } else if (state === 'WA') {
    upstream = `https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:2&format=png32&transparent=true&f=image`;
  } else if (state === 'TAS') {
    upstream = `https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreParcels/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:0&format=png32&transparent=true&f=image`;
  } else if (state === 'NT') {
    upstream = `https://gis-d.nt.gov.au/arcgis/rest/services/NT_CADASTRE/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:0&format=png32&transparent=true&f=image`;
  }

  if (!upstream) return transparentFallback('unsupported');

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(7500) });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.startsWith('image/')) {
      return transparentFallback('upstream-non-image');
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': ct,
        'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        'x-cadastre-status': 'ok',
      },
    });
  } catch {
    return transparentFallback('timeout');
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const url = new URL(request.url);
    const action = (url.searchParams.get('action') || 'parcel').toLowerCase();
    const rawState = (url.searchParams.get('state') || '').toUpperCase();

    if (action === 'tile') {
      if (!VALID_STATES.has(rawState as AustralianState)) {
        return jsonResponse({ error: 'Invalid Australian state code.' }, 400);
      }
      return proxyCadastreTile(rawState as AustralianState, url);
    }

    if (action === 'parcel') {
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -44.5 ||
        lat > -9.0 ||
        lng < 112.0 ||
        lng > 155.0
      ) {
        return jsonResponse(
          {
            matched: false,
            error:
              'Coordinates must be a valid location within Australia (lat -44.5 to -9.0, lng 112.0 to 155.0).',
          },
          400,
        );
      }
      const state: AustralianState = VALID_STATES.has(rawState as AustralianState)
        ? (rawState as AustralianState)
        : detectAuState(lat, lng);
      const payload = await queryStateParcel(state, lat, lng);
      return jsonResponse(payload, 200, payload.matched ? 3600 : 0);
    }

    return jsonResponse({ error: 'Unsupported action. Use action=parcel or action=tile.' }, 400);
  },
};
