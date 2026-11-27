import type { FeatureCollection, Polygon } from 'geojson';
import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  Compass,
  Crosshair,
  Download,
  Droplets,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Flame,
  FolderOpen,
  Globe,
  Landmark,
  Layers,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Mountain,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Pentagon,
  Pin,
  Play,
  RotateCcw,
  Search,
  Send,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  TrendingUp,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  getMga2020FromLng,
  type AustralianState,
  type SiteEarthworks,
  type SiteProject,
} from '../../bridge/types';
import {
  listPrivateDeals,
  loadActiveSession,
  loadPrivateDealById,
  savePrivateDeal,
  type MapLabUserSession,
  type SavedMapLabDeal,
} from '../../data/cloudDealStore';
import {
  BAL_BENCHMARKS,
  computeMapLabDealIntelligence,
  createDefaultDealFinancialInputs,
  optimizeGradingForMaxRlv,
  validateNonNegativeNumber,
  type BalRating,
  type DealFinancialInputs,
  type EnvironmentalConstraintInputs,
  type RlvOptimizationResult,
} from '../../engines/deal/mapLabIntelligenceEngine';
import {
  buildCutSheetPdfBlob,
  buildEarthworksBoqCsv,
  buildEarthworksContoursDxf,
  buildEarthworksGeoJson,
  buildLandXmlSurface,
  buildSurfaceXyzCsv,
} from '../../engines/earthworks/civilExports';
import { generateElevationContours } from '../../engines/earthworks/contourGenerator';
import {
  buildSyntheticAustralianDem,
  loadTerrariumDemForBounds,
  parseGeoTiffDem,
  parseSurveyCsvDem,
  type DemSourceType,
  type ElevationGrid,
} from '../../engines/earthworks/demLoader';
import {
  DEFAULT_ROCK_BREAKOUT_RATE_AUD,
  RETAINING_WALL_HEIGHT_RATES,
  SOIL_RATES_AUD,
  TIPPER_TRUCK_CAPACITY_M3,
  computeGridEarthworks,
  getRetainingWallRatePerLm,
  optimizeZeroBalanceFfl,
  sampleSectionProfile,
  type CivilRateOverrides,
  type EarthworksGridResult,
  type GradingStrategy,
  type SoilClass,
} from '../../engines/earthworks/gridVolumeEngine';
import {
  analyzeTerrainHydrology,
  renderTerrainLensDataUrl,
  type HydrologyAnalysisResult,
  type TerrainLensMode,
} from '../../engines/earthworks/hydrologyEngine';
import {
  computePolygonMetrics,
  createRectPolygonFeatureCollection,
  extractPrimaryPolygon,
  isWithinAustralianBounds,
  searchAustralianAddresses,
  type AuGeocodedAddress,
  type MapBasemapMode,
} from '../../engines/geo/auGeoKernel';
import {
  ALL_8_AU_CAPITALS,
  AU_STATE_SPATIAL_REGISTRY,
  isWithinAustraliaBounds,
  snapLegalParcelAtPoint,
  type AuStateSpatialProfile,
} from '../../engines/geo/auParcelClient';
import { AppShellFrame } from '../shared/AppShellFrame';
import {
  downloadBlobFile,
  downloadTextFile,
  slugifyFilename,
} from '../shared/downloadFile';
import { useOsBridge } from '../shared/useOsBridge';
import { DealIntelligencePanel } from './DealIntelligencePanel';
import { DealVaultDrawer } from './DealVaultDrawer';
import { SectionProfileChart } from './SectionProfileChart';
import { TerrainMap2D, type CutSheetCadTool } from './TerrainMap2D';
import { TerrainViewport3D } from './TerrainViewport3D';

type InspectorTab = 'deal-rlv' | 'cut-cost' | 'terrain' | 'plan-flow';
type MainViewportMode = 'map' | '3d-studio';
type VolumeMode = 'dem' | 'manual';
type MobileSheetMode = 'split' | 'map' | 'inspector';

const STATE_PLANNING_AUTHORITY: Readonly<Record<AustralianState, string>> = {
  NSW: AU_STATE_SPATIAL_REGISTRY.NSW.authority,
  VIC: AU_STATE_SPATIAL_REGISTRY.VIC.authority,
  QLD: AU_STATE_SPATIAL_REGISTRY.QLD.authority,
  WA: AU_STATE_SPATIAL_REGISTRY.WA.authority,
  SA: AU_STATE_SPATIAL_REGISTRY.SA.authority,
  TAS: AU_STATE_SPATIAL_REGISTRY.TAS.authority,
  ACT: AU_STATE_SPATIAL_REGISTRY.ACT.authority,
  NT: AU_STATE_SPATIAL_REGISTRY.NT.authority,
};

const STATE_DEFAULT_FFL: Readonly<Record<AustralianState, number>> = {
  NSW: 62.0,
  VIC: 185.0,
  QLD: 46.5,
  WA: 24.0,
  SA: 14.5,
  TAS: 68.0,
  ACT: 615.0,
  NT: 28.0,
};

const STATE_DEFAULT_SOIL: Readonly<Record<AustralianState, SoilClass>> = {
  NSW: 'clay',
  VIC: 'clay',
  QLD: 'clay',
  WA: 'sand',
  SA: 'clay',
  TAS: 'rock',
  ACT: 'clay',
  NT: 'sand',
};

const STATE_DEFAULT_RELIEF_M: Readonly<Record<AustralianState, number>> = {
  NSW: 4.6,
  VIC: 3.9,
  QLD: 5.1,
  WA: 3.4,
  SA: 2.6,
  TAS: 7.4,
  ACT: 4.2,
  NT: 2.8,
};

const STRATEGY_OPTIONS: ReadonlyArray<{
  id: GradingStrategy;
  label: string;
  shortDesc: string;
}> = [
  { id: 'best-fit-plane', label: 'Best-Fit Plane', shortDesc: 'OLS optimal plane' },
  { id: 'auto-terrace', label: 'Auto-Terrace', shortDesc: 'Stepped civil pads' },
  { id: 'max-grade', label: 'Max Grade %', shortDesc: 'Slope-clamped DTM' },
  { id: 'flat-pad', label: 'Flat Pad (0%)', shortDesc: 'Uniform datum FFL' },
];

const CONTOUR_INTERVALS = [0.5, 1.0, 2.0, 5.0] as const;

const AUD_FORMAT = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const NUM_FORMAT = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 0,
});

function formatAud(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return AUD_FORMAT.format(Math.round(value));
}

function formatCompactAud(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return NUM_FORMAT.format(Math.round(value));
}

function roundTwo(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function hasEarthworksSlice(project: SiteProject | null): boolean {
  if (!project?.earthworks || typeof project.earthworks !== 'object') {
    return false;
  }
  const ew = project.earthworks;
  return (
    (typeof ew.cutVolumeM3 === 'number' && Number.isFinite(ew.cutVolumeM3)) ||
    (typeof ew.fillVolumeM3 === 'number' && Number.isFinite(ew.fillVolumeM3)) ||
    (typeof ew.finishedFloorLevelAHD === 'number' &&
      Number.isFinite(ew.finishedFloorLevelAHD))
  );
}

function getDemProvenanceLabel(source: DemSourceType): string {
  switch (source) {
    case 'terrarium':
      return 'Live AWS Terrarium DEM';
    case 'geotiff':
      return 'ELVIS / GeoTIFF DEM';
    case 'survey-csv':
      return 'Survey CSV DTM';
    case 'synthetic':
      return 'Local Terrain DTM';
  }
}

function inferAuStateFromLngLat(lng: number, lat: number): AustralianState {
  if (lng < 129) return 'WA';
  if (lat > -26 && lng >= 129 && lng < 138) return 'NT';
  if (lng >= 129 && lng < 141 && lat <= -26) return 'SA';
  if (lat > -29 && lng >= 138) return 'QLD';
  if (lat < -39.5) return 'TAS';
  if (lat < -34.8 && lat > -35.95 && lng > 148.7 && lng < 149.45) return 'ACT';
  if (lat < -36.5 && lng >= 141 && lng < 150) return 'VIC';
  return 'NSW';
}

function resolveEffectiveBoundary(project: SiteProject): FeatureCollection {
  const existing = extractPrimaryPolygon(project.geometry?.boundaryGeoJson);
  if (existing) {
    return {
      type: 'FeatureCollection',
      features: [existing],
    };
  }
  const areaSqm =
    typeof project.geometry?.grossAreaSqm === 'number' &&
    Number.isFinite(project.geometry.grossAreaSqm) &&
    project.geometry.grossAreaSqm > 100
      ? project.geometry.grossAreaSqm
      : 40_000;
  const sideM = Math.max(40, Math.sqrt(areaSqm));
  return createRectPolygonFeatureCollection(
    project.location.lat,
    project.location.lng,
    sideM * 1.15,
    sideM / 1.15,
  );
}

function padWgs84Bounds(
  bbox: [number, number, number, number],
  padFrac = 0.14,
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const dLng = Math.max(0.00025, (maxLng - minLng) * padFrac);
  const dLat = Math.max(0.00025, (maxLat - minLat) * padFrac);
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
}

function getDefaultTransect(
  bbox: [number, number, number, number],
): [[number, number], [number, number]] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const padLng = (maxLng - minLng) * 0.04;
  const padLat = (maxLat - minLat) * 0.04;
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
}

function buildBaselineSyntheticDem(
  project: SiteProject,
  boundary: FeatureCollection,
  overrideBaseAHD?: number,
): ElevationGrid {
  const { bbox } = computePolygonMetrics(boundary);
  const demBounds = padWgs84Bounds(bbox, 0.14);
  const state = project.location.state;
  const baseAHD =
    typeof overrideBaseAHD === 'number' && Number.isFinite(overrideBaseAHD)
      ? overrideBaseAHD
      : typeof project.earthworks?.avgExistingElevationAHD === 'number' &&
          Number.isFinite(project.earthworks.avgExistingElevationAHD)
        ? project.earthworks.avgExistingElevationAHD
        : typeof project.earthworks?.finishedFloorLevelAHD === 'number' &&
            Number.isFinite(project.earthworks.finishedFloorLevelAHD)
          ? project.earthworks.finishedFloorLevelAHD
          : (STATE_DEFAULT_FFL[state] ?? 45.0);
  const reliefM = STATE_DEFAULT_RELIEF_M[state] ?? 4.5;
  return buildSyntheticAustralianDem(demBounds, baseAHD, reliefM, 36);
}

function parseStrictFiniteNumber(
  raw: string,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: `${label} is required.` };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { ok: false, error: `${label} must be a valid finite number.` };
  }
  if (num < min || num > max) {
    return {
      ok: false,
      error: `${label} must be between ${formatNum(min)} and ${formatNum(max)}.`,
    };
  }
  return { ok: true, value: num };
}

function parseLatLngQuery(raw: string): { lat: number; lng: number } | null {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Detect lat, lng (AU lat is -45..-8, lng is 110..160)
  if (isWithinAustralianBounds(b, a)) return { lat: a, lng: b };
  if (isWithinAustralianBounds(a, b)) return { lat: b, lng: a };
  return null;
}

interface SharedSiteHashState {
  lat: number;
  lng: number;
  ring?: Array<[number, number]>;
  strategy?: GradingStrategy;
  ratio?: number;
  lens?: TerrainLensMode;
}

function encodeSiteHash(payload: SharedSiteHashState): string {
  try {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) {
      bin += String.fromCharCode(bytes[i]);
    }
    return `#site=${encodeURIComponent(btoa(bin))}`;
  } catch {
    return '';
  }
}

function decodeSiteHash(hash: string): SharedSiteHashState | null {
  if (!hash || !hash.startsWith('#site=')) return null;
  try {
    const raw = decodeURIComponent(hash.slice('#site='.length));
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<SharedSiteHashState>;
    if (
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      isWithinAustralianBounds(parsed.lng, parsed.lat)
    ) {
      return parsed as SharedSiteHashState;
    }
    return null;
  } catch {
    return null;
  }
}

function applyManualVolumeOverride(
  base: EarthworksGridResult,
  cutVolumeM3: number,
  fillVolumeM3: number,
  retainingWallLengthM: number,
  retainingWallHeightM: number,
  customRates?: CivilRateOverrides,
): EarthworksGridResult {
  const rates = SOIL_RATES_AUD[base.soilClass];
  const cutRate = customRates?.cutRate ?? rates.cutRate;
  const fillRate = customRates?.fillRate ?? rates.fillRate;
  const haulRate = customRates?.haulRate ?? rates.haulRate;
  const importRate = customRates?.importRate ?? rates.importRate;
  const rockRate = customRates?.rockBreakoutRate ?? DEFAULT_ROCK_BREAKOUT_RATE_AUD;

  const safeCut = Math.max(0, cutVolumeM3);
  const safeFill = Math.max(0, fillVolumeM3);
  const safeRetLen = Math.max(0, retainingWallLengthM);
  const compactedCutM3 = safeCut * base.fillCompactionFactor;
  const looseCutVolumeM3 = safeCut * base.cutSwellFactor;
  const netBalanceM3 = compactedCutM3 - safeFill;
  const importExportVolumeM3 = Math.abs(netBalanceM3);
  const balanceDirection: EarthworksGridResult['balanceDirection'] =
    importExportVolumeM3 < 10
      ? 'balanced'
      : netBalanceM3 > 0
        ? 'export'
        : 'import';

  const cutFillRatio =
    safeFill > 0.01 ? roundTwo(safeCut / safeFill) : safeCut > 0.01 ? 99.99 : 1.0;

  const cutCostAud = roundTwo(safeCut * cutRate);
  const onSiteFillM3 = Math.min(compactedCutM3, safeFill);
  const fillPlacementCostAud = roundTwo(onSiteFillM3 * fillRate);
  const haulLooseM3 = importExportVolumeM3 * base.cutSwellFactor;
  const haulOrImportCostAud = roundTwo(
    netBalanceM3 >= 0
      ? haulLooseM3 * haulRate
      : importExportVolumeM3 * importRate,
  );
  const rockBreakoutVolumeM3 = roundTwo(safeCut * (base.rockBreakoutPct / 100));
  const rockBreakoutCostAud = roundTwo(rockBreakoutVolumeM3 * rockRate);
  const bulkEarthworksCostAud = roundTwo(
    cutCostAud +
      fillPlacementCostAud +
      haulOrImportCostAud +
      rockBreakoutCostAud +
      base.topsoilCostAud,
  );
  const retainingWallRatePerLmAud =
    customRates?.retainingRatePerLm ??
    getRetainingWallRatePerLm(retainingWallHeightM);
  const retainingWallCostAud = roundTwo(safeRetLen * retainingWallRatePerLmAud);
  const totalPackageAud = roundTwo(bulkEarthworksCostAud + retainingWallCostAud);
  const tipperLoads =
    importExportVolumeM3 < 0.01
      ? 0
      : Math.ceil(haulLooseM3 / TIPPER_TRUCK_CAPACITY_M3);
  const insideAreaHa = base.insideAreaSqm / 10_000;
  const costPerSqmAud =
    base.insideAreaSqm > 0 ? roundTwo(totalPackageAud / base.insideAreaSqm) : 0;
  const costPerHaAud =
    insideAreaHa > 0 ? roundTwo(totalPackageAud / insideAreaHa) : 0;
  const costPerLotAud = roundTwo(totalPackageAud / Math.max(1, base.estimatedLots));

  return {
    ...base,
    cutVolumeM3: roundTwo(safeCut),
    looseCutVolumeM3: roundTwo(looseCutVolumeM3),
    compactedCutM3: roundTwo(compactedCutM3),
    fillVolumeM3: roundTwo(safeFill),
    cutFillRatio,
    netBalanceM3: roundTwo(netBalanceM3),
    importExportVolumeM3: roundTwo(importExportVolumeM3),
    balanceDirection,
    retainingWallLengthM: roundTwo(safeRetLen),
    retainingWallHeightM,
    retainingWallRatePerLmAud,
    rockBreakoutVolumeM3,
    rockBreakoutCostAud,
    cutCostAud,
    fillPlacementCostAud,
    haulOrImportCostAud,
    bulkEarthworksCostAud,
    retainingWallCostAud,
    totalPackageAud,
    tipperLoads,
    costPerSqmAud,
    costPerHaAud,
    costPerLotAud,
  };
}

function buildEarthworksPatchPayload(
  result: EarthworksGridResult,
  dem: ElevationGrid,
): SiteEarthworks {
  return {
    demSource: dem.source,
    soilClass: result.soilClass,
    retainingWallHeightM: result.retainingWallHeightM,
    cutSwellFactor: result.cutSwellFactor,
    fillCompactionFactor: result.fillCompactionFactor,
    batterSlopeRatio: result.batterSlopeRatio,
    avgExistingElevationAHD: dem.meanAHD,
    finishedFloorLevelAHD: result.targetFflAHD,
    cutVolumeM3: Math.round(result.cutVolumeM3),
    fillVolumeM3: Math.round(result.fillVolumeM3),
    netBalanceM3: Math.round(result.netBalanceM3),
    importExportVolumeM3: Math.round(result.importExportVolumeM3),
    bulkEarthworksCostAud: Math.round(result.bulkEarthworksCostAud),
    retainingWallLengthM: Math.round(result.retainingWallLengthM),
    retainingWallCostAud: Math.round(result.retainingWallCostAud),
    updatedByApp: 'cutsheet-au',
  };
}

