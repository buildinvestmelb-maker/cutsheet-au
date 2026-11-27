import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Polygon } from 'geojson';
import type { AustralianState } from '../../bridge/types';
import {
  ALL_8_AU_CAPITALS,
  AU_STATE_SPATIAL_REGISTRY,
  getUniversalCadastreOverlayConfig,
  isWithinAustraliaBounds,
} from '../geo/auParcelClient';
import {
  computeMapLabDealIntelligence,
  createDefaultDealFinancialInputs,
  optimizeGradingForMaxRlv,
  validateEmailInput,
  validateNonNegativeNumber,
  validateSiteAreaCap,
  validateSiteNameInput,
} from './mapLabIntelligenceEngine';
import {
  deletePrivateDeal,
  listPrivateDeals,
  loadPrivateDealById,
  savePrivateDeal,
  signInAccount,
  signOutAccount,
  signUpAccount,
} from '../../data/cloudDealStore';
import { buildSyntheticAustralianDem } from '../earthworks/demLoader';
import { analyzeTerrainHydrology } from '../earthworks/hydrologyEngine';
import cadastreHandler from '../../../api/cadastre';

const TEST_BOUNDARY: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { role: 'parcel-boundary' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [150.79, -33.926],
            [150.796, -33.926],
            [150.796, -33.922],
            [150.79, -33.922],
            [150.79, -33.926],
          ],
        ],
      },
    },
  ],
};

