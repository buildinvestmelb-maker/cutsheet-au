import type { FeatureCollection, GeoJsonObject } from 'geojson';

export type AustralianState =
  | 'NSW'
  | 'VIC'
  | 'QLD'
  | 'WA'
  | 'SA'
  | 'TAS'
  | 'ACT'
  | 'NT';

export type ParcelIdScheme = 'lot-dp' | 'spi' | 'lot-plan' | 'ct' | 'gnaf';

export interface Mga2020Zone {
  mgaZone: number;
  mgaEpsg: string;
}

const DEFAULT_AU_LNG = 151.2093;

export const FORBIDDEN_OBJECT_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function isForbiddenObjectKey(key: string): boolean {
  return FORBIDDEN_OBJECT_KEYS.has(key);
}

/**
 * Computes the Australian Map Grid of Australia 2020 (GDA2020 / MGA2020) zone
 * and corresponding EPSG code (Zones 49–56 / EPSG:7849–EPSG:7856) from WGS84/GDA2020 longitude.
 * Non-finite inputs safely fall back to Sydney (151.2093 -> Zone 56 / EPSG:7856).
 */
export function getMga2020FromLng(lng: number): Mga2020Zone {
  const safeLng = Number.isFinite(lng) ? lng : DEFAULT_AU_LNG;
  const rawZone = Math.floor((safeLng + 180) / 6) + 1;
  const mgaZone = Math.min(56, Math.max(49, rawZone));
  return {
    mgaZone,
    mgaEpsg: `EPSG:${7800 + mgaZone}`,
  };
}

export interface SiteLocation {
  address?: string;
  lga?: string;
  state: AustralianState;
  lat: number;
  lng: number;
  mgaZone: number;
  mgaEpsg: string;
}

export interface SiteGeometry {
  parcelId?: string;
  parcelIdScheme?: ParcelIdScheme;
  boundaryGeoJson?: FeatureCollection | GeoJsonObject;
  exclusionMasksGeoJson?: FeatureCollection | GeoJsonObject;
  grossAreaSqm?: number;
  netDevelopableAreaSqm?: number;
}

export interface GradingPadSpec {
  id: string;
  name: string;
  targetFflAHD: number;
  slopePct: number;
  batterSlopeRatio: number;
  boundaryGeoJson?: FeatureCollection;
}

export interface UnitMixSpec {
  studio: number;
  oneBed: number;
  twoBed: number;
  threeBed: number;
}

export interface SiteEarthworks {
  cutVolumeM3?: number;
  fillVolumeM3?: number;
  netBalanceM3?: number;
  importExportVolumeM3?: number;
  bulkEarthworksCostAud?: number;
  retainingWallLengthM?: number;
  retainingWallCostAud?: number;
  civilAllowanceAud?: number;
  finishedFloorLevelAHD?: number;
  updatedByApp?: string;
  demSource?: 'terrarium' | 'geotiff' | 'survey-csv' | 'synthetic';
  soilClass?: 'sand' | 'clay' | 'rock';
  retainingWallHeightM?: number;
  cutSwellFactor?: number;
  fillCompactionFactor?: number;
  batterSlopeRatio?: number;
  gradingPads?: GradingPadSpec[];
  avgExistingElevationAHD?: number;
}

export interface SiteMassing {
  lotYield?: number;
  dwellingYield?: number;
  grossFloorAreaSqm?: number;
  netSaleableAreaSqm?: number;
  siteCoveragePct?: number;
  maxHeightM?: number;
  fsr?: number;
  storeys?: number;
  zoningCode?: string;
  typology?: 'subdivision' | 'apartments' | 'townhouses';
  frontSetbackM?: number;
  sideSetbackM?: number;
  rearSetbackM?: number;
  parkingBays?: number;
  unitMix?: UnitMixSpec;
  generatedLotsGeoJson?: FeatureCollection;
  buildingEnvelopesGeoJson?: FeatureCollection;
  winterSolsticeSunPct?: number;
  efficiencyPct?: number;
}

export interface SiteEnvironment {
  bushfireAttackLevel?:
    | 'BAL-LOW'
    | 'BAL-12.5'
    | 'BAL-19'
    | 'BAL-29'
    | 'BAL-40'
    | 'BAL-FZ';
  floodOverlay?: boolean;
  biodiversityOffsetHa?: number;
  solarExposureHrs?: number;
  windRegion?: 'A' | 'B' | 'C' | 'D';
  climateZone?: string;
  ffdi?: number;
  vegetationClass?: string;
  effectiveSlopeDeg?: number;
  apzDistanceM?: number;
  floodBufferM?: number;
  balUpliftPerDwellingAud?: number;
  envCostAllowanceAud?: number;
  hazardPolygonsGeoJson?: FeatureCollection;
  balContoursGeoJson?: FeatureCollection;
}

export interface SiteFeasibility {
  grossRealisationAud?: number;
  totalDevelopmentCostAud?: number;
  constructionCostPerSqmAud?: number;
  statutoryContributionsAud?: number;
  stampDutyRatePct?: number;
  targetMarginPct?: number;
  residualLandValueAud?: number;
  rlvPerSqmAud?: number;
  profitOnCostPct?: number;
  gstScheme?: 'margin-scheme' | 'full-gst';
  projectMonths?: number;
  preDevMonths?: number;
  constructionMonths?: number;
  settlementMonths?: number;
  debtLvrPct?: number;
  interestRatePct?: number;
  lineFeePct?: number;
  establishmentFeePct?: number;
  buyerType?: 'domestic' | 'foreign';
  propertyClass?: 'residential' | 'commercial';
  dutyMode?: 'statutory-progressive' | 'custom-rate';
  irrPct?: number;
  npvAud?: number;
  peakDebtAud?: number;
  equityMultiple?: number;
  calculatedDutyAud?: number;
  hurdleRatePct?: number;
  landAcquisitionAud?: number;
}