interface PinnedScenario {
  label: string;
  strategy: GradingStrategy;
  totalPackageAud: number;
  cutVolumeM3: number;
  fillVolumeM3: number;
  retainingWallLengthM: number;
}

interface CutSheetWorkbenchProps {
  project: SiteProject;
  initialBoundary: FeatureCollection;
  baselineSyntheticDem: ElevationGrid;
  renderActive: boolean;
  isStandalone: boolean;
  sendPatch: ReturnType<typeof useOsBridge>['sendPatch'];
  notify: ReturnType<typeof useOsBridge>['notify'];
  openApp: ReturnType<typeof useOsBridge>['openApp'];
}

function CutSheetWorkbench({
  project,
  initialBoundary,
  baselineSyntheticDem,
  renderActive,
  isStandalone,
  sendPatch,
  notify,
  openApp,
}: CutSheetWorkbenchProps) {
  const initialSoil: SoilClass =
    project.earthworks?.soilClass && SOIL_RATES_AUD[project.earthworks.soilClass]
      ? project.earthworks.soilClass
      : (STATE_DEFAULT_SOIL[project.location.state] ?? 'clay');
  const initialSoilSpec = SOIL_RATES_AUD[initialSoil];

  // Parse optional standalone #site=... shared hash
  const sharedHashInit = useMemo(
    () =>
      isStandalone && typeof window !== 'undefined'
        ? decodeSiteHash(window.location.hash)
        : null,
    [isStandalone],
  );

  // Active site parcel (supports user CAD polygon/rect drawing & capital jumps)
  const [customBoundary, setCustomBoundary] = useState<FeatureCollection | null>(
    () => {
      if (sharedHashInit?.ring && sharedHashInit.ring.length >= 4) {
        return {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { role: 'parcel-boundary' },
              geometry: { type: 'Polygon', coordinates: [sharedHashInit.ring] },
            },
          ],
        };
      }
      return null;
    },
  );
  const [customSiteLabel, setCustomSiteLabel] = useState<string | null>(null);
  const [customStateCode, setCustomStateCode] = useState<AustralianState | null>(
    null,
  );

  const activeBoundary = customBoundary ?? initialBoundary;
  const activeMetrics = useMemo(() => {
    try {
      return computePolygonMetrics(activeBoundary);
    } catch {
      return null;
    }
  }, [activeBoundary]);

  const activeSiteLng = activeMetrics?.centroid.lng ?? project.location.lng;
  const activeSiteLat = activeMetrics?.centroid.lat ?? project.location.lat;
  const activeMga = useMemo(
    () =>
      customBoundary
        ? getMga2020FromLng(activeSiteLng)
        : {
            mgaZone: project.location.mgaZone,
            mgaEpsg: project.location.mgaEpsg,
          },
    [
      activeSiteLng,
      customBoundary,
      project.location.mgaEpsg,
      project.location.mgaZone,
    ],
  );
  const activeState: AustralianState = customStateCode ?? project.location.state;

  // Layout & viewport state (standalone Map Lab. DA opens directly to Paddock-to-Offer Deal & RLV!)
  const [viewportMode, setViewportMode] = useState<MainViewportMode>('map');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    if (typeof window !== 'undefined') {
      const m = window.location.hash.match(/tab=(deal-rlv|cut-cost|terrain|plan-flow)/);
      if (m) return m[1] as InspectorTab;
    }
    return isStandalone ? 'deal-rlv' : 'cut-cost';
  });
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [mobileSheetMode, setMobileSheetMode] = useState<MobileSheetMode>('split');
  const [sectionDrawerOpen, setSectionDrawerOpen] = useState<boolean>(false);

  // Connected Cross-App Intelligence (EnviroSim Constraints + FormGen Yield + Feaso OS 8-State RLV)
  const [envConstraints, setEnvConstraints] = useState<EnvironmentalConstraintInputs>({
    balRating: 'BAL-12.5',
    floodOverlayPct: 0,
    riparianBiodiversityPct: 0,
  });
  const [finInputs, setFinInputs] = useState<DealFinancialInputs>(() =>
    createDefaultDealFinancialInputs(project.location.state, 'subdivision'),
  );
  const [optimizingRlv, setOptimizingRlv] = useState<boolean>(false);
  const [lastRlvOpt, setLastRlvOpt] = useState<RlvOptimizationResult | null>(null);

  // Universal 8-State Live Legal Parcel Snap & Mobile GPS Field Mode state
  const [parcelSnapLoading, setParcelSnapLoading] = useState<boolean>(false);
  const [parcelSnapNotice, setParcelSnapNotice] = useState<{
    kind: 'success' | 'warning' | 'error';
    text: string;
    retryCoords?: { lat: number; lng: number };
  } | null>(null);
  const [activeParcelId, setActiveParcelId] = useState<string>(
    project.geometry.parcelId ?? '',
  );
  const [activeParcelProvenance, setActiveParcelProvenance] = useState<string>(
    'Initial Screening Parcel + Local Terrain DTM',
  );
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [rateInputError, setRateInputError] = useState<string | null>(null);

  // Cloud Account & Private Saved Sites Vault state
  const [vaultOpen, setVaultOpen] = useState<boolean>(false);
  const [session, setSession] = useState<MapLabUserSession | null>(() =>
    loadActiveSession(),
  );
  const [savedDeals, setSavedDeals] = useState<SavedMapLabDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState<boolean>(false);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [siteNameDraft, setSiteNameDraft] = useState<string>(
    project.name || 'Australian Development Site',
  );
  const [saveBusy, setSaveBusy] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [privateAccessBlockedMsg, setPrivateAccessBlockedMsg] = useState<string | null>(
    null,
  );

  const [basemapMode, setBasemapMode] = useState<MapBasemapMode>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'offline-grid'
      : 'satellite',
  );
  const [is3dMap, setIs3dMap] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<CutSheetCadTool>('select');
  const [flyToTarget, setFlyToTarget] = useState<{
    lng: number;
    lat: number;
    zoom?: number;
    seq: number;
  } | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  // Address / coordinate search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<AuGeocodedAddress[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Terrain Lens & Illumination controls
  const [lensMode, setLensMode] = useState<TerrainLensMode>(
    sharedHashInit?.lens ?? 'hillshade',
  );
  const [lensOpacity, setLensOpacity] = useState<number>(0.76);
  const [verticalExaggeration, setVerticalExaggeration] = useState<number>(3.0);
  const [sunAzimuthDeg, setSunAzimuthDeg] = useState<number>(315);
  const [sunAltitudeDeg, setSunAltitudeDeg] = useState<number>(42);
  const [contourIntervalM, setContourIntervalM] = useState<number>(1.0);
  const [showContours, setShowContours] = useState<boolean>(true);
  const [showCadastre, setShowCadastre] = useState<boolean>(false);
  const [showWireframe, setShowWireframe] = useState<boolean>(true);
  const [showFflPlane, setShowFflPlane] = useState<boolean>(true);

  // Hydrology controls
  const [showFlowLines, setShowFlowLines] = useState<boolean>(true);
  const [showDepressions, setShowDepressions] = useState<boolean>(true);
  const [catchmentThresholdHa, setCatchmentThresholdHa] = useState<number>(0.25);

  // DEM grid & ingestion state
  const [customDemState, setCustomDemState] = useState<{
    projectId: string;
    grid: ElevationGrid;
  } | null>(null);
  const [demLoading, setDemLoading] = useState<boolean>(false);
  const [demLoadingLabel, setDemLoadingLabel] = useState<string>('');
  const [demError, setDemError] = useState<string | null>(null);

  // Grading Strategy & Commercial QS parameters
  const [gradingStrategy, setGradingStrategy] = useState<GradingStrategy>(
    sharedHashInit?.strategy ?? 'best-fit-plane',
  );
  const [targetCutFillRatio, setTargetCutFillRatio] = useState<number | null>(
    sharedHashInit?.ratio ?? 1.1,
  );
  const [maxGradePct, setMaxGradePct] = useState<number>(5.0);
  const [terraceStepM, setTerraceStepM] = useState<number>(1.2);
  const [soilClass, setSoilClass] = useState<SoilClass>(initialSoil);
  const [cutSwellFactor, setCutSwellFactor] = useState<number>(() => {
    const val = project.earthworks?.cutSwellFactor;
    return typeof val === 'number' && Number.isFinite(val)
      ? val
      : initialSoilSpec.defaultSwell;
  });
  const [fillCompactionFactor, setFillCompactionFactor] = useState<number>(
    () => {
      const val = project.earthworks?.fillCompactionFactor;
      return typeof val === 'number' && Number.isFinite(val)
        ? val
        : initialSoilSpec.defaultCompaction;
    },
  );
  const [batterSlopeRatio, setBatterSlopeRatio] = useState<number>(() => {
    const val = project.earthworks?.batterSlopeRatio;
    return typeof val === 'number' && Number.isFinite(val) ? val : 3;
  });
  const [rockBreakoutPct, setRockBreakoutPct] = useState<number>(10);
  const [topsoilDepthMm, setTopsoilDepthMm] = useState<number>(150);
  const [retainingWallHeightM, setRetainingWallHeightM] = useState<number>(
    () => {
      const val = project.earthworks?.retainingWallHeightM;
      return typeof val === 'number' && Number.isFinite(val) ? val : 1.8;
    },
  );
  const [fflInputStr, setFflInputStr] = useState<string>(() => {
    const val = project.earthworks?.finishedFloorLevelAHD;
    const ffl =
      typeof val === 'number' && Number.isFinite(val)
        ? val
        : baselineSyntheticDem.meanAHD;
    return ffl.toFixed(2);
  });
  const [editRatesOpen, setEditRatesOpen] = useState<boolean>(false);
  const [customRates, setCustomRates] = useState<CivilRateOverrides>({});
  const [pinnedScenario, setPinnedScenario] = useState<PinnedScenario | null>(
    null,
  );

  // Manual volume & retaining override state (preserves full QS override & E2E hooks!)
  const [volumeMode, setVolumeMode] = useState<VolumeMode>('dem');
  const [manualCutStr, setManualCutStr] = useState<string>(() =>
    String(Math.round(project.earthworks?.cutVolumeM3 ?? 18400)),
  );
  const [manualFillStr, setManualFillStr] = useState<string>(() =>
    String(Math.round(project.earthworks?.fillVolumeM3 ?? 14950)),
  );
  const [retainingOverrideStr, setRetainingOverrideStr] = useState<
    string | null
  >(() => {
    const val = project.earthworks?.retainingWallLengthM;
    return typeof val === 'number' && Number.isFinite(val)
      ? String(Math.round(val))
      : null;
  });

  // Section A–A' transect endpoints
  const [customTransect, setCustomTransect] = useState<{
    start: [number, number];
    end: [number, number];
  } | null>(null);

  // UI feedback states
  const [optFeedback, setOptFeedback] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>(
    'Ready to emit PROJECT_PATCH → Feaso OS',
  );
  const [syncOk, setSyncOk] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const terrariumAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const frameCountRef = useRef<number>(0);
  const frameCounterElRef = useRef<HTMLSpanElement | null>(null);

  // Escape key returns CAD tool to select/pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTool('select');
        setSearchResults([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      terrariumAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, []);

  // Re-generate local synthetic DEM whenever custom parcel boundary changes (if no uploaded/live DEM matches)
  const localBoundaryDem = useMemo<ElevationGrid>(() => {
    if (!customBoundary) return baselineSyntheticDem;
    return buildBaselineSyntheticDem(project, customBoundary);
  }, [baselineSyntheticDem, customBoundary, project]);

  const activeDemGrid = useMemo<ElevationGrid>(() => {
    if (customDemState && customDemState.projectId === project.projectId) {
      return customDemState.grid;
    }
    return localBoundaryDem;
  }, [customDemState, localBoundaryDem, project.projectId]);

  // Direct DOM frame counter tick (zero React re-renders per animation frame)
  const handleFrameTick = useCallback(() => {
    frameCountRef.current += 1;
    if (frameCounterElRef.current) {
      frameCounterElRef.current.textContent = `frame #${frameCountRef.current}`;
    }
  }, []);

  // Keep #frame-counter synced to OS_RENDER_STATE even in Map mode
  useEffect(() => {
    if (viewportMode === '3d-studio') return;
    if (!renderActive) return;

    const timerId = window.setInterval(handleFrameTick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [handleFrameTick, renderActive, viewportMode]);

  // Parse & validate editable FFL, manual volumes, and retaining length
  const fflCheck = useMemo(
    () =>
      parseStrictFiniteNumber(
        fflInputStr,
        -20,
        2500,
        'Target FFL (m AHD)',
      ),
    [fflInputStr],
  );
  const safeTargetFflAHD = fflCheck.ok
    ? fflCheck.value
    : (activeDemGrid?.meanAHD ?? 50);

  const retainingCheck = useMemo(() => {
    if (retainingOverrideStr === null) {
      return { ok: true as const, value: undefined };
    }
    return parseStrictFiniteNumber(
      retainingOverrideStr,
      0,
      50_000,
      'Retaining Wall Length (m)',
    );
  }, [retainingOverrideStr]);

  // EnviroSim flood/exclusion area hook if present on SiteProject
  const enviroGrossSqm = activeMetrics?.grossAreaSqm ?? project.geometry.grossAreaSqm ?? 0;
  const enviroNdaSqm = project.geometry.netDevelopableAreaSqm;
  const enviroFloodHa =
    project.environment?.floodOverlay &&
    typeof enviroNdaSqm === 'number' &&
    enviroGrossSqm > enviroNdaSqm
      ? roundTwo(((enviroGrossSqm - enviroNdaSqm) * 0.35) / 10_000)
      : 0;

  // Pass 1: Grid earthworks solver (polygon-clipped, 4 strategies)
  const baseGridResult = useMemo<EarthworksGridResult>(() => {
    return computeGridEarthworks(activeDemGrid, activeBoundary, {
      targetFflAHD: safeTargetFflAHD,
      soilClass,
      cutSwellFactor,
      fillCompactionFactor,
      batterSlopeRatio,
      retainingWallHeightM,
      retainingWallLengthOverrideM: retainingCheck.ok
        ? retainingCheck.value
        : undefined,
      gradingPads: customBoundary ? undefined : project.earthworks?.gradingPads,
      applyBoundaryBatter: batterSlopeRatio > 0,
      gradingStrategy,
      targetCutFillRatio:
        gradingStrategy !== 'flat-pad' && targetCutFillRatio !== null
          ? targetCutFillRatio
          : undefined,
      maxGradePct,
      terraceStepM,
      rockBreakoutPct,
      topsoilDepthM: topsoilDepthMm / 1000,
      customRates,
      lotYieldBasis:
        !customBoundary &&
        typeof project.massing?.lotYield === 'number' &&
        project.massing.lotYield >= 1
          ? project.massing.lotYield
          : undefined,
    });
  }, [
    activeBoundary,
    activeDemGrid,
    batterSlopeRatio,
    customBoundary,
    customRates,
    cutSwellFactor,
    fillCompactionFactor,
    gradingStrategy,
    maxGradePct,
    project.earthworks?.gradingPads,
    project.massing?.lotYield,
    retainingCheck,
    retainingWallHeightM,
    rockBreakoutPct,
    safeTargetFflAHD,
    soilClass,
    targetCutFillRatio,
    terraceStepM,
    topsoilDepthMm,
  ]);

  // Hydrology, Horn 3x3 Slope Bands, Priority-Flood Depressions, D8 Overland Flow & NDA
  const hydrology = useMemo<HydrologyAnalysisResult>(() => {
    return analyzeTerrainHydrology(
      activeDemGrid,
      baseGridResult.insideMask,
      baseGridResult.cellAreaSqm,
      {
        catchmentThresholdHa,
        depressionThresholdM: 0.15,
        floodExclusionHa: enviroFloodHa,
      },
    );
  }, [
    activeDemGrid,
    baseGridResult.cellAreaSqm,
    baseGridResult.insideMask,
    catchmentThresholdHa,
    enviroFloodHa,
  ]);

  // Refine developability & lot yield with exact computed NDA from Hydrology engine
  const gridResult = useMemo<EarthworksGridResult>(() => {
    const massingLotYield = project.massing?.lotYield;
    const lotYieldBasis =
      !customBoundary &&
      typeof massingLotYield === 'number' &&
      massingLotYield >= 1
        ? massingLotYield
        : Math.max(1, Math.round(hydrology.netDevelopableAreaHa * 15));
    const costPerLotAud = roundTwo(baseGridResult.totalPackageAud / lotYieldBasis);
    const exactNdaPct = Math.round(hydrology.netDevelopablePct);
    const syncedDrivers = baseGridResult.developability.drivers.map((d) =>
      /NDA/i.test(d)
        ? exactNdaPct >= 80
          ? `High NDA (${exactNdaPct}%)`
          : `NDA ${exactNdaPct}%`
        : d,
    );
    return {
      ...baseGridResult,
      estimatedLots: lotYieldBasis,
      costPerLotAud,
      developability: {
        ...baseGridResult.developability,
        drivers: syncedDrivers,
      },
    };
  }, [
    baseGridResult,
    customBoundary,
    hydrology.netDevelopableAreaHa,
    hydrology.netDevelopablePct,
    project.massing,
  ]);

  const manualCutCheck = useMemo(() => {
    if (volumeMode !== 'manual') {
      return { ok: true as const, value: gridResult.cutVolumeM3 };
    }
    return parseStrictFiniteNumber(
      manualCutStr,
      0,
      5_000_000,
      'Cut Volume (m³)',
    );
  }, [gridResult.cutVolumeM3, manualCutStr, volumeMode]);

  const manualFillCheck = useMemo(() => {
    if (volumeMode !== 'manual') {
      return { ok: true as const, value: gridResult.fillVolumeM3 };
    }
    return parseStrictFiniteNumber(
      manualFillStr,
      0,
      5_000_000,
      'Fill Volume (m³)',
    );
  }, [gridResult.fillVolumeM3, manualFillStr, volumeMode]);

  const validationError = useMemo<string | null>(() => {
    if (!fflCheck.ok) return fflCheck.error;
    if (!manualCutCheck.ok) return manualCutCheck.error;
    if (!manualFillCheck.ok) return manualFillCheck.error;
    if (!retainingCheck.ok) return retainingCheck.error;
    return null;
  }, [fflCheck, manualCutCheck, manualFillCheck, retainingCheck]);

  const effectiveResult = useMemo<EarthworksGridResult>(() => {
    if (volumeMode === 'dem') return gridResult;
    const cutVal = manualCutCheck.ok
      ? manualCutCheck.value
      : gridResult.cutVolumeM3;
    const fillVal = manualFillCheck.ok
      ? manualFillCheck.value
      : gridResult.fillVolumeM3;
    const retLen =
      retainingCheck.ok && retainingCheck.value !== undefined
        ? retainingCheck.value
        : gridResult.retainingWallLengthM;
    return applyManualVolumeOverride(
      gridResult,
      cutVal,
      fillVal,
      retLen,
      retainingWallHeightM,
      customRates,
    );
  }, [
    customRates,
    gridResult,
    manualCutCheck,
    manualFillCheck,
    retainingCheck,
    retainingWallHeightM,
    volumeMode,
  ]);

  // Marching Squares Elevation Contours
  const contours = useMemo<FeatureCollection>(() => {
    return generateElevationContours(activeDemGrid, contourIntervalM);
  }, [activeDemGrid, contourIntervalM]);

  // Draped Terrain Lens Raster PNG Data URL (Hillshade / Slope Bands / Cut-Fill Map)
  const terrainLensUrl = useMemo<string | null>(() => {
    return renderTerrainLensDataUrl(
      activeDemGrid,
      effectiveResult.insideMask,
      effectiveResult.deltaGrid,
      hydrology.slopePctGrid,
      {
        mode: lensMode,
        sunAzimuthDeg,
        sunAltitudeDeg,
        verticalExaggeration,
        maxCutM: Math.max(1.2, effectiveResult.maxCutDepthM),
        maxFillM: Math.max(1.2, effectiveResult.maxFillDepthM),
      },
    );
  }, [
    activeDemGrid,
    effectiveResult.deltaGrid,
    effectiveResult.insideMask,
    effectiveResult.maxCutDepthM,
    effectiveResult.maxFillDepthM,
    hydrology.slopePctGrid,
    lensMode,
    sunAltitudeDeg,
    sunAzimuthDeg,
    verticalExaggeration,
  ]);

  // Section A–A' Transect
  const [sectionStart, sectionEnd] = useMemo<
    [[number, number], [number, number]]
  >(() => {
    if (customTransect) return [customTransect.start, customTransect.end];
    if (activeMetrics) return getDefaultTransect(activeMetrics.bbox);
    return getDefaultTransect(activeDemGrid.boundsWgs84);
  }, [activeDemGrid.boundsWgs84, activeMetrics, customTransect]);

  const sectionProfile = useMemo(() => {
    return sampleSectionProfile(
      activeDemGrid,
      effectiveResult.deltaGrid,
      sectionStart,
      sectionEnd,
      56,
    );
  }, [activeDemGrid, effectiveResult.deltaGrid, sectionEnd, sectionStart]);

  // Connected Cross-App Intelligence (CutSheet + EnviroSim + FormGen + Feaso OS 8-State RLV)
  const dealIntelligence = useMemo(
    () =>
      computeMapLabDealIntelligence({
        state: activeState,
        grossAreaSqm: effectiveResult.insideAreaSqm,
        hydrology,
        earthworksCostAud: effectiveResult.totalPackageAud,
        minElevationAHD: activeDemGrid.minAHD,
        env: envConstraints,
        fin: finInputs,
      }),
    [
      activeDemGrid.minAHD,
      activeState,
      effectiveResult.insideAreaSqm,
      effectiveResult.totalPackageAud,
      envConstraints,
      finInputs,
      hydrology,
    ],
  );

  const combinedProvenanceLabel = `${activeParcelProvenance} • ${activeDemGrid.sourceLabel} (${activeMga.mgaEpsg})`;

  // --- Handlers ---

  const triggerFlyTo = useCallback((lng: number, lat: number, zoom = 15.2) => {
    setFlyToTarget({ lng, lat, zoom, seq: Date.now() });
  }, []);

  const applySavedDealToWorkspace = useCallback(
    (deal: SavedMapLabDeal) => {
      setCustomBoundary(deal.boundary);
      setCustomStateCode(deal.state);
      setCustomSiteLabel(deal.name);
      setSiteNameDraft(deal.name);
      setActiveDealId(deal.id);
      setActiveParcelId(deal.parcelId);
      setActiveParcelProvenance(`Saved Site (${deal.state} Vault)`);
      setGradingStrategy(deal.gradingStrategy);
      setFflInputStr(deal.targetFflAHD.toFixed(2));
      setTargetCutFillRatio(deal.targetCutFillRatio);
      setSoilClass(deal.soilClass);
      setRockBreakoutPct(deal.rockBreakoutPct);
      setTopsoilDepthMm(Math.round(deal.topsoilDepthM * 1000));
      setCustomRates(deal.ratesOverride);
      setEnvConstraints(deal.env);
      setFinInputs(deal.fin);
      setCustomDemState(null);
      setCustomTransect(null);
      setVolumeMode('dem');
      setRetainingOverrideStr(null);
      setLastRlvOpt(null);
      setViewportMode('map');
      triggerFlyTo(deal.lng, deal.lat, 15.5);
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          null,
          '',
          `#deal=${encodeURIComponent(deal.id)}&tab=${inspectorTab}`,
        );
      }
    },
    [inspectorTab, triggerFlyTo],
  );

  const refreshSavedDeals = useCallback(async (activeSess: MapLabUserSession | null) => {
    if (!activeSess) {
      setSavedDeals([]);
      setDealsError(null);
      return;
    }
    setDealsLoading(true);
    setDealsError(null);
    const res = await listPrivateDeals(activeSess);
    setDealsLoading(false);
    if (res.ok) {
      setSavedDeals(res.deals);
    } else {
      setDealsError(res.error);
    }
  }, []);

  const resolveDealHashAccess = useCallback(
    async (activeSess: MapLabUserSession | null) => {
      if (typeof window === 'undefined') return;
      const dealMatch = window.location.hash.match(/deal=([^&]+)/);
      if (!dealMatch?.[1]) return;
      const requestedId = decodeURIComponent(dealMatch[1]);
      const lookup = await loadPrivateDealById(activeSess, requestedId);
      if (lookup.status === 'ok') {
        setPrivateAccessBlockedMsg(null);
        applySavedDealToWorkspace(lookup.deal);
      } else if (lookup.status === 'unauthenticated') {
        setPrivateAccessBlockedMsg(
          'This saved site is private. Sign in with the owning account to view it.',
        );
        setVaultOpen(true);
      } else if (lookup.status === 'access-denied') {
        setPrivateAccessBlockedMsg(
          'Access blocked: this private site belongs to another Map Lab. DA account.',
        );
        setVaultOpen(true);
      }
    },
    [applySavedDealToWorkspace],
  );

  useEffect(() => {
    let active = true;
    const bootVault = async () => {
      await refreshSavedDeals(session);
      if (!active) return;
      await resolveDealHashAccess(session);
    };
    void bootVault();
    return () => {
      active = false;
    };
  }, [refreshSavedDeals, resolveDealHashAccess, session]);

  // Browser Back / Forward / Same-tab #deal= & #tab= Hash recovery
  useEffect(() => {
    const onHashChange = () => {
      const m = window.location.hash.match(/tab=(deal-rlv|cut-cost|terrain|plan-flow)/);
      if (m) {
        setInspectorTab(m[1] as InspectorTab);
      }
      void resolveDealHashAccess(session);
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, [resolveDealHashAccess, session]);

  const handleSelectInspectorTab = useCallback(
    (next: InspectorTab) => {
      setInspectorTab(next);
      if (typeof window !== 'undefined' && isStandalone) {
        const dealPart = activeDealId ? `deal=${encodeURIComponent(activeDealId)}&` : '';
        window.history.pushState(null, '', `#${dealPart}tab=${next}`);
      }
    },
    [activeDealId, isStandalone],
  );

  const handleBoundaryDrawn = useCallback((fc: FeatureCollection) => {
    setCustomBoundary(fc);
    setCustomDemState(null);
    setCustomTransect(null);
    setVolumeMode('dem');
    setRetainingOverrideStr(null);
    setOptFeedback(null);
    setLastRlvOpt(null);
    setActiveDealId(null);
    setParcelSnapNotice(null);
    try {
      const m = computePolygonMetrics(fc);
      const st = inferAuStateFromLngLat(m.centroid.lng, m.centroid.lat);
      setCustomStateCode(st);
      setFinInputs((prev) =>
        createDefaultDealFinancialInputs(st, prev.typology),
      );
      setActiveParcelId('');
      setActiveParcelProvenance(`User-Drawn Site Boundary (${st})`);
      const label = `Drawn Site Parcel (${m.grossAreaHa.toFixed(2)} ha)`;
      setCustomSiteLabel(label);
      setSiteNameDraft(label);
    } catch {
      setCustomSiteLabel('Drawn Site Parcel');
    }
  }, []);

  const handleParcelSnapAtPoint = useCallback(
    async (lat: number, lng: number, explicitState?: AustralianState) => {
      setParcelSnapLoading(true);
      setParcelSnapNotice(null);
      setLastRlvOpt(null);
      try {
        const res = await snapLegalParcelAtPoint(lat, lng, explicitState);
        if (res.matched && res.featureCollection) {
          setCustomBoundary(res.featureCollection);
          setCustomStateCode(res.state);
          setFinInputs((prev) =>
            createDefaultDealFinancialInputs(res.state, prev.typology),
          );
          setActiveParcelId(res.parcelId);
          setActiveParcelProvenance(
            res.provenance === 'live-state-cadastre'
              ? `Live ${res.state} Cadastre (${res.authority})`
              : `Screening Footprint (${res.authority})`,
          );
          const label = res.address
            ? `${res.parcelLabel} — ${res.address}`
            : `${res.parcelLabel} (${res.state})`;
          setCustomSiteLabel(label);
          setSiteNameDraft(label);
          setActiveDealId(null);
          setCustomDemState(null);
          setCustomTransect(null);
          setVolumeMode('dem');
          setRetainingOverrideStr(null);
          setShowCadastre(true);
          triggerFlyTo(lng, lat, 16.4);
          setParcelSnapNotice({
            kind: 'success',
            text: `Snapped ${res.parcelId} (${(res.areaSqm / 10000).toFixed(2)} ha • ${res.authority}${res.zoneName ? ` • ${res.zoneName}` : ''})`,
          });
          notify(
            `Legal ${res.state} Parcel Snapped`,
            `${res.parcelId} • ${res.authority}`,
            'success',
          );
        } else {
          // Graceful fallback: place a clean screening boundary & offer Retry or manual draw
          const fallbackFc = createRectPolygonFeatureCollection(lat, lng, 140, 120);
          setCustomBoundary(fallbackFc);
          setCustomStateCode(res.state);
          setFinInputs((prev) =>
            createDefaultDealFinancialInputs(res.state, prev.typology),
          );
          setActiveParcelId('');
          setActiveParcelProvenance(`Screening Envelope (${res.authority})`);
          const label = `${AU_STATE_SPATIAL_REGISTRY[res.state].capitalLabel} Area Screening Site (${res.state})`;
          setCustomSiteLabel(label);
          setSiteNameDraft(label);
          setActiveDealId(null);
          setCustomDemState(null);
          setCustomTransect(null);
          setVolumeMode('dem');
          setShowCadastre(true);
          triggerFlyTo(lng, lat, 16.0);
          setParcelSnapNotice({
            kind: res.upstreamUnavailable ? 'error' : 'warning',
            text:
              res.message ||
              `Placed a calibrated screening parcel in ${res.state}. Trace exact lot boundaries with Polygon or Retry.`,
            retryCoords: { lat, lng },
          });
        }
      } finally {
        setParcelSnapLoading(false);
      }
    },
    [notify, triggerFlyTo],
  );

  const handleLocateMySite = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setParcelSnapNotice({
        kind: 'warning',
        text: 'GPS location is not available in this browser. Search any Australian address or tap a parcel on the map.',
      });
      return;
    }
    setGpsLoading(true);
    setParcelSnapNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const { latitude, longitude } = pos.coords;
        if (!isWithinAustraliaBounds(latitude, longitude)) {
          setParcelSnapNotice({
            kind: 'warning',
            text: 'Your GPS position is outside Australia. Select any of the 8 Australian states or search an Australian address.',
          });
          return;
        }
        setViewportMode('map');
        void handleParcelSnapAtPoint(latitude, longitude);
      },
      () => {
        setGpsLoading(false);
        setParcelSnapNotice({
          kind: 'warning',
          text: 'Location permission was declined or timed out. Search an address or use 1-Tap Parcel Snap directly on the map.',
        });
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
    );
  }, [handleParcelSnapAtPoint]);

  const handleCapitalJump = (profile: AuStateSpatialProfile) => {
    const fc = createRectPolygonFeatureCollection(
      profile.capitalLat,
      profile.capitalLng,
      160,
      140,
    );
    setCustomBoundary(fc);
    setCustomStateCode(profile.state);
    setFinInputs((prev) =>
      createDefaultDealFinancialInputs(profile.state, prev.typology),
    );
    const label = `${profile.capitalLabel} Precinct (${profile.state})`;
    setCustomSiteLabel(label);
    setSiteNameDraft(label);
    setActiveDealId(null);
    setActiveParcelId('');
    setActiveParcelProvenance(`Screening Precinct (${profile.authority})`);
    setCustomDemState(null);
    setCustomTransect(null);
    setVolumeMode('dem');
    setRetainingOverrideStr(null);
    setOptFeedback(null);
    setLastRlvOpt(null);
    setParcelSnapNotice(null);
    setSearchResults([]);
    setSearchError(null);
    setViewportMode('map');
    triggerFlyTo(profile.capitalLng, profile.capitalLat, 15.5);
  };

  const handleOptimizeForMaxRlv = () => {
    if (optimizingRlv) return;
    setOptimizingRlv(true);
    try {
      const polyFc = activeBoundary as FeatureCollection<Polygon>;
      const opt = optimizeGradingForMaxRlv({
        grid: activeDemGrid,
        boundary: polyFc,
        state: activeState,
        grossAreaSqm: effectiveResult.insideAreaSqm,
        hydrology,
        soilClass,
        rockBreakoutPct,
        topsoilDepthM: topsoilDepthMm / 1000,
        targetCutFillRatio: targetCutFillRatio ?? 1.1,
        maxGradePct,
        terraceStepM,
        ratesOverride: customRates,
        env: envConstraints,
        fin: finInputs,
      });
      setGradingStrategy(opt.bestStrategy);
      setFflInputStr(opt.bestFflAHD.toFixed(2));
      setVolumeMode('dem');
      setLastRlvOpt(opt);
      notify(
        'Max RLV Grading Applied',
        `${opt.bestStrategy} @ ${opt.bestFflAHD.toFixed(2)}m AHD (+${formatCompactAud(opt.rlvUpliftAud)} RLV)`,
        'success',
      );
    } finally {
      setOptimizingRlv(false);
    }
  };

  const handleSaveDeal = async () => {
    if (saveBusy) return;
    if (!session) {
      setVaultOpen(true);
      return;
    }
    setSaveBusy(true);
    setSaveFeedback(null);
    try {
      const polyFc = activeBoundary as FeatureCollection<Polygon>;
      const res = await savePrivateDeal(session, {
        existingId: activeDealId ?? undefined,
        name: siteNameDraft,
        state: activeState,
        address: customSiteLabel ?? project.location.address ?? '',
        parcelId: activeParcelId,
        lat: activeSiteLat,
        lng: activeSiteLng,
        grossAreaSqm: effectiveResult.insideAreaSqm,
        earthworksCostAud: effectiveResult.totalPackageAud,
        rlvAud: dealIntelligence.residualLandValueAud,
        developabilityScore: effectiveResult.developability.score,
        gradingStrategy,
        targetFflAHD: effectiveResult.targetFflAHD,
        targetCutFillRatio: targetCutFillRatio ?? 1.1,
        soilClass,
        rockBreakoutPct,
        topsoilDepthM: topsoilDepthMm / 1000,
        ratesOverride: customRates,
        env: envConstraints,
        fin: finInputs,
        boundary: polyFc,
      });
      if (!res.ok) {
        setSaveFeedback({ kind: 'error', text: res.error });
        return;
      }
      setActiveDealId(res.deal.id);
      setCustomSiteLabel(res.deal.name);
      if (typeof window !== 'undefined' && isStandalone) {
        window.history.replaceState(
          null,
          '',
          `#deal=${encodeURIComponent(res.deal.id)}&tab=${inspectorTab}`,
        );
      }
      setSaveFeedback({
        kind: 'success',
        text: `Saved "${res.deal.name}" (${res.deal.state}) to your private workspace.`,
      });
      await refreshSavedDeals(session);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleAddressSearch = async (evt: FormEvent) => {
    evt.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchError('Enter an Australian street address, suburb, postcode, or lat, lng.');
      return;
    }
    if (!/[A-Za-z0-9]/.test(q)) {
      setSearchError('Please enter a valid Australian address or numeric coordinates.');
      setSearchResults([]);
      return;
    }
    setSearchError(null);

    // Direct lat, lng support
    const directCoords = parseLatLngQuery(q);
    if (directCoords) {
      const st = inferAuStateFromLngLat(directCoords.lng, directCoords.lat);
      setSearchResults([]);
      setViewportMode('map');
      void handleParcelSnapAtPoint(directCoords.lat, directCoords.lng, st);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchLoading(true);
    try {
      const matches = await searchAustralianAddresses(q, controller.signal);
      if (controller.signal.aborted) return;
      if (matches.length === 0) {
        setSearchError(
          `No Australian locations matched "${q}". Try a suburb/street or "lat, lng".`,
        );
        setSearchResults([]);
      } else {
        setSearchResults(matches);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSearchError(
        err instanceof Error ? err.message : 'Address lookup failed.',
      );
    } finally {
      if (!controller.signal.aborted) setSearchLoading(false);
    }
  };

  const handleSelectAddress = (addr: AuGeocodedAddress) => {
    setSearchResults([]);
    setSearchQuery(addr.label);
    setViewportMode('map');
    void handleParcelSnapAtPoint(addr.lat, addr.lng, addr.state);
  };

  const handleFetchTerrarium = async () => {
    terrariumAbortRef.current?.abort();
    const controller = new AbortController();
    terrariumAbortRef.current = controller;

    setDemLoading(true);
    setDemLoadingLabel('Streaming AWS Terrarium DEM tiles...');
    setDemError(null);
    setOptFeedback(null);

    try {
      const bounds = activeMetrics
        ? padWgs84Bounds(activeMetrics.bbox, 0.14)
        : activeDemGrid.boundsWgs84;
      const liveGrid = await loadTerrariumDemForBounds(
        bounds,
        36,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCustomDemState({ projectId: project.projectId, grid: liveGrid });
      setVolumeMode('dem');
      setFflInputStr(liveGrid.meanAHD.toFixed(2));
      setDemError(null);
      notify(
        'Live AWS Terrarium DEM loaded',
        `${liveGrid.sourceLabel} • ${liveGrid.minAHD.toFixed(1)}–${liveGrid.maxAHD.toFixed(1)} m AHD`,
        'success',
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const detail =
        err instanceof Error
          ? err.message
          : 'Network error fetching AWS Terrarium elevation tiles.';
      setDemError(
        `Unable to stream AWS Terrarium DEM (${detail}). Continuing with local DTM.`,
      );
    } finally {
      if (!controller.signal.aborted) {
        setDemLoading(false);
        setDemLoadingLabel('');
      }
    }
  };

  const handleDemFileUpload = async (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isTiff = lower.endsWith('.tif') || lower.endsWith('.tiff');
    const isCsv =
      lower.endsWith('.csv') ||
      lower.endsWith('.xyz') ||
      lower.endsWith('.txt');

    if (!isTiff && !isCsv) {
      setDemError(
        `Unsupported file "${file.name}". Upload a GeoTIFF / ELVIS LiDAR (.tif, .tiff) or Surveyor CSV/XYZ (.csv, .xyz, .txt).`,
      );
      return;
    }

    setDemLoading(true);
    setDemLoadingLabel(
      isTiff
        ? `Decoding GeoTIFF "${file.name}"...`
        : `Gridding survey CSV "${file.name}" (IDW)...`,
    );
    setDemError(null);
    setOptFeedback(null);

    try {
      const bounds = activeMetrics
        ? padWgs84Bounds(activeMetrics.bbox, 0.14)
        : activeDemGrid.boundsWgs84;
      if (isTiff) {
        const buffer = await file.arrayBuffer();
        const tiffGrid = await parseGeoTiffDem(buffer, bounds, 40);
        setCustomDemState({ projectId: project.projectId, grid: tiffGrid });
        setVolumeMode('dem');
        setFflInputStr(tiffGrid.meanAHD.toFixed(2));
        notify(
          'ELVIS / GeoTIFF DEM loaded',
          `${tiffGrid.sourceLabel} • ${tiffGrid.minAHD.toFixed(1)}–${tiffGrid.maxAHD.toFixed(1)} m AHD`,
          'success',
        );
      } else {
        const rawText = await file.text();
        const parsed = parseSurveyCsvDem(rawText, activeMga.mgaZone, bounds, 36);
        if (!parsed.ok) {
          setDemError(parsed.error);
          return;
        }
        setCustomDemState({ projectId: project.projectId, grid: parsed.grid });
        setVolumeMode('dem');
        setFflInputStr(parsed.grid.meanAHD.toFixed(2));
        notify(
          'Survey CSV DEM loaded',
          `Interpolated ${parsed.pointCount} points (${parsed.grid.mgaEpsg})`,
          'success',
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setDemError(`Failed to parse "${file.name}": ${detail}`);
    } finally {
      setDemLoading(false);
      setDemLoadingLabel('');
    }
  };

  const handleResetWorkspaceParcel = () => {
    setCustomBoundary(null);
    setCustomSiteLabel(null);
    setCustomStateCode(null);
    setSiteNameDraft(project.name);
    setActiveDealId(null);
    setActiveParcelId(project.geometry.parcelId ?? '');
    setActiveParcelProvenance(`Workspace Parcel (${project.location.state})`);
    setParcelSnapNotice(null);
    setLastRlvOpt(null);
    setCustomDemState(null);
    setCustomTransect(null);
    setDemError(null);
    setVolumeMode('dem');
    setRetainingOverrideStr(null);
    setFflInputStr(baselineSyntheticDem.meanAHD.toFixed(2));
    setOptFeedback(null);
    triggerFlyTo(project.location.lng, project.location.lat, 15.2);
  };

  const handleOptimizeZeroBalanceFfl = () => {
    const opt = optimizeZeroBalanceFfl(activeDemGrid, activeBoundary, {
      targetFflAHD: safeTargetFflAHD,
      soilClass,
      cutSwellFactor,
      fillCompactionFactor,
      batterSlopeRatio,
      retainingWallHeightM,
      retainingWallLengthOverrideM: retainingCheck.ok
        ? retainingCheck.value
        : undefined,
      gradingPads: customBoundary ? undefined : project.earthworks?.gradingPads,
      applyBoundaryBatter: batterSlopeRatio > 0,
      gradingStrategy,
      maxGradePct,
      terraceStepM,
      rockBreakoutPct,
      topsoilDepthM: topsoilDepthMm / 1000,
      customRates,
    });
    setTargetCutFillRatio(null);
    setFflInputStr(opt.optimalFflAHD.toFixed(2));
    setVolumeMode('dem');
    setOptFeedback(
      `Zero-balance FFL ${opt.optimalFflAHD.toFixed(2)} m AHD (${opt.iterations} iter • ${opt.residualBalanceM3 >= 0 ? '+' : ''}${opt.residualBalanceM3.toFixed(1)} m³)`,
    );
  };

  const handleShareSite = async () => {
    const poly = extractPrimaryPolygon(activeBoundary);
    const ring = poly?.geometry.coordinates[0]?.map(
      (p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))] as [number, number],
    );
    const hash = encodeSiteHash({
      lat: Number(activeSiteLat.toFixed(6)),
      lng: Number(activeSiteLng.toFixed(6)),
      ring,
      strategy: gradingStrategy,
      ratio: targetCutFillRatio ?? undefined,
      lens: lensMode,
    });
    const shareUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}${hash}`
        : hash;
    try {
      if (typeof window !== 'undefined' && hash) {
        window.history.replaceState(null, '', hash);
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
      notify('Shareable Map Lab. DA link copied', 'Parcel & grading parameters encoded in URL hash', 'info');
    } catch {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    }
  };

  const handleCycleBasemap = () => {
    const order: MapBasemapMode[] = ['satellite', 'dark-vector', 'offline-grid'];
    const next = order[(order.indexOf(basemapMode) + 1) % order.length];
    setBasemapMode(next);
  };

  const handleSoilClassChange = (next: SoilClass) => {
    setSoilClass(next);
    const spec = SOIL_RATES_AUD[next];
    setCutSwellFactor(spec.defaultSwell);
    setFillCompactionFactor(spec.defaultCompaction);
    setCustomRates({});
    setRateInputError(null);
  };

  const handleCutManualChange = (valStr: string) => {
    if (volumeMode !== 'manual') {
      setManualFillStr(String(Math.round(gridResult.fillVolumeM3)));
    }
    setVolumeMode('manual');
    setManualCutStr(valStr);
    setOptFeedback(null);
  };

  const handleFillManualChange = (valStr: string) => {
    if (volumeMode !== 'manual') {
      setManualCutStr(String(Math.round(gridResult.cutVolumeM3)));
    }
    setVolumeMode('manual');
    setManualFillStr(valStr);
    setOptFeedback(null);
  };

  const handleTogglePinScenario = () => {
    if (pinnedScenario) {
      setPinnedScenario(null);
      return;
    }
    const stratLabel =
      STRATEGY_OPTIONS.find((s) => s.id === gradingStrategy)?.label ??
      gradingStrategy;
    setPinnedScenario({
      label: stratLabel,
      strategy: gradingStrategy,
      totalPackageAud: effectiveResult.totalPackageAud,
      cutVolumeM3: effectiveResult.cutVolumeM3,
      fillVolumeM3: effectiveResult.fillVolumeM3,
      retainingWallLengthM: effectiveResult.retainingWallLengthM,
    });
  };

  const handleSendEarthworks = () => {
    if (validationError) return;
    const payload = buildEarthworksPatchPayload(effectiveResult, activeDemGrid);
    const sent = sendPatch({ earthworks: payload });
    const dirLabel =
      effectiveResult.balanceDirection === 'export'
        ? `Export ${formatNum(effectiveResult.importExportVolumeM3)} m³`
        : effectiveResult.balanceDirection === 'import'
          ? `Import ${formatNum(effectiveResult.importExportVolumeM3)} m³`
          : 'Balanced cut/fill';

    notify(
      'Earthworks synced to Feasibility',
      `Bulk ${formatAud(effectiveResult.bulkEarthworksCostAud)} + Retaining ${formatAud(effectiveResult.retainingWallCostAud)} • ${dirLabel}`,
      'success',
    );

    const nowTime = new Date().toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setSyncOk(true);
    setSyncMessage(
      sent
        ? `Synced ${formatAud(effectiveResult.totalPackageAud)} → Feaso OS (${nowTime})`
        : `Updated local earthworks (${formatAud(effectiveResult.totalPackageAud)})`,
    );
  };

  const handleExport = (
    format: 'pdf' | 'csv' | 'geojson' | 'landxml' | 'dxf' | 'xyz',
  ) => {
    setExportError(null);
    const baseName = customSiteLabel ?? project.name;
    try {
      if (format === 'pdf') {
        const blob = buildCutSheetPdfBlob(
          project,
          effectiveResult,
          hydrology,
          dealIntelligence,
          combinedProvenanceLabel,
        );
        const name = slugifyFilename(`${baseName}-map-lab-da-memo`, 'pdf');
        downloadBlobFile(blob, name);
        setExportFeedback(`Exported ${name}`);
      } else if (format === 'csv') {
        const csv = buildEarthworksBoqCsv(project, effectiveResult);
        const name = slugifyFilename(`${baseName}-earthworks-boq`, 'csv');
        downloadTextFile(csv, name, 'text/csv;charset=utf-8');
        setExportFeedback(`Exported ${name}`);
      } else if (format === 'xyz') {
        const xyz = buildSurfaceXyzCsv(activeDemGrid, effectiveResult);
        const name = slugifyFilename(`${baseName}-surface-xyz`, 'csv');
        downloadTextFile(xyz, name, 'text/csv;charset=utf-8');
        setExportFeedback(`Exported ${name}`);
      } else if (format === 'geojson') {
        const gj = buildEarthworksGeoJson(
          contours,
          project.earthworks?.gradingPads,
          activeBoundary,
        );
        const name = slugifyFilename(`${baseName}-contours`, 'geojson');
        downloadTextFile(gj, name, 'application/geo+json;charset=utf-8');
        setExportFeedback(`Exported ${name}`);
      } else if (format === 'landxml') {
        const xml = buildLandXmlSurface(project, activeDemGrid);
        const name = slugifyFilename(`${baseName}-tin-surface`, 'xml');
        downloadTextFile(xml, name, 'application/xml;charset=utf-8');
        setExportFeedback(`Exported ${name}`);
      } else {
        const dxf = buildEarthworksContoursDxf(contours, activeDemGrid.mgaZone);
        const name = slugifyFilename(`${baseName}-contours`, 'dxf');
        downloadTextFile(dxf, name, 'application/dxf;charset=utf-8');
        setExportFeedback(`Exported ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(`Export failed (${format.toUpperCase()}): ${msg}`);
    }
  };

  const displayedCutStr =
    volumeMode === 'manual'
      ? manualCutStr
      : String(Math.round(gridResult.cutVolumeM3));
  const displayedFillStr =
    volumeMode === 'manual'
      ? manualFillStr
      : String(Math.round(gridResult.fillVolumeM3));
  const displayedRetainingStr =
    retainingOverrideStr ?? String(Math.round(gridResult.retainingWallLengthM));

  const activeSoilSpec = SOIL_RATES_AUD[soilClass];
  const activeStateProfile = AU_STATE_SPATIAL_REGISTRY[activeState];
  const basemapLabel =
    basemapMode === 'satellite'
      ? 'Satellite'
      : basemapMode === 'dark-vector'
        ? 'Dark Map'
        : 'Offline Grid';
  const grossHa = effectiveResult.insideAreaSqm / 10_000;
  const devRiskStyle =
    effectiveResult.developability.riskLevel === 'Low Risk'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
      : effectiveResult.developability.riskLevel === 'Moderate Risk'
        ? 'border-amber-400/40 bg-amber-500/15 text-amber-300'
        : 'border-rose-500/45 bg-rose-500/18 text-rose-300';

  const pinnedDeltaAud = pinnedScenario
    ? effectiveResult.totalPackageAud - pinnedScenario.totalPackageAud
    : 0;
  const pinnedDeltaPct =
    pinnedScenario && pinnedScenario.totalPackageAud > 0
      ? (pinnedDeltaAud / pinnedScenario.totalPackageAud) * 100
      : 0;

  return (
    <div
      id="workbench-body"
      className="@container flex min-h-0 w-full flex-1 flex-col bg-[#0a0f16] text-slate-100"
    >
      {/* 1. TOP COMMAND BAR (Map Lab. DA Commercial GIS Workstation Header — @container responsive) */}
      <header className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-slate-400/14 bg-[#0d131c] px-2.5 py-1.5">
        {/* Left: Map Lab. DA Brand, Active Site Identity & Mandatory E2E Telemetry Badges */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#3daee9]/45 bg-[#3daee9]/15 text-[#3daee9]">
            <Compass size={14} />
          </span>
          <span
            data-testid="maplab-brand-wordmark"
            className="shrink-0 text-xs font-extrabold tracking-tight text-white"
          >
            Map Lab. <span className="text-[#3daee9]">DA</span>
          </span>
          <span className="hidden h-3.5 w-px bg-slate-600/40 sm:inline-block" />
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h1
              id="site-name"
              title={customSiteLabel ?? project.name}
              className="max-w-[130px] truncate text-[11px] font-semibold tracking-tight text-slate-200 @[1120px]:max-w-[180px]"
            >
              {customSiteLabel ?? project.name}
            </h1>
            <span
              id="site-state"
              className="font-mono-tech shrink-0 whitespace-nowrap rounded border border-[#3daee9]/35 bg-[#3daee9]/12 px-1.5 py-0.5 text-[10px] font-bold text-sky-300"
            >
              {activeState}
            </span>
            <span
              id="site-epsg"
              className="font-mono-tech inline-flex shrink-0 whitespace-nowrap rounded border border-slate-400/20 bg-[#131b26] px-1.5 py-0.5 text-[10px] text-slate-300"
            >
              {activeMga.mgaEpsg}
            </span>
            {activeParcelId && (
              <span
                data-testid="maplab-parcel-id-badge"
                title={`Legal Parcel ID: ${activeParcelId}`}
                className="font-mono-tech hidden max-w-[130px] shrink-0 truncate rounded border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-200 @[900px]:inline-flex"
              >
                {activeParcelId}
              </span>
            )}
            <span
              id="render-loop-badge"
              data-testid="render-loop-badge"
              data-render-state={renderActive ? 'ACTIVE' : 'PAUSED'}
              className={`font-mono-tech inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-semibold ${
                renderActive
                  ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                  : 'border-amber-400/35 bg-amber-500/12 text-amber-300'
              }`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              <span id="render-loop-text">
                {renderActive ? 'Render Loop: ACTIVE' : 'Render Loop: PAUSED'}
              </span>
            </span>
          </div>
        </div>

        {/* Center: AU Address / Lat-Lng Search + 1-Tap GPS + Universal 8-State Quick Jumps */}
        <div className="relative flex min-w-0 basis-full items-center gap-1.5 @[620px]:basis-auto @[620px]:flex-1 @[620px]:justify-center">
          <form
            onSubmit={(e) => void handleAddressSearch(e)}
            className="flex min-w-0 flex-1 items-center rounded-md border border-slate-400/20 bg-[#080d14] px-2 py-1 focus-within:border-[#3daee9]/65 @[620px]:max-w-[240px]"
          >
            <Search size={12} className="mr-1.5 shrink-0 text-slate-400" />
            <input
              type="text"
              data-testid="cutsheet-address-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="AU address or lat, lng..."
              aria-label="Search Australian address or coordinates"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={searchLoading}
              className="ml-1 shrink-0 cursor-pointer rounded bg-[#182332] px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-[#3daee9] hover:text-slate-950 disabled:opacity-50"
            >
              {searchLoading ? <Loader2 size={10} className="animate-spin" /> : 'Go'}
            </button>
          </form>

          {/* 1-Tap GPS Locate My Site */}
          <button
            type="button"
            data-testid="maplab-gps-btn"
            disabled={gpsLoading}
            onClick={handleLocateMySite}
            title="Locate My Site (GPS + Auto Legal Parcel Snap)"
            aria-label="Locate My Site using GPS"
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-400/22 bg-[#141d2a] px-2 text-[10.5px] font-semibold text-sky-200 transition-colors hover:border-[#3daee9]/60 hover:text-white disabled:opacity-50"
          >
            {gpsLoading ? (
              <Loader2 size={12} className="animate-spin text-[#3daee9]" />
            ) : (
              <LocateFixed size={12} className="text-[#3daee9]" />
            )}
            <span className="hidden @[820px]:inline">GPS</span>
          </button>

          {/* Compact 8-State Quick-Jump Select (Mobile / Tablet / Narrow Window < 1180px) */}
          <select
            aria-label="Jump to any Australian state or territory"
            data-testid="maplab-state-select"
            value={activeState}
            onChange={(e) => {
              const target = ALL_8_AU_CAPITALS.find((c) => c.state === e.target.value);
              if (target) handleCapitalJump(target);
            }}
            className="font-mono-tech h-8 shrink-0 cursor-pointer rounded-md border border-slate-400/22 bg-[#080d14] px-1.5 text-[10.5px] font-semibold text-sky-200 focus:border-[#3daee9] focus:outline-none @[1180px]:hidden"
          >
            {ALL_8_AU_CAPITALS.map((city) => (
              <option key={city.state} value={city.state}>
                {city.state} · {city.capitalLabel}
              </option>
            ))}
          </select>

          {/* All 8 Australian Capitals Quick-Jump Bar (Desktop >= 1180px) */}
          <div className="hidden items-center gap-0.5 rounded-md border border-slate-400/15 bg-[#080d14] p-0.5 @[1180px]:flex">
            {ALL_8_AU_CAPITALS.map((city) => (
              <button
                key={city.state}
                type="button"
                data-testid={`maplab-jump-${city.state.toLowerCase()}`}
                onClick={() => handleCapitalJump(city)}
                title={`Jump to ${city.capitalLabel} (${city.state} • ${city.authority})`}
                className={`cursor-pointer whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  activeState === city.state
                    ? 'bg-[#3daee9]/20 text-sky-200'
                    : 'text-slate-300 hover:bg-[#192638] hover:text-white'
                }`}
              >
                {city.state}
              </button>
            ))}
          </div>

          {/* Search dropdown results */}
          {(searchResults.length > 0 || searchError) && (
            <div className="absolute top-full left-1/2 z-40 mt-1 w-72 max-w-[92vw] -translate-x-1/2 rounded-lg border border-slate-400/25 bg-[#0f1723] p-1.5 shadow-2xl">
              {searchError ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-rose-200"
                >
                  <span>{searchError}</span>
                  <button
                    type="button"
                    onClick={() => setSearchError(null)}
                    className="cursor-pointer text-slate-400 hover:text-white"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {searchResults.map((addr) => (
                    <li key={addr.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectAddress(addr)}
                        className="flex w-full cursor-pointer flex-col rounded px-2 py-1 text-left transition-colors hover:bg-[#1a2738]"
                      >
                        <span className="truncate text-[11px] font-medium text-slate-100">
                          {addr.label}
                        </span>
                        <span className="font-mono-tech text-[9.5px] text-slate-400">
                          {addr.state} • {addr.mgaEpsg} ({addr.lat.toFixed(4)},{' '}
                          {addr.lng.toFixed(4)})
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Right: My Sites Cloud Vault, Basemap, Share, 3D Map, 3D Studio */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            data-testid="maplab-vault-btn"
            onClick={() => setVaultOpen(true)}
            title={
              session
                ? `My Saved Sites (${session.email})`
                : 'Sign In to Save & Manage Private Sites'
            }
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors ${
              session
                ? 'border-emerald-400/40 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/20'
                : 'border-slate-400/25 bg-[#141d2a] text-slate-100 hover:border-[#3daee9]/55 hover:text-white'
            }`}
          >
            {session ? <FolderOpen size={11} /> : <User size={11} className="text-[#3daee9]" />}
            <span>{session ? `Sites (${savedDeals.length})` : 'Sign In'}</span>
          </button>

          <button
            type="button"
            data-testid="cutsheet-basemap-btn"
            onClick={handleCycleBasemap}
            title="Cycle Basemap (Satellite / Dark Vector / Offline Grid)"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-400/20 bg-[#141d2a] px-2 py-1 text-[10.5px] font-medium text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white"
          >
            <Globe size={11} className="text-[#3daee9]" />
            <span className="hidden sm:inline">{basemapLabel}</span>
          </button>

          <button
            type="button"
            data-testid="cutsheet-share-btn"
            onClick={() => void handleShareSite()}
            title="Copy shareable URL with site polygon & grading state"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-400/20 bg-[#141d2a] px-2 py-1 text-[10.5px] font-medium text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white"
          >
            {shareCopied ? (
              <Check size={11} className="text-emerald-300" />
            ) : (
              <Share2 size={11} className="text-slate-300" />
            )}
            <span className="hidden @[760px]:inline">
              {shareCopied ? 'Copied' : 'Share'}
            </span>
          </button>

          <button
            type="button"
            data-testid="cutsheet-3d-map-btn"
            onClick={() => {
              setViewportMode('map');
              setIs3dMap((v) => !v);
            }}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors ${
              viewportMode === 'map' && is3dMap
                ? 'border-[#3daee9]/65 bg-[#3daee9]/20 text-sky-200'
                : 'border-slate-400/20 bg-[#141d2a] text-slate-200 hover:border-[#3daee9]/50 hover:text-white'
            }`}
          >
            <MapIcon size={11} />
            <span>3D Map</span>
          </button>

          <button
            type="button"
            data-testid="cutsheet-3d-studio-btn"
            onClick={() =>
              setViewportMode((m) => (m === '3d-studio' ? 'map' : '3d-studio'))
            }
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
              viewportMode === '3d-studio'
                ? 'border-[#3daee9] bg-[#3daee9] text-slate-950'
                : 'border-[#3daee9]/45 bg-[#3daee9]/15 text-sky-200 hover:bg-[#3daee9]/25'
            }`}
          >
            <Box size={11} />
            <span>3D Studio</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSTATION 3-ZONE BODY (CAD Rail | Full-Bleed Map/3D | Right Site Inspector) */}
      <div className="flex min-h-0 flex-1 flex-col min-[680px]:flex-row min-[680px]:overflow-hidden">
        {/* ZONE A: VERTICAL CAD TOOL RAIL (44x44px Thumb-Friendly Horizontal Strip on <680px mobile) */}
        <aside
          aria-label="CAD Terrain Tools"
          className="flex shrink-0 flex-row items-center justify-between gap-1 overflow-x-auto border-b border-slate-400/14 bg-[#0d131c] px-2 py-1.5 min-[680px]:w-[44px] min-[680px]:flex-col min-[680px]:justify-start min-[680px]:overflow-visible min-[680px]:border-r min-[680px]:border-b-0 min-[680px]:px-0 min-[680px]:py-2"
        >
          <div className="flex flex-row items-center gap-1 min-[680px]:flex-col">
            <button
              type="button"
              title="Select / Pan Map (Esc)"
              onClick={() => {
                setViewportMode('map');
                setActiveTool('select');
              }}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                viewportMode === 'map' && activeTool === 'select'
                  ? 'border-[#3daee9]/65 bg-[#3daee9]/20 text-sky-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <MousePointer2 size={15} />
            </button>

            <button
              type="button"
              data-testid="maplab-parcel-snap-tool"
              title="1-Tap Legal Parcel Snap (All 8 AU States)"
              onClick={() => {
                setViewportMode('map');
                setShowCadastre(true);
                setActiveTool((t) =>
                  t === 'cadastre-snap' ? 'select' : 'cadastre-snap',
                );
              }}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                activeTool === 'cadastre-snap'
                  ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <Crosshair size={15} />
            </button>

            <button
              type="button"
              title="Draw Custom Site Polygon"
              onClick={() => {
                setViewportMode('map');
                setActiveTool((t) =>
                  t === 'draw-polygon' ? 'select' : 'draw-polygon',
                );
              }}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                activeTool === 'draw-polygon'
                  ? 'border-[#3daee9]/65 bg-[#3daee9]/20 text-sky-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <Pentagon size={15} />
            </button>

            <button
              type="button"
              title="Draw Site Rectangle (2 taps)"
              onClick={() => {
                setViewportMode('map');
                setActiveTool((t) =>
                  t === 'draw-rect' ? 'select' : 'draw-rect',
                );
              }}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                activeTool === 'draw-rect'
                  ? 'border-[#3daee9]/65 bg-[#3daee9]/20 text-sky-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <Square size={15} />
            </button>

            <button
              type="button"
              title="Draw Elevation Cross-Section A–A'"
              onClick={() => {
                setViewportMode('map');
                setSectionDrawerOpen(true);
                setActiveTool((t) =>
                  t === 'draw-section' ? 'select' : 'draw-section',
                );
              }}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                activeTool === 'draw-section'
                  ? 'border-amber-400/65 bg-amber-500/20 text-amber-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <Activity size={15} />
            </button>

            <button
              type="button"
              data-testid="maplab-cadastre-toggle-btn"
              title={`Toggle Live ${activeState} Cadastral Boundaries (${activeStateProfile.authority})`}
              onClick={() => setShowCadastre((v) => !v)}
              className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors min-[680px]:h-8 min-[680px]:w-8 ${
                showCadastre
                  ? 'border-sky-400/65 bg-sky-500/20 text-sky-200'
                  : 'border-transparent text-slate-400 hover:bg-[#172231] hover:text-white'
              }`}
            >
              <Layers size={15} />
            </button>

            <div className="mx-1 h-5 w-px bg-slate-400/15 min-[680px]:mx-0 min-[680px]:my-1 min-[680px]:h-px min-[680px]:w-5" />

            <button
              type="button"
              data-testid="cutsheet-fetch-terrarium-btn"
              disabled={demLoading}
              onClick={() => void handleFetchTerrarium()}
              title="Analyse Site — Stream Live AWS Terrarium DEM"
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#3daee9]/40 bg-[#3daee9]/15 text-sky-300 transition-colors hover:bg-[#3daee9] hover:text-slate-950 disabled:opacity-50 min-[680px]:h-8 min-[680px]:w-8"
            >
              {demLoading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}
            </button>

            <label
              title="Upload ELVIS 1m LiDAR GeoTIFF (.tif) or Survey CSV/XYZ"
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-slate-300 transition-colors hover:bg-[#172231] hover:text-white min-[680px]:h-8 min-[680px]:w-8"
            >
              <Upload size={15} />
              <input
                ref={fileInputRef}
                type="file"
                data-testid="cutsheet-upload-dem-input"
                accept=".tif,.tiff,.csv,.xyz,.txt"
                disabled={demLoading}
                onChange={(e) => void handleDemFileUpload(e)}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              title="Reset to Active Workspace Parcel & Local DTM"
              onClick={handleResetWorkspaceParcel}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:bg-[#172231] hover:text-rose-300 min-[680px]:h-8 min-[680px]:w-8"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          <button
            type="button"
            title={inspectorOpen ? 'Collapse Site Inspector' : 'Open Site Inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-slate-400/15 text-slate-300 transition-colors hover:bg-[#172231] hover:text-white min-[680px]:mt-auto min-[680px]:h-8 min-[680px]:w-8"
          >
            {inspectorOpen ? (
              <PanelRightClose size={15} />
            ) : (
              <PanelRightOpen size={15} />
            )}
          </button>
        </aside>

        {/* ZONE B: FULL-BLEED CENTER VIEWPORT (MapLibre 2D/3D Map or Three.js 3D Studio + Section Drawer) */}
        <section
          className={`relative min-w-0 flex-1 flex-col overflow-hidden bg-[#070b14] ${
            mobileSheetMode === 'inspector'
              ? 'hidden min-[680px]:flex'
              : mobileSheetMode === 'map'
                ? 'flex min-h-[70vh] min-[680px]:min-h-[300px]'
                : 'flex min-h-[320px] min-[680px]:min-h-[300px]'
          }`}
        >
          {/* DEM Loading Pill */}
          {demLoading && (
            <div className="pointer-events-none absolute bottom-10 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#3daee9]/45 bg-[#0c1420]/95 px-3 py-1 text-[11px] font-medium text-sky-200 shadow-xl backdrop-blur">
              <Loader2 size={12} className="animate-spin text-[#3daee9]" />
              <span>{demLoadingLabel || 'Streaming elevation data...'}</span>
            </div>
          )}

          {/* Live 8-State Parcel Snap / GPS Notice Banner */}
          {parcelSnapNotice && (
            <div
              role={parcelSnapNotice.kind === 'error' ? 'alert' : 'status'}
              data-testid="maplab-parcel-notice"
              className={`z-30 flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px] backdrop-blur ${
                parcelSnapNotice.kind === 'success'
                  ? 'border-emerald-400/35 bg-emerald-950/85 text-emerald-100'
                  : parcelSnapNotice.kind === 'warning'
                    ? 'border-amber-400/35 bg-amber-950/85 text-amber-100'
                    : 'border-rose-500/40 bg-rose-950/90 text-rose-100'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{parcelSnapNotice.text}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                {parcelSnapNotice.retryCoords && (
                  <button
                    type="button"
                    onClick={() => {
                      const coords = parcelSnapNotice.retryCoords;
                      if (coords) void handleParcelSnapAtPoint(coords.lat, coords.lng);
                    }}
                    className="cursor-pointer rounded border border-current/35 bg-white/10 px-2 py-0.5 text-[10px] font-semibold hover:bg-white/20"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss parcel notice"
                  onClick={() => setParcelSnapNotice(null)}
                  className="cursor-pointer opacity-75 hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          {/* DEM / Validation Error Alerts */}
          {(demError || validationError) && (
            <div className="z-30 flex flex-col gap-1 border-b border-rose-500/35 bg-rose-950/85 px-3 py-1.5 text-[11px] text-rose-100 backdrop-blur">
              {demError && (
                <div
                  role="alert"
                  data-testid="cutsheet-dem-error"
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0 text-rose-400" />
                    <span className="truncate">{demError}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDemError(null)}
                    className="cursor-pointer text-rose-300 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {validationError && (
                <div
                  id="validation-error"
                  role="alert"
                  className="flex items-center justify-between gap-2"
                >
                  <span
                    id="validation-error-text"
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <AlertTriangle size={12} className="shrink-0 text-rose-400" />
                    <span>{validationError}</span>
                  </span>
                  <button
                    type="button"
                    id="validation-reset-btn"
                    onClick={() => {
                      setVolumeMode('dem');
                      setRetainingOverrideStr(null);
                      setFflInputStr(activeDemGrid.meanAHD.toFixed(2));
                    }}
                    className="cursor-pointer rounded border border-rose-400/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold hover:bg-rose-500/30"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Primary Interactive Stage */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {viewportMode === 'map' ? (
              <TerrainMap2D
                grid={activeDemGrid}
                boundaryGeoJson={activeBoundary}
                contours={contours}
                showContours={showContours}
                terrainLensUrl={terrainLensUrl}
                terrainLensOpacity={lensOpacity}
                flowLinesGeoJson={hydrology.flowLinesGeoJson}
                showFlowLines={showFlowLines}
                depressionsGeoJson={hydrology.depressionsGeoJson}
                showDepressions={showDepressions}
                showCadastre={showCadastre}
                stateCode={activeState}
                basemapMode={basemapMode}
                onBasemapModeChange={setBasemapMode}
                is3dMap={is3dMap}
                activeTool={activeTool}
                onToolChange={setActiveTool}
                onBoundaryDrawn={handleBoundaryDrawn}
                onParcelSnapRequest={(lat, lng) =>
                  void handleParcelSnapAtPoint(lat, lng)
                }
                parcelSnapLoading={parcelSnapLoading}
                sectionStart={sectionStart}
                sectionEnd={sectionEnd}
                onSectionLineChange={(start, end) => {
                  setCustomTransect({ start, end });
                  setSectionDrawerOpen(true);
                }}
                onCursorMove={setCursorCoords}
                flyToTarget={flyToTarget}
                siteLng={activeSiteLng}
                siteLat={activeSiteLat}
                mgaZone={activeMga.mgaZone}
                mgaEpsg={activeMga.mgaEpsg}
              />
            ) : (
              <TerrainViewport3D
                grid={activeDemGrid}
                earthworksResult={effectiveResult}
                boundaryGeoJson={activeBoundary}
                targetFflAHD={effectiveResult.targetFflAHD}
                padSlopePct={0}
                renderActive={renderActive}
                onFrameTick={handleFrameTick}
                verticalExaggeration={verticalExaggeration}
                onVerticalExaggerationChange={setVerticalExaggeration}
                showWireframe={showWireframe}
                onShowWireframeChange={setShowWireframe}
                showFflPlane={showFflPlane}
                onShowFflPlaneChange={setShowFflPlane}
                fullBleed={true}
              />
            )}

            {/* Mobile Full-Map Restore Sheet Pill (<680px only) */}
            {mobileSheetMode === 'map' && (
              <button
                type="button"
                onClick={() => setMobileSheetMode('split')}
                className="absolute bottom-3 left-1/2 z-30 inline-flex min-h-[40px] -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-[#3daee9]/70 bg-[#0d141f]/95 px-4 py-1.5 text-xs font-bold text-sky-200 shadow-2xl backdrop-blur min-[680px]:hidden"
              >
                <ChevronUp size={14} />
                <span>
                  Deal &amp; RLV · {formatCompactAud(dealIntelligence.residualLandValueAud)}
                </span>
              </button>
            )}

            {/* Floating Bottom-Right Quick Section Toggle Pill */}
            <button
              type="button"
              data-testid="cutsheet-section-drawer-toggle"
              onClick={() => setSectionDrawerOpen((v) => !v)}
              className="absolute right-2.5 bottom-11 z-20 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-400/25 bg-[#0d141f]/92 px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 shadow-lg backdrop-blur transition-colors hover:border-[#3daee9]/60 hover:text-white"
            >
              <TrendingUp size={12} className="text-amber-300" />
              <span>Section A–A&prime;</span>
              {sectionDrawerOpen ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronUp size={11} />
              )}
            </button>
          </div>

          {/* Collapsible Section A–A' Profile Drawer */}
          {sectionDrawerOpen && (
            <div className="shrink-0 border-t border-slate-400/18 bg-[#0b1017] p-2">
              <SectionProfileChart
                profile={sectionProfile}
                targetFflAHD={effectiveResult.targetFflAHD}
                compact={true}
                onResetTransect={
                  customTransect ? () => setCustomTransect(null) : undefined
                }
              />
            </div>
          )}
        </section>

        {/* ZONE C: DOCKED RIGHT SITE INSPECTOR (4 Tabs: Deal & RLV | Cut & Cost | Terrain | Plan & Flow) */}
        {inspectorOpen && (
          <aside
            aria-label="Site Inspector"
            className={`w-full shrink-0 flex-col border-t border-slate-400/14 bg-[#0d131c] @[680px]:w-[320px] @[680px]:border-t-0 @[680px]:border-l @[1024px]:w-[368px] ${
              mobileSheetMode === 'map' ? 'hidden min-[680px]:flex' : 'flex'
            }`}
          >
            {/* Inspector Header + Live RLV Pill + Mobile Sheet Switcher */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-400/12 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[10.5px] font-bold tracking-wider text-slate-200 uppercase">
                  {activeParcelId
                    ? `Parcel ${activeParcelId}`
                    : customBoundary
                      ? 'Active Site Parcel'
                      : 'Site Inspector'}
                </div>
                <div className="font-mono-tech text-[10px] text-slate-400">
                  {grossHa.toFixed(2)} ha • {activeMga.mgaEpsg} •{' '}
                  {activeDemGrid.meanAHD.toFixed(1)}m AHD
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span
                  data-testid="maplab-header-rlv-pill"
                  title="Estimated Max Land Offer (Residual Land Value)"
                  className="font-mono-tech rounded border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300"
                >
                  RLV {formatCompactAud(dealIntelligence.residualLandValueAud)}
                </span>
                {/* Mobile Sheet Height Mode (<680px only) */}
                <div className="inline-flex rounded border border-slate-400/20 bg-[#080d14] p-0.5 text-[9.5px] min-[680px]:hidden">
                  {(
                    [
                      { id: 'map', label: 'Map' },
                      { id: 'split', label: 'Split' },
                      { id: 'inspector', label: 'Panel' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`maplab-mobile-sheet-${m.id}`}
                      onClick={() => setMobileSheetMode(m.id)}
                      className={`cursor-pointer rounded px-1.5 py-0.5 font-semibold ${
                        mobileSheetMode === m.id
                          ? 'bg-[#3daee9] text-slate-950'
                          : 'text-slate-400'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 4-Tab Switcher (Deal & RLV | Cut & Cost | Terrain | Plan & Flow) */}
            <div
              role="tablist"
              aria-label="Site Inspector Tabs"
              className="grid shrink-0 grid-cols-4 gap-1 border-b border-slate-400/12 bg-[#0a0f17] p-1.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'deal-rlv'}
                data-testid="maplab-tab-deal-rlv"
                onClick={() => handleSelectInspectorTab('deal-rlv')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  inspectorTab === 'deal-rlv'
                    ? 'border border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : 'border border-transparent text-slate-400 hover:bg-[#121a26] hover:text-slate-200'
                }`}
              >
                <Landmark size={11} />
                <span className="truncate">Deal</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'cut-cost'}
                data-testid="cutsheet-tab-cutcost"
                onClick={() => handleSelectInspectorTab('cut-cost')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  inspectorTab === 'cut-cost'
                    ? 'border border-[#3daee9]/50 bg-[#142235] text-sky-200'
                    : 'border border-transparent text-slate-400 hover:bg-[#121a26] hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal size={11} />
                <span className="truncate">Cut/Cost</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'terrain'}
                data-testid="cutsheet-tab-terrain"
                onClick={() => handleSelectInspectorTab('terrain')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  inspectorTab === 'terrain'
                    ? 'border border-[#3daee9]/50 bg-[#142235] text-sky-200'
                    : 'border border-transparent text-slate-400 hover:bg-[#121a26] hover:text-slate-200'
                }`}
              >
                <Mountain size={11} />
                <span className="truncate">Terrain</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'plan-flow'}
                data-testid="cutsheet-tab-planflow"
                onClick={() => handleSelectInspectorTab('plan-flow')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  inspectorTab === 'plan-flow'
                    ? 'border border-[#3daee9]/50 bg-[#142235] text-sky-200'
                    : 'border border-transparent text-slate-400 hover:bg-[#121a26] hover:text-slate-200'
                }`}
              >
                <Droplets size={11} />
                <span className="truncate">Flow</span>
              </button>
            </div>

            {/* Scrollable Inspector Body */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {/* ================= TAB 0: DEAL & RLV (PADDOCK-TO-OFFER INTELLIGENCE) ================= */}
              {inspectorTab === 'deal-rlv' && (
                <DealIntelligencePanel
                  intelligence={dealIntelligence}
                  fin={finInputs}
                  onFinChange={setFinInputs}
                  siteNameDraft={siteNameDraft}
                  onSiteNameDraftChange={setSiteNameDraft}
                  session={session}
                  onOpenAuthVault={() => setVaultOpen(true)}
                  onSaveDeal={handleSaveDeal}
                  saveBusy={saveBusy}
                  saveFeedback={saveFeedback}
                  onOptimizeForMaxRlv={handleOptimizeForMaxRlv}
                  optimizingRlv={optimizingRlv}
                  lastOptimization={lastRlvOpt}
                  onExportPdfMemo={() => handleExport('pdf')}
                  parcelProvenanceLabel={combinedProvenanceLabel}
                  parcelId={activeParcelId || undefined}
                />
              )}

              {/* ================= TAB 1: TERRAIN ================= */}
              {inspectorTab === 'terrain' && (
                <div
                  data-testid="cutsheet-inspector-terrain"
                  className="flex flex-col gap-3"
                >
                  {/* Terrain Lens Mode */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      <span>Terrain Lens Mode</span>
                      <span className="font-mono-tech text-slate-300">
                        {Math.round(lensOpacity * 100)}% opacity
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'hillshade', label: 'Hillshade' },
                          { id: 'slope-bands', label: 'Slope Bands' },
                          { id: 'cut-fill', label: 'Cut / Fill' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setViewportMode('map');
                            setLensMode(opt.id);
                          }}
                          className={`cursor-pointer rounded-md border px-2 py-1.5 text-[10.5px] font-semibold transition-colors ${
                            lensMode === opt.id
                              ? 'border-[#3daee9] bg-[#3daee9]/18 text-sky-200'
                              : 'border-slate-400/15 bg-[#0b1018] text-slate-300 hover:border-slate-400/35 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={lensOpacity}
                      onChange={(e) => setLensOpacity(Number(e.target.value))}
                      aria-label="Terrain Lens Opacity"
                      className="mt-2.5 w-full accent-[#3daee9]"
                    />
                  </div>

                  {/* Relief & Sun Illumination */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      Relief &amp; Sun Illumination
                    </div>
                    <div className="space-y-2 text-[11px]">
                      <label className="block">
                        <div className="flex justify-between text-slate-300">
                          <span>Vertical Exaggeration</span>
                          <span className="font-mono-tech text-sky-300">
                            {verticalExaggeration.toFixed(1)}×
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          step={0.25}
                          value={verticalExaggeration}
                          onChange={(e) =>
                            setVerticalExaggeration(Number(e.target.value))
                          }
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                      </label>
                      <label className="block">
                        <div className="flex justify-between text-slate-300">
                          <span>Sun Azimuth</span>
                          <span className="font-mono-tech text-sky-300">
                            {sunAzimuthDeg}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={5}
                          value={sunAzimuthDeg}
                          onChange={(e) =>
                            setSunAzimuthDeg(Number(e.target.value))
                          }
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                      </label>
                      <label className="block">
                        <div className="flex justify-between text-slate-300">
                          <span>Sun Altitude</span>
                          <span className="font-mono-tech text-sky-300">
                            {sunAltitudeDeg}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={80}
                          step={2}
                          value={sunAltitudeDeg}
                          onChange={(e) =>
                            setSunAltitudeDeg(Number(e.target.value))
                          }
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Elevation Contours */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        Elevation Contours
                      </span>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={showContours}
                          onChange={(e) => setShowContours(e.target.checked)}
                          className="accent-[#3daee9]"
                        />
                        <span>Visible</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {CONTOUR_INTERVALS.map((iv) => (
                        <button
                          key={iv}
                          type="button"
                          onClick={() => setContourIntervalM(iv)}
                          className={`font-mono-tech cursor-pointer rounded-md border py-1 text-[10.5px] font-semibold transition-colors ${
                            contourIntervalM === iv
                              ? 'border-[#3daee9] bg-[#3daee9]/18 text-sky-200'
                              : 'border-slate-400/15 bg-[#0b1018] text-slate-300 hover:text-white'
                          }`}
                        >
                          {iv}m
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Civil Slope Breakdown */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      <span>Civil Slope Breakdown</span>
                      <span className="font-mono-tech text-slate-200">
                        Avg {hydrology.avgSlopePct.toFixed(1)}%
                      </span>
                    </div>
                    {/* Segmented proportional bar */}
                    <div className="mb-2.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      {hydrology.slopeBands.map((band) => (
                        <div
                          key={band.id}
                          style={{
                            width: `${Math.max(0, band.pct)}%`,
                            backgroundColor: band.colorHex,
                          }}
                          title={`${band.label}: ${band.pct.toFixed(1)}% (${band.areaHa.toFixed(2)} ha)`}
                        />
                      ))}
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      {hydrology.slopeBands.map((band) => (
                        <div
                          key={band.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-1.5 text-slate-300">
                            <span
                              className="h-2 w-2 rounded-xs"
                              style={{ backgroundColor: band.colorHex }}
                            />
                            {band.label}
                          </span>
                          <span className="font-mono-tech text-slate-200">
                            {band.pct.toFixed(1)}%{' '}
                            <span className="text-slate-400">
                              · {band.areaHa.toFixed(2)} ha
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Actions: Cross-Section, ELVIS LiDAR & Cadastre */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSectionDrawerOpen((v) => !v)}
                      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-slate-400/20 bg-[#111824] px-2.5 py-2 text-[11px] font-semibold text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white"
                    >
                      <Activity size={12} className="text-amber-300" />
                      Cross-Section
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-slate-400/20 bg-[#111824] px-2.5 py-2 text-[11px] font-semibold text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white"
                    >
                      <Upload size={12} className="text-sky-300" />
                      ELVIS 1m LiDAR
                    </button>
                  </div>

                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-400/14 bg-[#111824] px-2.5 py-2 text-[11px] text-slate-200">
                    <span className="min-w-0 truncate">
                      {activeState} Live Cadastre ({activeStateProfile.authority})
                    </span>
                    <input
                      type="checkbox"
                      data-testid="maplab-terrain-cadastre-checkbox"
                      checked={showCadastre}
                      onChange={(e) => setShowCadastre(e.target.checked)}
                      className="shrink-0 accent-[#3daee9]"
                    />
                  </label>

                  {/* CRS & DTM Telemetry */}
                  <div className="space-y-1 rounded-lg border border-slate-400/12 bg-[#0a0f17] px-2.5 py-2 font-mono-tech text-[10px] text-slate-400">
                    <div className="flex justify-between gap-2">
                      <span>Source</span>
                      <span className="truncate text-slate-200">
                        {activeDemGrid.sourceLabel}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Metric CRS</span>
                      <span className="text-slate-200">
                        GDA2020 / Zone {activeMga.mgaZone} ({activeMga.mgaEpsg})
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>DTM Range</span>
                      <span className="text-slate-200">
                        {activeDemGrid.minAHD.toFixed(1)}m –{' '}
                        {activeDemGrid.maxAHD.toFixed(1)}m AHD
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ================= TAB 2: PLAN & FLOW (UNIFIED TRUE NDA + ENVIROSIM + OSD + D8) ================= */}
              {inspectorTab === 'plan-flow' && (
                <div
                  data-testid="cutsheet-inspector-planflow"
                  className="flex flex-col gap-3"
                >
                  {/* Unified True NDA Card */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wider text-sky-300 uppercase">
                      <Layers size={12} />
                      <span>Unified True NDA ({activeState})</span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
                      {STATE_PLANNING_AUTHORITY[activeState]} — fuses Horn slope
                      (&gt;15%), D8 channels, EnviroSim constraints &amp; OSD basin
                      footprint.
                    </p>

                    <div className="mt-2.5 flex items-baseline justify-between text-[11px]">
                      <span className="text-slate-300">True Net Developable</span>
                      <span
                        data-testid="maplab-true-nda-readout"
                        className="font-mono-tech font-bold text-emerald-300"
                      >
                        {dealIntelligence.trueNda.trueNdaHa.toFixed(2)} ha{' '}
                        <span className="font-normal text-slate-400">
                          ({Math.round(dealIntelligence.trueNda.trueNdaPct)}% ·{' '}
                          {dealIntelligence.trueNda.projectedYieldLots} lots)
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-rose-500/35">
                      <div
                        className="h-full bg-emerald-400 transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(0, dealIntelligence.trueNda.trueNdaPct))}%`,
                        }}
                      />
                    </div>

                    <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] p-1.5">
                        <div className="text-[9.5px] text-slate-400">
                          Civil Slope/D8
                        </div>
                        <div className="font-mono-tech mt-0.5 text-[11px] font-bold text-rose-300">
                          {(dealIntelligence.trueNda.civilConstrainedSqm / 10000).toFixed(2)} ha
                        </div>
                      </div>
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] p-1.5">
                        <div className="text-[9.5px] text-slate-400">
                          BAL/Flood/Env
                        </div>
                        <div className="font-mono-tech mt-0.5 text-[11px] font-bold text-amber-300">
                          {(dealIntelligence.trueNda.envConstrainedSqm / 10000).toFixed(2)} ha
                        </div>
                      </div>
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] p-1.5">
                        <div className="text-[9.5px] text-slate-400">
                          OSD Basin
                        </div>
                        <div className="font-mono-tech mt-0.5 text-[11px] font-bold text-sky-300">
                          {formatNum(dealIntelligence.trueNda.osdFootprintSqm)} m²
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Connected Environmental Constraints (EnviroSim Screening) */}
                  <div
                    data-testid="maplab-envirosim-card"
                    className="rounded-lg border border-amber-400/22 bg-[#111824] p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-amber-300 uppercase">
                        <ShieldAlert size={12} />
                        <span>EnviroSim Constraints ({activeState})</span>
                      </span>
                      <span className="font-mono-tech text-[10px] text-amber-200">
                        +{formatCompactAud(dealIntelligence.balUpliftTotalAud)} BAL
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {activeStateProfile.bushfireInstrument} ·{' '}
                      {activeStateProfile.floodDataset}
                    </p>

                    <div className="mt-2.5 space-y-2.5 text-[11px]">
                      <div>
                        <div className="mb-1 flex justify-between text-slate-300">
                          <span>AS 3959 Bushfire Rating (BAL)</span>
                          <span className="font-mono-tech text-amber-300">
                            {envConstraints.balRating} (+$
                            {formatNum(
                              BAL_BENCHMARKS[envConstraints.balRating].upliftPerLotAud,
                            )}
                            /lot)
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {(Object.keys(BAL_BENCHMARKS) as BalRating[]).map(
                            (rating) => (
                              <button
                                key={rating}
                                type="button"
                                data-testid={`maplab-bal-${rating.toLowerCase().replace('.', '_')}`}
                                onClick={() =>
                                  setEnvConstraints((prev) => ({
                                    ...prev,
                                    balRating: rating,
                                  }))
                                }
                                className={`font-mono-tech cursor-pointer rounded border px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                                  envConstraints.balRating === rating
                                    ? rating === 'BAL-FZ' || rating === 'BAL-40'
                                      ? 'border-rose-400 bg-rose-500/20 text-rose-200'
                                      : 'border-amber-400 bg-amber-500/20 text-amber-200'
                                    : 'border-slate-400/15 bg-[#0b1018] text-slate-300 hover:text-white'
                                }`}
                              >
                                {rating}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <label className="block">
                        <div className="flex justify-between text-slate-300">
                          <span>1% AEP Flood Overlay</span>
                          <span className="font-mono-tech text-sky-300">
                            {envConstraints.floodOverlayPct}% of lot
                          </span>
                        </div>
                        <input
                          type="range"
                          data-testid="maplab-flood-slider"
                          min={0}
                          max={80}
                          step={5}
                          value={envConstraints.floodOverlayPct}
                          onChange={(e) =>
                            setEnvConstraints((prev) => ({
                              ...prev,
                              floodOverlayPct: Number(e.target.value),
                            }))
                          }
                          aria-label="1% AEP Flood Overlay Percentage"
                          className="mt-1 w-full accent-sky-400"
                        />
                      </label>

                      <label className="block">
                        <div className="flex justify-between text-slate-300">
                          <span>Riparian / Biodiversity Corridor</span>
                          <span className="font-mono-tech text-emerald-300">
                            {envConstraints.riparianBiodiversityPct}% of lot
                          </span>
                        </div>
                        <input
                          type="range"
                          data-testid="maplab-riparian-slider"
                          min={0}
                          max={50}
                          step={5}
                          value={envConstraints.riparianBiodiversityPct}
                          onChange={(e) =>
                            setEnvConstraints((prev) => ({
                              ...prev,
                              riparianBiodiversityPct: Number(e.target.value),
                            }))
                          }
                          aria-label="Riparian Biodiversity Corridor Percentage"
                          className="mt-1 w-full accent-emerald-400"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Automated On-Site Detention (OSD) Basin Sizer (ARR 2019) */}
                  <div
                    data-testid="maplab-osd-sizer-card"
                    className="rounded-lg border border-sky-400/22 bg-[#111824] p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold tracking-wider text-sky-300 uppercase">
                        Auto OSD Basin Sizer (ARR 2019)
                      </span>
                      <span className="font-mono-tech text-[10px] text-slate-300">
                        {dealIntelligence.osd.rainfallIntensityMmHr} mm/hr ({activeState})
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] px-2 py-1.5">
                        <div className="text-[9.5px] text-slate-400">
                          Engineered Basin Vol
                        </div>
                        <div className="font-mono-tech mt-0.5 text-xs font-bold text-sky-300">
                          {formatNum(dealIntelligence.osd.engineeredBasinVolumeM3)} m³
                        </div>
                      </div>
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] px-2 py-1.5">
                        <div className="text-[9.5px] text-slate-400">
                          Est. OSD Civil Cost
                        </div>
                        <div className="font-mono-tech mt-0.5 text-xs font-bold text-amber-300">
                          {formatCompactAud(dealIntelligence.osd.estimatedOsdCostAud)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1 font-mono-tech text-[10px] text-slate-300">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Natural Pond Credit</span>
                        <span className="text-emerald-300">
                          -{formatNum(dealIntelligence.osd.naturalDepressionCreditM3)} m³
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Basin Footprint</span>
                        <span>
                          {formatNum(dealIntelligence.osd.basinFootprintSqm)} m²
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Rec. Outlet Invert</span>
                        <span>
                          {dealIntelligence.osd.recommendedInvertAHD.toFixed(2)} m AHD
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* D8 Overland Flow Engine Card */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                        D8 Overland Flow Engine
                      </span>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={showFlowLines}
                          onChange={(e) => setShowFlowLines(e.target.checked)}
                          className="accent-[#3daee9]"
                        />
                        <span>Flow Lines</span>
                      </label>
                    </div>

                    <div className="mt-2 rounded border border-sky-400/20 bg-[#0b1522] px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-300">
                      <strong className="text-sky-300">Cyan flow lines</strong>{' '}
                      trace concentrated downhill stormwater runoff (wider =
                      larger upstream catchment) into{' '}
                      <strong className="text-amber-300">
                        amber low-point basins
                      </strong>
                      .
                    </div>

                    <div className="mt-2.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300">
                          Catchment Threshold
                        </span>
                        <span className="font-mono-tech text-sky-300">
                          {hydrology.catchmentThresholdHa.toFixed(2)} ha (
                          {hydrology.catchmentThresholdCells} px)
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={1.2}
                        step={0.05}
                        value={catchmentThresholdHa}
                        onChange={(e) =>
                          setCatchmentThresholdHa(Number(e.target.value))
                        }
                        aria-label="Catchment Threshold Hectares"
                        className="mt-1 w-full accent-[#3daee9]"
                      />
                      <div className="flex justify-between text-[9.5px] text-slate-500">
                        <span>Dense swales</span>
                        <span>Major channels</span>
                      </div>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] px-2.5 py-2">
                        <div className="text-[10px] text-slate-400">
                          Active Reaches
                        </div>
                        <div
                          data-testid="cutsheet-active-reaches"
                          className="font-mono-tech mt-0.5 text-sm font-bold text-sky-300"
                        >
                          {hydrology.activeReaches}
                        </div>
                      </div>
                      <div className="rounded border border-slate-400/12 bg-[#0a0f17] px-2.5 py-2">
                        <div className="text-[10px] text-slate-400">
                          Peak Catchment
                        </div>
                        <div className="font-mono-tech mt-0.5 text-sm font-bold text-slate-100">
                          {hydrology.peakCatchmentHa.toFixed(2)} ha
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Low-Point Depressions Card */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                        Low-Point Depressions
                      </span>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={showDepressions}
                          onChange={(e) => setShowDepressions(e.target.checked)}
                          className="accent-amber-400"
                        />
                        <span>Highlight</span>
                      </label>
                    </div>

                    <div className="mt-2 flex items-center justify-between rounded border border-slate-400/12 bg-[#0a0f17] px-2.5 py-2">
                      <span className="text-[11px] text-slate-300">
                        Natural Storage Potential
                      </span>
                      <span className="font-mono-tech text-xs font-bold text-amber-300">
                        {formatNum(hydrology.naturalStorageM3)} m³
                      </span>
                    </div>

                    <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">
                      {hydrology.depressions.length > 0
                        ? `Detected ${hydrology.depressions.length} enclosed ponding basin(s) deeper than 0.15 m (max ${hydrology.maxDepressionDepthM.toFixed(2)} m, ${hydrology.depressionAreaHa.toFixed(2)} ha) requiring stormwater detention or fill.`
                        : 'No enclosed depressions deeper than 0.15 m detected inside the site polygon (free-draining surface).'}
                    </p>
                  </div>
                </div>
              )}

              {/* ================= TAB 3: CUT & COST (DEFAULT) ================= */}
              {inspectorTab === 'cut-cost' && (
                <div
                  data-testid="cutsheet-inspector-cutcost"
                  className="flex flex-col gap-2.5"
                >
                  {/* 1. Terrain Developability Score */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                        <Sparkles size={11} className="text-[#3daee9]" />
                        Terrain Developability
                      </span>
                      <span
                        data-testid="cutsheet-developability-badge"
                        className={`font-mono-tech rounded border px-2 py-0.5 text-[10.5px] font-bold ${devRiskStyle}`}
                      >
                        {effectiveResult.developability.score}/100 ·{' '}
                        {effectiveResult.developability.riskLevel}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10.5px] text-slate-400">
                      {effectiveResult.developability.drivers.join(' · ')}
                    </div>
                  </div>

                  {/* 2. Grading Strategy (4 Solvers + Heatmap + Pin A + Zero-Balance FFL) */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        Grading Strategy
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setViewportMode('map');
                            setLensMode((m) =>
                              m === 'cut-fill' ? 'hillshade' : 'cut-fill',
                            );
                          }}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                            lensMode === 'cut-fill'
                              ? 'border-amber-400/55 bg-amber-500/20 text-amber-200'
                              : 'border-slate-400/20 bg-[#0b1018] text-slate-300 hover:text-white'
                          }`}
                        >
                          <Flame size={10} />
                          Heatmap
                        </button>
                        <button
                          type="button"
                          data-testid="cutsheet-pin-scenario-btn"
                          onClick={handleTogglePinScenario}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                            pinnedScenario
                              ? 'border-emerald-400/55 bg-emerald-500/20 text-emerald-200'
                              : 'border-slate-400/20 bg-[#0b1018] text-slate-300 hover:text-white'
                          }`}
                        >
                          <Pin size={10} />
                          {pinnedScenario ? 'Unpin A' : 'Pin A'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {STRATEGY_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`cutsheet-strategy-${opt.id}`}
                          onClick={() => {
                            setGradingStrategy(opt.id);
                            setVolumeMode('dem');
                            setOptFeedback(null);
                            if (opt.id !== 'flat-pad' && targetCutFillRatio === null) {
                              setTargetCutFillRatio(1.1);
                            }
                          }}
                          className={`cursor-pointer rounded-md border px-2 py-1.5 text-left transition-colors ${
                            gradingStrategy === opt.id
                              ? 'border-[#3daee9] bg-[#3daee9]/18 text-sky-100'
                              : 'border-slate-400/15 bg-[#0b1018] text-slate-300 hover:border-slate-400/35 hover:text-white'
                          }`}
                        >
                          <div className="text-[11px] font-semibold">
                            {opt.label}
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Contextual Strategy Controls */}
                    {gradingStrategy !== 'flat-pad' && (
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10.5px]">
                          <span className="text-slate-300">
                            Target Cut:Fill Ratio
                          </span>
                          <span className="font-mono-tech font-semibold text-sky-300">
                            {(targetCutFillRatio ?? effectiveResult.cutFillRatio).toFixed(2)}{' '}
                            : 1
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.9}
                          max={1.35}
                          step={0.05}
                          value={targetCutFillRatio ?? 1.1}
                          onChange={(e) => {
                            setTargetCutFillRatio(Number(e.target.value));
                            setVolumeMode('dem');
                          }}
                          aria-label="Target Cut Fill Ratio"
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                        <div className="flex justify-between text-[9.5px] text-slate-500">
                          <span>1.00 balanced</span>
                          <span>1.10 compaction</span>
                          <span>1.25 bulking</span>
                        </div>
                      </div>
                    )}

                    {gradingStrategy === 'max-grade' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10.5px]">
                          <span className="text-slate-300">Max Design Grade</span>
                          <span className="font-mono-tech text-sky-300">
                            {maxGradePct.toFixed(1)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={12}
                          step={0.5}
                          value={maxGradePct}
                          onChange={(e) => {
                            setMaxGradePct(Number(e.target.value));
                            setVolumeMode('dem');
                          }}
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                      </div>
                    )}

                    {gradingStrategy === 'auto-terrace' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10.5px]">
                          <span className="text-slate-300">
                            Terrace Bench Step
                          </span>
                          <span className="font-mono-tech text-sky-300">
                            {terraceStepM.toFixed(1)} m
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.6}
                          max={2.4}
                          step={0.2}
                          value={terraceStepM}
                          onChange={(e) => {
                            setTerraceStepM(Number(e.target.value));
                            setVolumeMode('dem');
                          }}
                          className="mt-1 w-full accent-[#3daee9]"
                        />
                      </div>
                    )}

                    {/* Target Datum FFL + Zero-Balance Optimizer (always accessible!) */}
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-slate-400/12 pt-2">
                      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[10.5px] text-slate-300">
                        <span className="shrink-0">FFL</span>
                        <input
                          type="number"
                          step="0.1"
                          value={fflInputStr}
                          onChange={(e) => {
                            setTargetCutFillRatio(null);
                            setFflInputStr(e.target.value);
                            setVolumeMode('dem');
                          }}
                          aria-label="Target Finished Floor Level m AHD"
                          className="font-mono-tech w-full min-w-0 rounded border border-slate-400/22 bg-[#0a0f17] px-1.5 py-1 text-[11px] text-sky-200 focus:border-[#3daee9] focus:outline-none"
                        />
                        <span className="shrink-0 text-[9.5px] text-slate-400">
                          m AHD
                        </span>
                      </label>
                      <button
                        type="button"
                        data-testid="cutsheet-optimize-ffl-btn"
                        onClick={handleOptimizeZeroBalanceFfl}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[10.5px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25"
                      >
                        <Sparkles size={11} />
                        Zero-Balance
                      </button>
                    </div>
                    {optFeedback && (
                      <div className="font-mono-tech mt-1.5 rounded border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                        {optFeedback}
                      </div>
                    )}
                  </div>

                  {/* Pinned Scenario A Live Delta Banner */}
                  {pinnedScenario && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/35 bg-[#0e1c2d] px-2.5 py-1.5 font-mono-tech text-[10.5px]">
                      <span className="truncate text-slate-300">
                        Δ vs Pin A ({pinnedScenario.label})
                      </span>
                      <span
                        className={
                          pinnedDeltaAud <= 0
                            ? 'font-bold text-emerald-300'
                            : 'font-bold text-rose-300'
                        }
                      >
                        {pinnedDeltaAud >= 0 ? '+' : ''}
                        {formatCompactAud(pinnedDeltaAud)} (
                        {pinnedDeltaPct >= 0 ? '+' : ''}
                        {pinnedDeltaPct.toFixed(0)}%)
                      </span>
                    </div>
                  )}

                  {/* 3. Est. Civil Siteworks (AUD) + Edit Rates Drawer */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-wider text-emerald-300 uppercase">
                        Est. Civil Siteworks (AUD)
                      </span>
                      <button
                        type="button"
                        data-testid="cutsheet-edit-rates-btn"
                        onClick={() => setEditRatesOpen((v) => !v)}
                        className="inline-flex cursor-pointer items-center gap-1 text-[10.5px] font-semibold text-sky-300 hover:text-sky-200"
                      >
                        <span>Edit Rates</span>
                        {editRatesOpen ? (
                          <ChevronUp size={11} />
                        ) : (
                          <ChevronDown size={11} />
                        )}
                      </button>
                    </div>

                    {/* 3 Hero KPI Tiles */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-md border border-emerald-400/25 bg-emerald-950/35 px-2 py-1.5">
                        <div className="text-[9px] font-semibold tracking-wider text-emerald-300/80 uppercase">
                          Total Est.
                        </div>
                        <div
                          id="total-earthworks-out"
                          className="font-mono-tech mt-0.5 text-sm font-bold text-emerald-300"
                        >
                          {formatCompactAud(effectiveResult.totalPackageAud)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-400/12 bg-[#0a0f17] px-2 py-1.5">
                        <div className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                          Per Lot
                        </div>
                        <div className="font-mono-tech mt-0.5 text-sm font-bold text-slate-100">
                          {formatCompactAud(effectiveResult.costPerLotAud)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-400/12 bg-[#0a0f17] px-2 py-1.5">
                        <div className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                          Per Ha
                        </div>
                        <div className="font-mono-tech mt-0.5 text-sm font-bold text-slate-100">
                          {formatCompactAud(effectiveResult.costPerHaAud)}
                        </div>
                      </div>
                    </div>

                    {/* Itemised Commercial QS Breakdown */}
                    <div className="mt-2.5 space-y-1 text-[11px]">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          Bulk Cut-to-Fill (${customRates.cutRate ?? activeSoilSpec.cutRate}/m³)
                        </span>
                        <span
                          id="bulk-cost-out"
                          className="font-mono-tech font-semibold text-slate-100"
                        >
                          {formatCompactAud(
                            effectiveResult.cutCostAud +
                              effectiveResult.fillPlacementCostAud,
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          {effectiveResult.netBalanceM3 >= 0
                            ? 'Spoil Export & Tip'
                            : 'Imported Engineered Fill'}
                        </span>
                        <span className="font-mono-tech font-semibold text-slate-100">
                          {formatCompactAud(effectiveResult.haulOrImportCostAud)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          Basalt/Rock Breakout ({effectiveResult.rockBreakoutPct}%)
                        </span>
                        <span className="font-mono-tech font-semibold text-slate-100">
                          {formatCompactAud(effectiveResult.rockBreakoutCostAud)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          Retaining Walls ({formatNum(effectiveResult.retainingWallLengthM)} lm)
                        </span>
                        <span
                          id="retaining-cost-out"
                          className="font-mono-tech font-semibold text-amber-300"
                        >
                          {formatCompactAud(effectiveResult.retainingWallCostAud)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          Topsoil Strip &amp; Respread ({topsoilDepthMm}mm)
                        </span>
                        <span className="font-mono-tech font-semibold text-slate-100">
                          {formatCompactAud(effectiveResult.topsoilCostAud)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between border-t border-slate-400/12 pt-1.5 font-mono-tech text-[10px] text-slate-400">
                      <span>Yield: {effectiveResult.estimatedLots} lots</span>
                      <span>${effectiveResult.costPerSqmAud.toFixed(0)}/m²</span>
                    </div>

                    {/* Collapsible Edit Rates & Geotech Drawer */}
                    {editRatesOpen && (
                      <div className="mt-2.5 space-y-2 rounded-md border border-slate-400/18 bg-[#090e15] p-2 text-[10.5px]">
                        <div className="grid grid-cols-3 gap-1">
                          {(['sand', 'clay', 'rock'] as const).map((sc) => (
                            <button
                              key={sc}
                              type="button"
                              onClick={() => handleSoilClassChange(sc)}
                              className={`cursor-pointer rounded border py-1 text-[10px] font-semibold uppercase ${
                                soilClass === sc
                                  ? 'border-[#3daee9] bg-[#3daee9]/18 text-sky-200'
                                  : 'border-slate-400/15 bg-[#111824] text-slate-400 hover:text-white'
                              }`}
                            >
                              {sc}
                            </button>
                          ))}
                        </div>
                        {rateInputError && (
                          <div
                            role="alert"
                            className="rounded border border-rose-500/40 bg-rose-500/12 px-2 py-1 text-[10px] text-rose-200"
                          >
                            {rateInputError}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="block text-slate-400">
                            Cut $/m³
                            <input
                              type="number"
                              min={0}
                              max={500}
                              value={customRates.cutRate ?? activeSoilSpec.cutRate}
                              onChange={(e) => {
                                const check = validateNonNegativeNumber(
                                  e.target.value,
                                  'Cut rate',
                                  500,
                                );
                                if (!check.valid) {
                                  setRateInputError(check.error);
                                  return;
                                }
                                setRateInputError(null);
                                setCustomRates((r) => ({
                                  ...r,
                                  cutRate: Number(e.target.value),
                                }));
                              }}
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1.5 py-0.5 text-slate-100"
                            />
                          </label>
                          <label className="block text-slate-400">
                            Rock Breakout %
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={rockBreakoutPct}
                              onChange={(e) =>
                                setRockBreakoutPct(
                                  Math.min(100, Math.max(0, Number(e.target.value))),
                                )
                              }
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1.5 py-0.5 text-slate-100"
                            />
                          </label>
                          <label className="block text-slate-400">
                            Topsoil (mm)
                            <input
                              type="number"
                              min={0}
                              max={500}
                              step={25}
                              value={topsoilDepthMm}
                              onChange={(e) =>
                                setTopsoilDepthMm(
                                  Math.min(500, Math.max(0, Number(e.target.value))),
                                )
                              }
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1.5 py-0.5 text-slate-100"
                            />
                          </label>
                          <label className="block text-slate-400">
                            Batter (1:N)
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={0.5}
                              value={batterSlopeRatio}
                              onChange={(e) =>
                                setBatterSlopeRatio(
                                  Math.min(10, Math.max(0, Number(e.target.value))),
                                )
                              }
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1.5 py-0.5 text-slate-100"
                            />
                          </label>
                          <label className="block text-slate-400">
                            Retaining Height
                            <select
                              value={String(retainingWallHeightM)}
                              onChange={(e) =>
                                setRetainingWallHeightM(Number(e.target.value))
                              }
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1 py-0.5 text-slate-100"
                            >
                              {RETAINING_WALL_HEIGHT_RATES.map((t) => (
                                <option key={t.heightM} value={String(t.heightM)}>
                                  {t.heightM.toFixed(1)}m (${t.rateAudPerM}/lm)
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-slate-400">
                            Retaining lm
                            <input
                              type="number"
                              min={0}
                              value={displayedRetainingStr}
                              onChange={(e) =>
                                setRetainingOverrideStr(e.target.value)
                              }
                              className="font-mono-tech mt-0.5 w-full rounded border border-slate-400/20 bg-[#111824] px-1.5 py-0.5 text-slate-100"
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. Earthworks Volumes & Direct QS Override */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2.5">
                    <div className="mb-2 flex items-center justify-between text-[10px]">
                      <span className="font-bold tracking-wider text-slate-400 uppercase">
                        Earthworks Volumes
                      </span>
                      <span className="font-mono-tech text-slate-300">
                        Ratio {effectiveResult.cutFillRatio.toFixed(2)}:1
                        {volumeMode === 'manual' && (
                          <button
                            type="button"
                            onClick={() => setVolumeMode('dem')}
                            className="ml-1.5 cursor-pointer text-sky-300 underline hover:text-white"
                          >
                            Reset DEM
                          </button>
                        )}
                      </span>
                    </div>

                    <div className="mb-2 flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-400">Gross / NDA</span>
                      <span className="font-mono-tech font-semibold text-slate-100">
                        {grossHa.toFixed(2)} ha{' '}
                        <span className="text-emerald-300">
                          ({hydrology.netDevelopableAreaHa.toFixed(2)} NDA)
                        </span>
                      </span>
                    </div>

                    {/* Editable Total Cut & Total Fill Cards (preserves #cut-volume-input & #fill-volume-input!) */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="rounded-md border border-rose-500/28 bg-rose-950/25 p-2">
                        <label
                          htmlFor="cut-volume-input"
                          className="block text-[9.5px] font-bold tracking-wider text-rose-300 uppercase"
                        >
                          Total Cut (m³)
                        </label>
                        <input
                          id="cut-volume-input"
                          type="number"
                          min={0}
                          step={50}
                          value={displayedCutStr}
                          onChange={(e) => handleCutManualChange(e.target.value)}
                          className="font-mono-tech mt-0.5 w-full rounded border border-rose-400/20 bg-[#0b1018]/90 px-1.5 py-0.5 text-sm font-bold text-rose-200 focus:border-rose-400 focus:outline-none"
                        />
                        <div className="font-mono-tech mt-0.5 text-[9.5px] text-slate-400">
                          Max {effectiveResult.maxCutDepthM.toFixed(2)} m
                        </div>
                      </div>

                      <div className="rounded-md border border-sky-400/28 bg-sky-950/25 p-2">
                        <label
                          htmlFor="fill-volume-input"
                          className="block text-[9.5px] font-bold tracking-wider text-sky-300 uppercase"
                        >
                          Total Fill (m³)
                        </label>
                        <input
                          id="fill-volume-input"
                          type="number"
                          min={0}
                          step={50}
                          value={displayedFillStr}
                          onChange={(e) => handleFillManualChange(e.target.value)}
                          className="font-mono-tech mt-0.5 w-full rounded border border-sky-400/20 bg-[#0b1018]/90 px-1.5 py-0.5 text-sm font-bold text-sky-200 focus:border-sky-400 focus:outline-none"
                        />
                        <div className="font-mono-tech mt-0.5 text-[9.5px] text-slate-400">
                          Max {effectiveResult.maxFillDepthM.toFixed(2)} m
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 space-y-1 text-[10.5px]">
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          {effectiveResult.netBalanceM3 >= 0
                            ? 'Net Spoil Export'
                            : 'Net Fill Import'}
                        </span>
                        <span className="font-mono-tech font-semibold text-amber-300">
                          {effectiveResult.netBalanceM3 >= 0 ? '+' : ''}
                          {formatNum(effectiveResult.netBalanceM3)} m³
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Est. Truck &amp; Dog ({TIPPER_TRUCK_CAPACITY_M3} m³)
                        </span>
                        <span
                          id="haul-loads-out"
                          className="font-mono-tech text-slate-200"
                        >
                          ~{formatNum(effectiveResult.tipperLoads)} loads
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Avg Existing → Design Grade
                        </span>
                        <span className="font-mono-tech text-slate-200">
                          {effectiveResult.avgExistingGradePct.toFixed(1)}% →{' '}
                          <span className="text-emerald-300">
                            {effectiveResult.avgDesignGradePct.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 5. Primary Live OS Bridge Sync CTA -> Feaso OS */}
                  <div className="flex flex-col gap-1.5">
                    <button
                      id="send-earthworks-btn"
                      type="button"
                      disabled={Boolean(validationError)}
                      onClick={handleSendEarthworks}
                      className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#3daee9]/80 bg-gradient-to-b from-[#3daee9] to-[#238bc2] px-3 py-2 text-xs font-bold text-slate-950 shadow-md transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Send size={13} />
                      <span>Send Earthworks to Feasibility</span>
                    </button>

                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span
                        id="sync-status"
                        className={`font-mono-tech truncate ${
                          syncOk ? 'text-emerald-300' : 'text-slate-400'
                        }`}
                      >
                        {syncMessage}
                      </span>
                      <button
                        id="open-feaso-btn"
                        type="button"
                        onClick={() => openApp('feaso-os')}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-sky-300 hover:text-sky-200"
                      >
                        <ExternalLink size={10} />
                        Feaso OS
                      </button>
                    </div>
                  </div>

                  {/* 6. Engineering Exports (6 Commercial Formats) */}
                  <div className="rounded-lg border border-slate-400/14 bg-[#111824] p-2">
                    <div className="mb-1.5 flex items-center gap-1 text-[9.5px] font-bold tracking-wider text-slate-400 uppercase">
                      <Download size={10} className="text-[#3daee9]" />
                      <span>Engineering Exports</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        data-testid="cutsheet-export-pdf"
                        onClick={() => handleExport('pdf')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <FileText size={11} className="text-rose-300" />
                        PDF
                      </button>
                      <button
                        type="button"
                        data-testid="cutsheet-export-landxml"
                        onClick={() => handleExport('landxml')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <FileCode2 size={11} className="text-amber-300" />
                        LandXML
                      </button>
                      <button
                        type="button"
                        data-testid="cutsheet-export-dxf"
                        onClick={() => handleExport('dxf')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <Layers size={11} className="text-sky-300" />
                        DXF
                      </button>
                      <button
                        type="button"
                        data-testid="cutsheet-export-csv"
                        onClick={() => handleExport('csv')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <FileSpreadsheet size={11} className="text-emerald-300" />
                        BOQ CSV
                      </button>
                      <button
                        type="button"
                        data-testid="cutsheet-export-geojson"
                        onClick={() => handleExport('geojson')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <Globe size={11} className="text-sky-300" />
                        GeoJSON
                      </button>
                      <button
                        type="button"
                        data-testid="cutsheet-export-xyz"
                        onClick={() => handleExport('xyz')}
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-slate-400/20 bg-[#172231] px-1.5 py-1.5 text-[10px] font-semibold text-slate-100 transition-colors hover:border-[#3daee9]/60 hover:bg-[#1e2d40]"
                      >
                        <FileSpreadsheet size={11} className="text-amber-300" />
                        XYZ CSV
                      </button>
                    </div>

                    {exportFeedback && (
                      <div className="font-mono-tech mt-1.5 flex items-center justify-between rounded border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[9.5px] text-emerald-200">
                        <span className="truncate">{exportFeedback}</span>
                        <button
                          type="button"
                          onClick={() => setExportFeedback(null)}
                          className="cursor-pointer text-emerald-300 hover:text-white"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    )}
                    {exportError && (
                      <div
                        role="alert"
                        className="mt-1.5 flex items-center justify-between rounded border border-rose-500/35 bg-rose-500/15 px-2 py-1 text-[9.5px] text-rose-100"
                      >
                        <span className="truncate">{exportError}</span>
                        <button
                          type="button"
                          onClick={() => setExportError(null)}
                          className="cursor-pointer text-rose-200 hover:text-white"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Inspector Footer Strip */}
            <div className="flex shrink-0 items-center justify-between border-t border-slate-400/12 bg-[#0a0f17] px-3 py-1.5 font-mono-tech text-[10px] text-slate-400">
              <span>
                {grossHa.toFixed(2)} ha · {activeMga.mgaEpsg}
              </span>
              <button
                type="button"
                disabled={demLoading}
                onClick={() => void handleFetchTerrarium()}
                className="inline-flex cursor-pointer items-center gap-1 font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-50"
              >
                <CloudDownload size={11} />
                Stream Live DEM
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* 3. BOTTOM TELEMETRY STATUS BAR */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-400/14 bg-[#080d14] px-3 py-1 font-mono-tech text-[10px] text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {(cursorCoords?.lat ?? activeSiteLat).toFixed(5)},{' '}
            {(cursorCoords?.lng ?? activeSiteLng).toFixed(5)}
          </span>
          <span className="rounded bg-[#111926] px-1.5 py-0.5 text-sky-300">
            {activeMga.mgaEpsg} · {activeDemGrid.cellSizeM.toFixed(1)}m
          </span>
          <span
            data-testid="cutsheet-dem-source"
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
              activeDemGrid.source === 'synthetic'
                ? 'bg-amber-500/12 text-amber-200'
                : 'bg-emerald-500/12 text-emerald-200'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {getDemProvenanceLabel(activeDemGrid.source)}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <span id="frame-counter" ref={frameCounterElRef} className="text-sky-300">
            frame #0
          </span>
          <span className="hidden text-slate-500 md:inline">
            Map Lab. DA · GDA2020 / MGA2020 · AHD Pre-feasibility screening
          </span>
        </div>
      </footer>

      {/* 4. CLOUD ACCOUNT & PRIVATE SAVED SITES VAULT DRAWER */}
      <DealVaultDrawer
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        session={session}
        onSessionChange={(nextSession) => {
          setSession(nextSession);
          setSaveFeedback(null);
          if (!nextSession) {
            setSavedDeals([]);
            setActiveDealId(null);
            if (typeof window !== 'undefined' && window.location.hash.includes('deal=')) {
              window.history.replaceState(null, '', `#tab=${inspectorTab}`);
            }
          }
        }}
        deals={savedDeals}
        dealsLoading={dealsLoading}
        dealsError={dealsError}
        onRefreshDeals={() => void refreshSavedDeals(session)}
        onOpenDeal={(deal) => {
          applySavedDealToWorkspace(deal);
          setVaultOpen(false);
        }}
        activeDealId={activeDealId}
        privateAccessBlockedMsg={privateAccessBlockedMsg}
        onClearAccessBlocked={() => setPrivateAccessBlockedMsg(null)}
      />
    </div>
  );
}

/**
 * Map Lab. DA — Commercial Australian Parcel, Civil Terrain, Hydrology & Deal Intelligence Platform.
 * Unifies all 8 Australian states & territories (NSW, VIC, QLD, WA, SA, TAS, ACT, NT) with live
 * cadastral parcel snapping, Horn 3x3 slope breakdown, Barnes Priority-Flood ponding, D8 overland
 * flow routing, automated ARR 2019 OSD basin sizing, EnviroSim BAL/Flood screening, 4 civil grading
 * solvers, iterative 8-state stamp duty & Residual Land Value (RLV) optimization, Three.js 3D Studio,
 * LandXML / DXF / PDF Memo / BOQ CSV / GeoJSON / XYZ exports, private cloud deal vault, and live
 * @devaware/os-bridge sync.
 */
export function CutSheetApp() {
  const {
    project,
    status,
    errorMessage,
    renderActive,
    sendPatch,
    notify,
    openApp,
    retryHandshake,
  } = useOsBridge('cutsheet-au');

  const effectiveBoundary = useMemo<FeatureCollection | null>(() => {
    if (!project) return null;
    return resolveEffectiveBoundary(project);
  }, [project]);

  const baselineSyntheticDem = useMemo<ElevationGrid | null>(() => {
    if (!project || !effectiveBoundary) return null;
    return buildBaselineSyntheticDem(project, effectiveBoundary);
  }, [effectiveBoundary, project]);

  const isSliceEmpty = Boolean(project && !hasEarthworksSlice(project));
  const grossAreaSqm =
    typeof project?.geometry?.grossAreaSqm === 'number' &&
    Number.isFinite(project.geometry.grossAreaSqm)
      ? project.geometry.grossAreaSqm
      : 40_000;

  const handleInitBaseline = () => {
    if (!project || !baselineSyntheticDem || !effectiveBoundary) return;
    const state = project.location.state;
    const defaultSoil = STATE_DEFAULT_SOIL[state] ?? 'clay';
    const opt = optimizeZeroBalanceFfl(
      baselineSyntheticDem,
      effectiveBoundary,
      {
        targetFflAHD: baselineSyntheticDem.meanAHD,
        soilClass: defaultSoil,
        batterSlopeRatio: 3,
      },
    );
    const baseline = computeGridEarthworks(
      baselineSyntheticDem,
      effectiveBoundary,
      {
        targetFflAHD: opt.optimalFflAHD,
        soilClass: defaultSoil,
        batterSlopeRatio: 3,
        retainingWallHeightM: 1.8,
        gradingStrategy: 'best-fit-plane',
        targetCutFillRatio: 1.1,
        rockBreakoutPct: 10,
        topsoilDepthM: 0.15,
      },
    );
    const payload = buildEarthworksPatchPayload(baseline, baselineSyntheticDem);
    sendPatch({ earthworks: payload });
    notify(
      'Australian Earthworks Baseline Initialised',
      `${project.name} calibrated to FFL ${opt.optimalFflAHD.toFixed(2)} m AHD`,
      'success',
    );
  };

  return (
    <AppShellFrame
      appName="Map Lab. DA"
      appSubtitle="Commercial Australian Parcel, Civil Terrain & Deal Intelligence"
      status={status}
      errorMessage={errorMessage}
      onRetryHandshake={retryHandshake}
      isSliceEmpty={isSliceEmpty}
      emptyTitle="No Civil Earthworks Model Initialised"
      emptyDescription={
        project
          ? `${project.name} (${project.location.state} • ${formatNum(grossAreaSqm)} m²) does not yet contain cut/fill volumes or an Australian Height Datum (AHD) finished floor level. Initialise a terrain & hydrology baseline to begin grading.`
          : undefined
      }
      initBaselineLabel="Initialise Australian Baseline"
      onInitBaseline={handleInitBaseline}
      layout="fullbleed"
      hideStandaloneBanner={true}
      className="overflow-y-auto min-[680px]:overflow-hidden"
    >
      {project && effectiveBoundary && baselineSyntheticDem && (
        <CutSheetWorkbench
          key={project.projectId}
          project={project}
          initialBoundary={effectiveBoundary}
          baselineSyntheticDem={baselineSyntheticDem}
          renderActive={renderActive}
          isStandalone={status === 'standalone'}
          sendPatch={sendPatch}
          notify={notify}
          openApp={openApp}
        />
      )}
    </AppShellFrame>
  );
}