describe('Map Lab. DA — Universal 8-State Parity & Cadastre Registry', () => {
  const allStates: AustralianState[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

  it('registers all 8 Australian states and capitals with live Vercel cadastre overlays', () => {
    expect(ALL_8_AU_CAPITALS).toHaveLength(8);
    for (const st of allStates) {
      const profile = AU_STATE_SPATIAL_REGISTRY[st];
      expect(profile.state).toBe(st);
      expect(profile.authority.length).toBeGreaterThan(5);
      expect(isWithinAustraliaBounds(profile.capitalLat, profile.capitalLng)).toBe(true);
      const vercelCfg = getUniversalCadastreOverlayConfig(st, true);
      expect(vercelCfg.mode === 'raster' || vercelCfg.mode === 'act-vector').toBe(true);
    }
  });

  it('rejects out-of-Australia coordinates cleanly in /api/cadastre handler', async () => {
    const res = await cadastreHandler.fetch(
      new Request('https://example.vercel.app/api/cadastre?action=parcel&lat=51.5074&lng=-0.1278'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { matched: boolean; error: string };
    expect(body.matched).toBe(false);
    expect(body.error.toLowerCase()).toContain('australia');

    const badAction = await cadastreHandler.fetch(
      new Request('https://example.vercel.app/api/cadastre?action=invalid'),
    );
    expect(badAction.status).toBe(400);
  });
});

describe('Map Lab. DA — Connected Cross-App Deal Intelligence & RLV Optimizer', () => {
  const grid = buildSyntheticAustralianDem([150.789, -33.927, 150.797, -33.921], 60, 5.5, 24);
  const insideMask = new Uint8Array(grid.rows * grid.cols).fill(1);
  const hydrology = analyzeTerrainHydrology(grid, insideMask, grid.cellSizeM * grid.cellSizeM);

  it('recomputes True NDA, Auto OSD, Yield & Residual Land Value consistently across all 8 states', () => {
    const states: AustralianState[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
    const actualGrossSqm = Math.max(100_000, Math.round(hydrology.grossAreaHa * 10_000));
    for (const state of states) {
      const fin = createDefaultDealFinancialInputs(state, 'subdivision');
      const intel = computeMapLabDealIntelligence({
        state,
        grossAreaSqm: actualGrossSqm,
        hydrology,
        earthworksCostAud: 1_850_000,
        minElevationAHD: grid.minAHD,
        env: { balRating: 'BAL-12.5', floodOverlayPct: 5, riparianBiodiversityPct: 4 },
        fin,
      });
      expect(intel.siteCap.ok).toBe(true);
      expect(intel.trueNda.trueNdaSqm).toBeGreaterThan(0);
      expect(intel.trueNda.trueNdaSqm).toBeLessThan(actualGrossSqm);
      expect(intel.osd.engineeredBasinVolumeM3).toBeGreaterThanOrEqual(25);
      expect(intel.osd.estimatedOsdCostAud).toBeGreaterThan(22_000);
      expect(intel.trueNda.projectedYieldLots).toBeGreaterThanOrEqual(25);
      expect(intel.residualLandValueAud).toBeGreaterThan(0);
      expect(intel.statutoryStampDutyAud).toBeGreaterThan(0);
      expect(Number.isFinite(intel.projectedAnnualIrrPct)).toBe(true);
    }
  });

  it('reduces True NDA and RLV when severe bushfire BAL-FZ or flood overlays are toggled', () => {
    const fin = createDefaultDealFinancialInputs('QLD', 'subdivision');
    const cleanSite = computeMapLabDealIntelligence({
      state: 'QLD',
      grossAreaSqm: 100_000,
      hydrology,
      earthworksCostAud: 1_200_000,
      minElevationAHD: grid.minAHD,
      env: { balRating: 'BAL-LOW', floodOverlayPct: 0, riparianBiodiversityPct: 0 },
      fin,
    });
    const constrainedSite = computeMapLabDealIntelligence({
      state: 'QLD',
      grossAreaSqm: 100_000,
      hydrology,
      earthworksCostAud: 1_200_000,
      minElevationAHD: grid.minAHD,
      env: { balRating: 'BAL-FZ', floodOverlayPct: 20, riparianBiodiversityPct: 10 },
      fin,
    });
    expect(constrainedSite.trueNda.trueNdaSqm).toBeLessThan(cleanSite.trueNda.trueNdaSqm);
    expect(constrainedSite.trueNda.projectedYieldLots).toBeLessThan(
      cleanSite.trueNda.projectedYieldLots,
    );
    expect(constrainedSite.residualLandValueAud).toBeLessThan(cleanSite.residualLandValueAud);
  });

  it('solves Earthworks-to-RLV optimization yielding RLV >= naive Flat Pad baseline', () => {
    const fin = createDefaultDealFinancialInputs('NSW', 'subdivision');
    const opt = optimizeGradingForMaxRlv({
      grid,
      boundary: TEST_BOUNDARY,
      state: 'NSW',
      grossAreaSqm: 120_000,
      hydrology,
      soilClass: 'clay',
      rockBreakoutPct: 10,
      topsoilDepthM: 0.15,
      targetCutFillRatio: 1.1,
      maxGradePct: 5,
      terraceStepM: 1.2,
      env: { balRating: 'BAL-12.5', floodOverlayPct: 0, riparianBiodiversityPct: 0 },
      fin,
    });
    expect(opt.bestRlvAud).toBeGreaterThanOrEqual(opt.flatPadRlvAud);
    expect(opt.rlvUpliftAud).toBeGreaterThanOrEqual(0);
    expect(opt.bestEarthworksCostAud).toBeGreaterThan(0);
  });

  it('enforces 0.02 ha – 500 ha site area caps and rejects empty/negative/junk inputs', () => {
    expect(validateSiteAreaCap(100).ok).toBe(false);
    expect(validateSiteAreaCap(6_500_000).ok).toBe(false);
    expect(validateSiteAreaCap(85_000).ok).toBe(true);

    expect(validateEmailInput('not-an-email').valid).toBe(false);
    expect(validateEmailInput('dev@maplab.com.au').valid).toBe(true);

    expect(validateSiteNameInput('').valid).toBe(false);
    expect(validateSiteNameInput('!@#$%^&*()_+-=').valid).toBe(false);
    expect(validateSiteNameInput('Lot 14 Brisbane Precinct').valid).toBe(true);

    expect(validateNonNegativeNumber(-999, 'Cut rate').valid).toBe(false);
    expect(validateNonNegativeNumber(28, 'Cut rate').valid).toBe(true);
  });
});

describe('Map Lab. DA — Private Data Wall & Idempotent Save Vault', () => {
  it('enforces strict two-account isolation and single-record deduplication on rapid clicks', async () => {
    signOutAccount();
    const userA = await signUpAccount('alice@maplab-test.com.au', 'secret123');
    expect(userA.ok).toBe(true);
    if (!userA.ok) return;

    const fin = createDefaultDealFinancialInputs('WA', 'subdivision');
    const draft = {
      name: 'Perth River Precinct',
      state: 'WA' as const,
      address: '12 Riverside Dr, Perth WA',
      parcelId: 'WA SLIP #773573',
      lat: -31.9505,
      lng: 115.8605,
      grossAreaSqm: 42_000,
      earthworksCostAud: 650_000,
      rlvAud: 4_200_000,
      developabilityScore: 88,
      gradingStrategy: 'best-fit-plane' as const,
      targetFflAHD: 24.1,
      targetCutFillRatio: 1.1,
      soilClass: 'sand' as const,
      rockBreakoutPct: 5,
      topsoilDepthM: 0.15,
      ratesOverride: {},
      env: { balRating: 'BAL-LOW' as const, floodOverlayPct: 0, riparianBiodiversityPct: 0 },
      fin,
      boundary: TEST_BOUNDARY,
    };

    // Rapid triple-click within same tick must resolve to strictly 1 saved record
    const [r1, r2, r3] = await Promise.all([
      savePrivateDeal(userA.session, draft),
      savePrivateDeal(userA.session, draft),
      savePrivateDeal(userA.session, draft),
    ]);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    expect(r1.deal.id).toBe(r2.deal.id);
    expect(r2.deal.id).toBe(r3.deal.id);

    const listA = await listPrivateDeals(userA.session);
    expect(listA.ok).toBe(true);
    if (listA.ok) expect(listA.deals).toHaveLength(1);

    // Sign out -> Unauthenticated access to User A's deal ID must be blocked
    signOutAccount();
    const unauthCheck = await loadPrivateDealById(null, r1.deal.id);
    expect(unauthCheck.status).toBe('unauthenticated');

    // Sign up User B -> Direct access & delete on User A's deal ID must be strictly blocked
    const userB = await signUpAccount('bob@maplab-test.com.au', 'secret456');
    expect(userB.ok).toBe(true);
    if (!userB.ok) return;

    const listB = await listPrivateDeals(userB.session);
    expect(listB.ok && listB.deals.length === 0).toBe(true);

    const crossRead = await loadPrivateDealById(userB.session, r1.deal.id);
    expect(crossRead.status).toBe('access-denied');

    const crossDelete = await deletePrivateDeal(userB.session, r1.deal.id);
    expect(crossDelete.ok).toBe(false);

    // User A signs back in and retains clean ownership
    const reAuthA = await signInAccount('alice@maplab-test.com.au', 'secret123');
    expect(reAuthA.ok).toBe(true);
    if (reAuthA.ok) {
      const ownRead = await loadPrivateDealById(reAuthA.session, r1.deal.id);
      expect(ownRead.status).toBe('ok');
    }
  });
});
