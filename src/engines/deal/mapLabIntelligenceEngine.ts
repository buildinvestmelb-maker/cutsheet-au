import type { FeatureCollection, Polygon } from 'geojson';
import type { AustralianState } from '../../bridge/types';
import { calculateAustralianStampDuty } from '../feasibility/auStampDuty';
import type { ElevationGrid } from '../earthworks/demLoader';
import {
  computeGridEarthworks,
  type CivilRateOverrides,
  type GradingStrategy,
  type SoilClass,
} from '../earthworks/gridVolumeEngine';
import type { HydrologyAnalysisResult } from '../earthworks/hydrologyEngine';

/**
 * Commercial site analysis area guardrails (per Map Lab. DA Blueprint).
 */
export const MIN_LIVE_SITE_AREA_HA = 0.02; // 200 m²
export const MAX_LIVE_SITE_AREA_HA = 500.0; // 5,000,000 m²

export type BalRating =
  | 'BAL-LOW'
  | 'BAL-12.5'
  | 'BAL-19'
  | 'BAL-29'
  | 'BAL-40'
  | 'BAL-FZ';

export type DevelopmentTypology = 'subdivision' | 'townhouses';

export interface EnvironmentalConstraintInputs {
  balRating: BalRating;
  floodOverlayPct: number;
  riparianBiodiversityPct: number;
}

export interface DealFinancialInputs {
  typology: DevelopmentTypology;
  targetLotSizeSqm: number;
  avgEndSalePricePerLotAud: number;
  servicingCostPerLotAud: number;
  statutoryContribPerLotAud: number;
  targetMarginOnCostPct: number;
  projectDurationMonths: number;
  financeRatePct: number;
  gstMarginScheme: boolean;
}

/**
 * AS 3959-2018 indicative construction & APZ setback uplift benchmarks.
 */
export const BAL_BENCHMARKS: Readonly<
  Record<
    BalRating,
    { label: string; upliftPerLotAud: number; setbackLossPct: number; riskLevel: 'Low' | 'Moderate' | 'High' | 'Extreme' }
  >
> = {
  'BAL-LOW': { label: 'BAL-LOW', upliftPerLotAud: 0, setbackLossPct: 0, riskLevel: 'Low' },
  'BAL-12.5': { label: 'BAL-12.5', upliftPerLotAud: 8500, setbackLossPct: 2, riskLevel: 'Low' },
  'BAL-19': { label: 'BAL-19', upliftPerLotAud: 16500, setbackLossPct: 4, riskLevel: 'Moderate' },
  'BAL-29': { label: 'BAL-29', upliftPerLotAud: 29000, setbackLossPct: 8, riskLevel: 'Moderate' },
  'BAL-40': { label: 'BAL-40', upliftPerLotAud: 48000, setbackLossPct: 14, riskLevel: 'High' },
  'BAL-FZ': { label: 'BAL-FZ (Flame Zone)', upliftPerLotAud: 85000, setbackLossPct: 24, riskLevel: 'Extreme' },
};

/**
 * ARR 2019 indicative 1% AEP 1-hour rainfall intensity (mm/hr) and state residential lot
 * sale price & statutory contribution benchmarks across all 8 Australian states & territories.
 */
export const STATE_MARKET_AND_HYDRO_BENCHMARKS: Readonly<
  Record<
    AustralianState,
    {
      rainfall1PctAepMmHr: number;
      avgLotSalePriceAud: number;
      servicingPerLotAud: number;
      statutoryContribPerLotAud: number;
      defaultLotSizeSqm: number;
    }
  >