export interface SiteProject {
  projectId: string;
  name: string;
  updatedAt: string;
  location: SiteLocation;
  geometry: SiteGeometry;
  earthworks?: SiteEarthworks;
  massing?: SiteMassing;
  environment?: SiteEnvironment;
  feasibility?: SiteFeasibility;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends Array<unknown>
      ? T[K]
      : DeepPartial<T[K]>
    : T[K];
};

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export type ChildToHostMessage =
  | {
      type: 'APP_READY';
      appId?: string;
      version?: string;
    }
  | {
      type: 'APP_FOCUS';
      appId?: string;
    }
  | {
      type: 'OPEN_APP';
      appId: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'PROJECT_PATCH';
      patch: DeepPartial<SiteProject>;
      sourceAppId?: string;
    }
  | {
      type: 'NOTIFY';
      level?: ToastLevel;
      title: string;
      message?: string;
    };

export type HostToChildMessage =
  | {
      type: 'OS_INIT';
      theme: 'dark';
      project: SiteProject;
      active: boolean;
      appId: string;
      windowId: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'OS_PROJECT_SYNC';
      project: SiteProject;
      sourceAppId?: string;
      updatedAt: string;
    }
  | {
      type: 'OS_RENDER_STATE';
      active: boolean;
      reason?: 'focus' | 'blur' | 'minimize' | 'restore' | 'init';
    };

export const CHILD_TO_HOST_MESSAGE_TYPES = [
  'APP_READY',
  'APP_FOCUS',
  'OPEN_APP',
  'PROJECT_PATCH',
  'NOTIFY',
] as const;

export function isChildToHostMessage(data: unknown): data is ChildToHostMessage {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.type !== 'string') return false;

  switch (candidate.type) {
    case 'APP_READY':
    case 'APP_FOCUS':
      return true;
    case 'OPEN_APP':
      return typeof candidate.appId === 'string' && candidate.appId.length > 0;
    case 'PROJECT_PATCH':
      return Boolean(
        candidate.patch &&
          typeof candidate.patch === 'object' &&
          !Array.isArray(candidate.patch),
      );
    case 'NOTIFY':
      return typeof candidate.title === 'string' && candidate.title.length > 0;
    default:
      return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeUnknownValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeUnknownValue(item))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isForbiddenObjectKey(key) || nested === undefined) continue;
      const sanitizedNested = sanitizeUnknownValue(nested);
      if (sanitizedNested !== undefined) {
        clean[key] = sanitizedNested;
      }
    }
    return clean;
  }
  return value;
}

const ATOMIC_REPLACEMENT_KEYS: ReadonlySet<string> = new Set([
  'boundaryGeoJson',
  'exclusionMasksGeoJson',
  'generatedLotsGeoJson',
  'buildingEnvelopesGeoJson',
  'hazardPolygonsGeoJson',
  'balContoursGeoJson',
  'gradingPads',
]);

function deepMergeRecord<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isForbiddenObjectKey(key)) continue;
    if (value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;

    // Treat GeoJSON payloads and grading pad lists as atomic replacements rather than merging coordinates
    if (ATOMIC_REPLACEMENT_KEYS.has(key)) {
      const cleanPayload = sanitizeUnknownValue(value);
      if (cleanPayload !== undefined) {
        result[key] = cleanPayload;
      }
      continue;
    }

    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeRecord(existing, value);
    } else if (isPlainObject(value)) {
      const cleanNested = sanitizeUnknownValue(value);
      if (isPlainObject(cleanNested) && Object.keys(cleanNested).length > 0) {
        result[key] = cleanNested;
      }
    } else if (Array.isArray(value)) {
      result[key] = sanitizeUnknownValue(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Deep-merges a partial project patch into the active SiteProject.
 * Defends against prototype pollution, drops non-finite numbers (NaN/Infinity),
 * and automatically recomputes MGA2020 zone/EPSG if location.lng changes.
 */
export function mergeSiteProject(
  base: SiteProject,
  patch: DeepPartial<SiteProject>,
  nowIso: string = new Date().toISOString(),
): SiteProject {
  const safePatch = isPlainObject(patch)
    ? (patch as Record<string, unknown>)
    : {};

  const merged = deepMergeRecord(
    base as unknown as Record<string, unknown>,
    safePatch,
  ) as unknown as SiteProject;

  const patchLoc = isPlainObject(safePatch.location)
    ? (safePatch.location as Record<string, unknown>)
    : undefined;

  if (
    patchLoc &&
    typeof patchLoc.lng === 'number' &&
    Number.isFinite(patchLoc.lng) &&
    (patchLoc.mgaZone === undefined ||
      (typeof patchLoc.mgaZone === 'number' && !Number.isFinite(patchLoc.mgaZone))) &&
    patchLoc.mgaEpsg === undefined
  ) {
    const mga = getMga2020FromLng(patchLoc.lng);
    merged.location = {
      ...merged.location,
      mgaZone: mga.mgaZone,
      mgaEpsg: mga.mgaEpsg,
    };
  }

  const nextUpdatedAt =
    typeof patch.updatedAt === 'string' && patch.updatedAt.trim().length > 0
      ? patch.updatedAt
      : nowIso;

  return {
    ...merged,
    updatedAt: nextUpdatedAt,
  };
}