> = {
  NSW: {
    rainfall1PctAepMmHr: 64,
    avgLotSalePriceAud: 540000,
    servicingPerLotAud: 78000,
    statutoryContribPerLotAud: 42000,
    defaultLotSizeSqm: 450,
  },
  VIC: {
    rainfall1PctAepMmHr: 48,
    avgLotSalePriceAud: 430000,
    servicingPerLotAud: 72000,
    statutoryContribPerLotAud: 34000,
    defaultLotSizeSqm: 420,
  },
  QLD: {
    rainfall1PctAepMmHr: 82,
    avgLotSalePriceAud: 410000,
    servicingPerLotAud: 69000,
    statutoryContribPerLotAud: 31000,
    defaultLotSizeSqm: 450,
  },
  WA: {
    rainfall1PctAepMmHr: 46,
    avgLotSalePriceAud: 365000,
    servicingPerLotAud: 64000,
    statutoryContribPerLotAud: 24000,
    defaultLotSizeSqm: 450,
  },
  SA: {
    rainfall1PctAepMmHr: 42,
    avgLotSalePriceAud: 355000,
    servicingPerLotAud: 62000,
    statutoryContribPerLotAud: 21000,
    defaultLotSizeSqm: 400,
  },
  TAS: {
    rainfall1PctAepMmHr: 38,
    avgLotSalePriceAud: 330000,
    servicingPerLotAud: 65000,
    statutoryContribPerLotAud: 18000,
    defaultLotSizeSqm: 500,
  },
  ACT: {
    rainfall1PctAepMmHr: 54,
    avgLotSalePriceAud: 580000,
    servicingPerLotAud: 82000,
    statutoryContribPerLotAud: 38000,
    defaultLotSizeSqm: 420,
  },
  NT: {
    rainfall1PctAepMmHr: 98,
    avgLotSalePriceAud: 315000,
    servicingPerLotAud: 74000,
    statutoryContribPerLotAud: 19000,
    defaultLotSizeSqm: 520,
  },
};

export function createDefaultDealFinancialInputs(
  state: AustralianState,
  typology: DevelopmentTypology = 'subdivision',
): DealFinancialInputs {
  const b = STATE_MARKET_AND_HYDRO_BENCHMARKS[state];
  const isTh = typology === 'townhouses';
  return {
    typology,
    targetLotSizeSqm: isTh ? 240 : b.defaultLotSizeSqm,
    avgEndSalePricePerLotAud: isTh ? Math.round(b.avgLotSalePriceAud * 1.45) : b.avgLotSalePriceAud,
    servicingCostPerLotAud: isTh ? Math.round(b.servicingPerLotAud * 1.15) : b.servicingPerLotAud,
    statutoryContribPerLotAud: b.statutoryContribPerLotAud,
    targetMarginOnCostPct: 20,
    projectDurationMonths: 24,
    financeRatePct: 8.25,
    gstMarginScheme: true,
  };
}

export interface SiteBoundaryCapCheck {
  ok: boolean;
  areaHa: number;
  severity: 'ok' | 'too-small' | 'too-large';
  message: string;
}

export function validateSiteAreaCap(grossAreaSqm: number): SiteBoundaryCapCheck {
  const areaHa = Number.isFinite(grossAreaSqm) && grossAreaSqm > 0 ? grossAreaSqm / 10000 : 0;
  if (areaHa < MIN_LIVE_SITE_AREA_HA) {
    return {
      ok: false,
      areaHa,
      severity: 'too-small',
      message: `Site area (${Math.round(grossAreaSqm)} m²) is below the ${MIN_LIVE_SITE_AREA_HA} ha (200 m²) minimum commercial screening threshold. Draw a larger lot boundary.`,
    };
  }
  if (areaHa > MAX_LIVE_SITE_AREA_HA) {
    return {
      ok: false,
      areaHa,
      severity: 'too-large',
      message: `Site area (${areaHa.toFixed(1)} ha) exceeds the ${MAX_LIVE_SITE_AREA_HA} ha live browser analysis cap. Split the precinct into stages under ${MAX_LIVE_SITE_AREA_HA} ha for accurate grid analysis.`,
    };
  }
  return { ok: true, areaHa, severity: 'ok', message: '' };
}

export interface TrueNdaBreakdown {
  grossAreaSqm: number;
  grossAreaHa: number;
  civilConstrainedSqm: number;
  envConstrainedSqm: number;
  osdFootprintSqm: number;
  trueNdaSqm: number;
  trueNdaHa: number;
  trueNdaPct: number;
  saleableLandSqm: number;
  projectedYieldLots: number;
}

export interface OsdBasinSizingResult {
  rainfallIntensityMmHr: number;
  imperviousRunoffCoeff: number;
  contributingCatchmentHa: number;
  requiredStorageM3: number;
  naturalDepressionCreditM3: number;
  engineeredBasinVolumeM3: number;
  basinFootprintSqm: number;
  recommendedInvertAHD: number;
  estimatedOsdCostAud: number;
}

export interface MapLabDealIntelligence {
  state: AustralianState;
  siteCap: SiteBoundaryCapCheck;
  trueNda: TrueNdaBreakdown;
  osd: OsdBasinSizingResult;
  balRiskLevel: 'Low' | 'Moderate' | 'High' | 'Extreme';
  balUpliftTotalAud: number;
  earthworksCostAud: number;
  earthworksCostPerLotAud: number;
  grossRealisationAud: number;
  netRealisationExGstAndSellingAud: number;
  totalDevelopmentCostExLandAud: number;
  financeHoldingCostAud: number;
  statutoryStampDutyAud: number;
  stampDutyEffectivePct: number;
  stampDutyAuthority: string;
  residualLandValueAud: number;
  rlvPerSqmAud: number;
  rlvPerHaAud: number;
  rlvPerLotAud: number;
  projectedMarginOnCostPct: number;
  projectedAnnualIrrPct: number;
  dealViabilityLabel: 'Strong Acquisition' | 'Viable (Negotiate)' | 'Marginal / High Civil Risk';
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Unified cross-app commercial intelligence engine connecting:
 * CutSheet Terrain & Hydrology + EnviroSim Constraints + FormGen Yield + Feaso OS 8-State RLV.
 */
export function computeMapLabDealIntelligence(params: {
  state: AustralianState;
  grossAreaSqm: number;
  hydrology: HydrologyAnalysisResult;
  earthworksCostAud: number;
  minElevationAHD: number;
  env: EnvironmentalConstraintInputs;
  fin: DealFinancialInputs;
}): MapLabDealIntelligence {
  const { state, hydrology, env, fin } = params;
  const safeGrossSqm = Math.max(100, Number.isFinite(params.grossAreaSqm) ? params.grossAreaSqm : 10000);
  const siteCap = validateSiteAreaCap(safeGrossSqm);
  const bench = STATE_MARKET_AND_HYDRO_BENCHMARKS[state];

  // 1. Automated On-Site Detention (OSD) Sizing from ARR 2019 Intensity + D8 Catchment + Depressions
  const imperviousC = fin.typology === 'townhouses' ? 0.85 : 0.72;
  const catchmentHa = Math.max(
    safeGrossSqm / 10000,
    hydrology.peakCatchmentHa > 0 ? hydrology.peakCatchmentHa : safeGrossSqm / 10000,
  );
  // Preliminary civil OSD screening formula: 1% AEP 1-hr runoff delta (post-dev C - pre-dev 0.30) * 0.42 attenuation factor
  const deltaC = Math.max(0.2, imperviousC - 0.3);
  const runoffDepthM = (bench.rainfall1PctAepMmHr / 1000) * deltaC * 0.42;
  const requiredStorageM3 = Math.round(catchmentHa * 10000 * runoffDepthM);
  const naturalCreditM3 = Math.round(
    Math.min(requiredStorageM3 * 0.35, Math.max(0, hydrology.naturalStorageM3)),
  );
  const engineeredBasinVolumeM3 = Math.max(25, requiredStorageM3 - naturalCreditM3);
  const basinFootprintSqm = Math.round(engineeredBasinVolumeM3 / 1.2); // 1.2m nominal extended detention depth
  const recommendedInvertAHD = Number(
    (
      (Number.isFinite(params.minElevationAHD) ? params.minElevationAHD : 25) - 0.4
    ).toFixed(2),
  );
  // Commercial civil OSD rate: $185/m³ detention basin + $22k outlet headwall / GPT
  const estimatedOsdCostAud = Math.round(engineeredBasinVolumeM3 * 185 + 22000);

  // 2. Unified True Net Developable Area (Civil Hydrology/Slope + EnviroSim BAL/Flood/Riparian + OSD)
  const civilLossFrac = clamp(1 - hydrology.netDevelopablePct / 100, 0, 0.75);
  const balInfo = BAL_BENCHMARKS[env.balRating] ?? BAL_BENCHMARKS['BAL-LOW'];
  const envLossFrac = clamp(
    (balInfo.setbackLossPct +
      clamp(env.floodOverlayPct, 0, 60) +
      clamp(env.riparianBiodiversityPct, 0, 50)) /
      100,
    0,
    0.85,
  );
  const osdLossFrac = clamp(basinFootprintSqm / safeGrossSqm, 0, 0.2);

  // Probabilistic union so overlapping civil/env constraints never double-subtract past 92%
  const combinedLossFrac = clamp(
    1 - (1 - civilLossFrac) * (1 - envLossFrac) * (1 - osdLossFrac),
    0.04,
    0.92,
  );
  const trueNdaSqm = Math.round(safeGrossSqm * (1 - combinedLossFrac));
  const trueNdaHa = Number((trueNdaSqm / 10000).toFixed(2));
  const trueNdaPct = Math.round((trueNdaSqm / safeGrossSqm) * 100);

  // Net saleable lot area after internal roads & open space (72% subdivision, 80% townhouse infill)
  const efficiencyFactor = fin.typology === 'townhouses' ? 0.8 : 0.72;
  const saleableLandSqm = Math.round(trueNdaSqm * efficiencyFactor);
  const safeLotSize = clamp(fin.targetLotSizeSqm, 140, 10000);
  const projectedYieldLots = Math.max(1, Math.floor(saleableLandSqm / safeLotSize));

  // 3. Connected Earthworks-to-RLV Financial Feasibility (using real 2026-27 8-State Stamp Duty)
  const safeSalePrice = clamp(fin.avgEndSalePricePerLotAud, 50000, 10_000_000);
  const safeServicing = clamp(fin.servicingCostPerLotAud, 10000, 500_000);
  const safeContrib = clamp(fin.statutoryContribPerLotAud, 0, 250_000);
  const safeTargetMargin = clamp(fin.targetMarginOnCostPct, 5, 50) / 100;
  const safeMonths = clamp(fin.projectDurationMonths, 6, 84);
  const safeInterestRate = clamp(fin.financeRatePct, 1, 20) / 100;
  const safeEarthworksAud = Math.max(0, Number.isFinite(params.earthworksCostAud) ? params.earthworksCostAud : 0);

  const grossRealisationAud = Math.round(projectedYieldLots * safeSalePrice);
  const sellingAndMarketingAud = Math.round(grossRealisationAud * 0.032);
  const balUpliftTotalAud = Math.round(projectedYieldLots * balInfo.upliftPerLotAud);

  // Townhouses include indicative build construction allowance ($295k/dwelling); subdivisions are serviced land lots
  const builtFormCostAud =
    fin.typology === 'townhouses' ? projectedYieldLots * 295_000 : 0;

  const hardCivilAndBuildExLandAud = Math.round(
    safeEarthworksAud +
      estimatedOsdCostAud +
      balUpliftTotalAud +
      projectedYieldLots * (safeServicing + safeContrib) +
      builtFormCostAud,
  );
  // Consultants, design, survey, DA & contingency (9.5% of hard civil/build)
  const softAndContingencyAud = Math.round(hardCivilAndBuildExLandAud * 0.095);
  const devCostBeforeFinanceAndLandAud = hardCivilAndBuildExLandAud + softAndContingencyAud;

  // Iterative Residual Land Value (RLV) convergence solving exact 8-state statutory stamp duty & finance
  // Target: NetRealisation / (1 + targetMargin) = Land + StampDuty(Land) + DevCosts + Finance(Land, DevCosts)
  const years = safeMonths / 12;
  // Average drawn debt factor: ~65% LVR on land (full term) + 45% average S-curve draw on dev costs
  const landFinanceFactor = 0.65 * safeInterestRate * years;
  const devFinanceCostAud = Math.round(devCostBeforeFinanceAndLandAud * 0.45 * safeInterestRate * years);

  let rlv = Math.max(0, grossRealisationAud * 0.25);
  let lastDuty = calculateAustralianStampDuty({
    state,
    dutiableValueAud: rlv,
    buyerType: 'domestic',
    propertyClass: 'residential',
  });

  for (let iter = 0; iter < 12; iter += 1) {
    // ATO Division 75 Margin Scheme GST = (GRV - Land) / 11; Full GST = GRV / 11
    const gstAud = fin.gstMarginScheme
      ? Math.max(0, (grossRealisationAud - rlv) / 11)
      : grossRealisationAud / 11;
    const netRealisation = grossRealisationAud - gstAud - sellingAndMarketingAud;
    const allowableTotalCost = netRealisation / (1 + safeTargetMargin);

    lastDuty = calculateAustralianStampDuty({
      state,
      dutiableValueAud: Math.max(0, rlv),
      buyerType: 'domestic',
      propertyClass: 'residential',
    });
    const dutyRate = rlv > 0 ? lastDuty.totalDutyAud / rlv : 0.055;
    const numerator =
      allowableTotalCost - devCostBeforeFinanceAndLandAud - devFinanceCostAud;
    const denom = 1 + dutyRate + landFinanceFactor;
    const nextRlv = Math.max(0, numerator / Math.max(1.01, denom));
    if (Math.abs(nextRlv - rlv) < 250) {
      rlv = nextRlv;
      break;
    }
    rlv = nextRlv;
  }

  const residualLandValueAud = Math.round(rlv);
  lastDuty = calculateAustralianStampDuty({
    state,
    dutiableValueAud: residualLandValueAud,
    buyerType: 'domestic',
    propertyClass: 'residential',
  });
  const gstFinalAud = fin.gstMarginScheme
    ? Math.max(0, Math.round((grossRealisationAud - residualLandValueAud) / 11))
    : Math.round(grossRealisationAud / 11);
  const netRealisationExGstAndSellingAud = Math.round(
    grossRealisationAud - gstFinalAud - sellingAndMarketingAud,
  );
  const landFinanceAud = Math.round(residualLandValueAud * landFinanceFactor);
  const financeHoldingCostAud = landFinanceAud + devFinanceCostAud;
  const totalDevelopmentCostExLandAud =
    devCostBeforeFinanceAndLandAud + financeHoldingCostAud;
  const totalProjectCostAud =
    residualLandValueAud + lastDuty.totalDutyAud + totalDevelopmentCostExLandAud;

  const profitAud = netRealisationExGstAndSellingAud - totalProjectCostAud;
  const projectedMarginOnCostPct =
    totalProjectCostAud > 0
      ? Number(((profitAud / totalProjectCostAud) * 100).toFixed(1))
      : 0;

  // Indicative annualised equity IRR (assuming 35% equity contribution over project duration)
  const equityIn = Math.max(1, totalProjectCostAud * 0.35);
  const equityMultiple = Math.max(0.1, (equityIn + profitAud) / equityIn);
  const projectedAnnualIrrPct =
    residualLandValueAud > 0 && profitAud > 0
      ? Number(((Math.pow(equityMultiple, 1 / Math.max(0.5, years)) - 1) * 100).toFixed(1))
      : 0;

  const earthworksCostPerLotAud = Math.round(safeEarthworksAud / projectedYieldLots);
  const rlvPerSqmAud = Math.round(residualLandValueAud / safeGrossSqm);
  const rlvPerHaAud = Math.round(residualLandValueAud / Math.max(0.01, safeGrossSqm / 10000));
  const rlvPerLotAud = Math.round(residualLandValueAud / projectedYieldLots);

  const dealViabilityLabel: MapLabDealIntelligence['dealViabilityLabel'] =
    residualLandValueAud > 0 && projectedMarginOnCostPct >= 18 && trueNdaPct >= 65
      ? 'Strong Acquisition'
      : residualLandValueAud > 0 && projectedMarginOnCostPct >= 12
        ? 'Viable (Negotiate)'
        : 'Marginal / High Civil Risk';

  return {
    state,
    siteCap,
    trueNda: {
      grossAreaSqm: safeGrossSqm,
      grossAreaHa: Number((safeGrossSqm / 10000).toFixed(2)),
      civilConstrainedSqm: Math.round(safeGrossSqm * civilLossFrac),
      envConstrainedSqm: Math.round(safeGrossSqm * envLossFrac),
      osdFootprintSqm: basinFootprintSqm,
      trueNdaSqm,
      trueNdaHa,
      trueNdaPct,
      saleableLandSqm,
      projectedYieldLots,
    },
    osd: {
      rainfallIntensityMmHr: bench.rainfall1PctAepMmHr,
      imperviousRunoffCoeff: imperviousC,
      contributingCatchmentHa: Number(catchmentHa.toFixed(2)),
      requiredStorageM3,
      naturalDepressionCreditM3: naturalCreditM3,
      engineeredBasinVolumeM3,
      basinFootprintSqm,
      recommendedInvertAHD,
      estimatedOsdCostAud,
    },
    balRiskLevel: balInfo.riskLevel,
    balUpliftTotalAud,
    earthworksCostAud: Math.round(safeEarthworksAud),
    earthworksCostPerLotAud,
    grossRealisationAud,
    netRealisationExGstAndSellingAud,
    totalDevelopmentCostExLandAud,
    financeHoldingCostAud,
    statutoryStampDutyAud: Math.round(lastDuty.totalDutyAud),
    stampDutyEffectivePct: Number(lastDuty.effectiveRatePct.toFixed(2)),
    stampDutyAuthority: lastDuty.authority,
    residualLandValueAud,
    rlvPerSqmAud,
    rlvPerHaAud,
    rlvPerLotAud,
    projectedMarginOnCostPct,
    projectedAnnualIrrPct,
    dealViabilityLabel,
  };
}

export interface RlvOptimizationResult {
  bestStrategy: GradingStrategy;
  bestFflAHD: number;
  bestEarthworksCostAud: number;
  bestRlvAud: number;
  flatPadRlvAud: number;
  rlvUpliftAud: number;
  earthworksSavingsAud: number;
}

/**
 * Industry-First Breakthrough Solver:
 * Sweeps all 4 civil grading strategies & datum offsets to maximize Residual Land Value (RLV),
 * rather than stopping at simple zero-balance cut/fill volume.
 */
export function optimizeGradingForMaxRlv(params: {
  grid: ElevationGrid;
  boundary: FeatureCollection<Polygon>;
  state: AustralianState;
  grossAreaSqm: number;
  hydrology: HydrologyAnalysisResult;
  soilClass: SoilClass;
  rockBreakoutPct: number;
  topsoilDepthM: number;
  targetCutFillRatio: number;
  maxGradePct: number;
  terraceStepM?: number;
  ratesOverride?: CivilRateOverrides;
  env: EnvironmentalConstraintInputs;
  fin: DealFinancialInputs;
}): RlvOptimizationResult {
  const strategies: GradingStrategy[] = [
    'best-fit-plane',
    'auto-terrace',
    'max-grade',
    'flat-pad',
  ];
  const fflOffsets = [-0.6, -0.25, 0, 0.25, 0.6];

  const evalCandidate = (strategy: GradingStrategy, ffl: number) => {
    const ew = computeGridEarthworks(params.grid, params.boundary, {
      targetFflAHD: ffl,
      soilClass: params.soilClass,
      gradingStrategy: strategy,
      targetCutFillRatio: params.targetCutFillRatio,
      maxGradePct: params.maxGradePct,
      terraceStepM: params.terraceStepM ?? 1.2,
      rockBreakoutPct: params.rockBreakoutPct,
      topsoilDepthM: params.topsoilDepthM,
      customRates: params.ratesOverride,
    });
    const intel = computeMapLabDealIntelligence({
      state: params.state,
      grossAreaSqm: params.grossAreaSqm,
      hydrology: params.hydrology,
      earthworksCostAud: ew.totalPackageAud,
      minElevationAHD: params.grid.minAHD,
      env: params.env,
      fin: params.fin,
    });
    return { ew, intel };
  };

  const baselineFlat = evalCandidate('flat-pad', params.grid.meanAHD);
  let bestStrategy: GradingStrategy = 'flat-pad';
  let bestFflAHD = Number(params.grid.meanAHD.toFixed(2));
  let bestEarthworksCostAud = baselineFlat.ew.totalPackageAud;
  let bestRlvAud = baselineFlat.intel.residualLandValueAud;

  for (const strategy of strategies) {
    for (const offset of fflOffsets) {
      const ffl = Number((params.grid.meanAHD + offset).toFixed(2));
      const { ew, intel } = evalCandidate(strategy, ffl);
      if (
        intel.residualLandValueAud > bestRlvAud ||
        (intel.residualLandValueAud === bestRlvAud && ew.totalPackageAud < bestEarthworksCostAud)
      ) {
        bestStrategy = strategy;
        bestFflAHD = ffl;
        bestEarthworksCostAud = ew.totalPackageAud;
        bestRlvAud = intel.residualLandValueAud;
      }
    }
  }

  return {
    bestStrategy,
    bestFflAHD,
    bestEarthworksCostAud,
    bestRlvAud,
    flatPadRlvAud: baselineFlat.intel.residualLandValueAud,
    rlvUpliftAud: Math.max(0, bestRlvAud - baselineFlat.intel.residualLandValueAud),
    earthworksSavingsAud: Math.max(0, baselineFlat.ew.totalPackageAud - bestEarthworksCostAud),
  };
}

export interface InputValidationResult {
  valid: boolean;
  error: string;
}

export function validateEmailInput(email: string): InputValidationResult {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: 'Please enter your email address.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address (for example, name@company.com.au).' };
  }
  return { valid: true, error: '' };
}

export function validateSiteNameInput(name: string): InputValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: 'Please enter a site name before saving.' };
  if (trimmed.length > 140) {
    return { valid: false, error: 'Site name must be 140 characters or fewer.' };
  }
  if (!/[A-Za-z0-9]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Site name must include at least one letter or number (symbols only are not allowed).',
    };
  }
  return { valid: true, error: '' };
}

export function validateNonNegativeNumber(
  raw: string | number,
  label: string,
  maxValue = 100_000_000,
): InputValidationResult {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { valid: false, error: `${label} must be a valid number.` };
  }
  if (n < 0) {
    return { valid: false, error: `${label} cannot be negative.` };
  }
  if (n > maxValue) {
    return { valid: false, error: `${label} exceeds the realistic commercial limit.` };
  }
  return { valid: true, error: '' };
}
