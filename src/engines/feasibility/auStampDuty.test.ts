import { describe, expect, it } from 'vitest';
import type { AustralianState } from '../../bridge/types';
import {
  STATE_STATUTORY_META,
  calculateAustralianStampDuty,
} from './auStampDuty';

describe('calculateAustralianStampDuty — 2026–27 progressive statutory schedules across all 8 jurisdictions', () => {
  it('matches exact statutory benchmark figures at $1,000,000 across NSW, VIC, QLD, WA, SA, TAS, ACT, and NT', () => {
    const nsw = calculateAustralianStampDuty({
      state: 'NSW',
      dutiableValueAud: 1_000_000,
    });
    expect(nsw.baseDutyAud).toBe(39_412);
    expect(nsw.totalDutyAud).toBe(39_412);
    expect(nsw.marginalRatePct).toBe(4.5);

    const vic = calculateAustralianStampDuty({
      state: 'VIC',
      dutiableValueAud: 1_000_000,
    });
    expect(vic.baseDutyAud).toBe(55_000);
    expect(vic.totalDutyAud).toBe(55_000);

    const qld = calculateAustralianStampDuty({
      state: 'QLD',
      dutiableValueAud: 1_000_000,
    });
    expect(qld.baseDutyAud).toBe(38_025);
    expect(qld.totalDutyAud).toBe(38_025);

    const wa = calculateAustralianStampDuty({
      state: 'WA',
      dutiableValueAud: 1_000_000,
    });
    expect(wa.baseDutyAud).toBe(42_615);
    expect(wa.totalDutyAud).toBe(42_615);

    const sa = calculateAustralianStampDuty({
      state: 'SA',
      dutiableValueAud: 1_000_000,
    });
    expect(sa.baseDutyAud).toBe(48_830);
    expect(sa.totalDutyAud).toBe(48_830);

    const tas = calculateAustralianStampDuty({
      state: 'TAS',
      dutiableValueAud: 1_000_000,
    });
    expect(tas.baseDutyAud).toBe(40_185);
    expect(tas.totalDutyAud).toBe(40_185);

    const actRes = calculateAustralianStampDuty({
      state: 'ACT',
      dutiableValueAud: 1_000_000,
      propertyClass: 'residential',
    });
    expect(actRes.baseDutyAud).toBe(36_950);
    expect(actRes.totalDutyAud).toBe(36_950);

    const nt = calculateAustralianStampDuty({
      state: 'NT',
      dutiableValueAud: 1_000_000,
    });
    expect(nt.baseDutyAud).toBe(49_500);
    expect(nt.totalDutyAud).toBe(49_500);
  });

  it('handles NSW residential premium vs commercial > $3,721,000, ACT commercial exemption/threshold, VIC > $2M, and NT quadratic formula', () => {
    // NSW > $3,721,000 residential (7%) vs commercial (5.5%)
    const nswRes5M = calculateAustralianStampDuty({
      state: 'NSW',
      dutiableValueAud: 5_000_000,
      propertyClass: 'residential',
    });
    const nswComm5M = calculateAustralianStampDuty({
      state: 'NSW',
      dutiableValueAud: 5_000_000,
      propertyClass: 'commercial',
    });
    expect(nswRes5M.baseDutyAud).toBe(186_667 + (5_000_000 - 3_721_000) * 0.07);
    expect(nswComm5M.baseDutyAud).toBe(
      186_667 + (5_000_000 - 3_721_000) * 0.055,
    );
    expect(nswRes5M.baseDutyAud).toBeGreaterThan(nswComm5M.baseDutyAud);

    // NSW minimum $20 duty
    expect(
      calculateAustralianStampDuty({ state: 'NSW', dutiableValueAud: 500 })
        .totalDutyAud,
    ).toBe(20);

    // ACT Commercial <= $2.1M exempt ($0), > $2.1M flat 5%
    const actComm2M = calculateAustralianStampDuty({
      state: 'ACT',
      dutiableValueAud: 2_000_000,
      propertyClass: 'commercial',
    });
    expect(actComm2M.totalDutyAud).toBe(0);
    const actComm3M = calculateAustralianStampDuty({
      state: 'ACT',
      dutiableValueAud: 3_000_000,
      propertyClass: 'commercial',
    });
    expect(actComm3M.totalDutyAud).toBe(150_000);

    // ACT Residential > $1.455M flat 4.54%
    const actRes2M = calculateAustralianStampDuty({
      state: 'ACT',
      dutiableValueAud: 2_000_000,
      propertyClass: 'residential',
    });
    expect(actRes2M.totalDutyAud).toBe(90_800);

    // VIC > $2M ($110k + 6.5%)
    const vic3M = calculateAustralianStampDuty({
      state: 'VIC',
      dutiableValueAud: 3_000_000,
    });
    expect(vic3M.totalDutyAud).toBe(175_000);

    // NT quadratic formula under $525k and high brackets $4M (5.75%) / $6M (5.95%)
    const nt500k = calculateAustralianStampDuty({
      state: 'NT',
      dutiableValueAud: 500_000,
    });
    expect(nt500k.baseDutyAud).toBeCloseTo(23_928.6, 1);
    expect(
      calculateAustralianStampDuty({
        state: 'NT',
        dutiableValueAud: 4_000_000,
      }).totalDutyAud,
    ).toBe(230_000);
    expect(
      calculateAustralianStampDuty({
        state: 'NT',
        dutiableValueAud: 6_000_000,
      }).totalDutyAud,
    ).toBe(357_000);

    // QLD <= $5,000 exempt ($0) and > $1M ($38,025 + 5.75%)
    expect(
      calculateAustralianStampDuty({ state: 'QLD', dutiableValueAud: 5_000 })
        .totalDutyAud,
    ).toBe(0);
    expect(
      calculateAustralianStampDuty({
        state: 'QLD',
        dutiableValueAud: 2_000_000,
      }).totalDutyAud,
    ).toBe(95_525);

    // TAS <= $3,000 flat $50
    expect(
      calculateAustralianStampDuty({ state: 'TAS', dutiableValueAud: 2_500 })
        .totalDutyAud,
    ).toBe(50);
  });

  it('applies exact foreign residential purchaser surcharges per state and exempts commercial / ACT / NT', () => {
    const expectedForeignRates: Record<AustralianState, number> = {
      NSW: 8,
      VIC: 8,
      QLD: 8,
      WA: 7,
      SA: 7,
      TAS: 8,
      ACT: 0,
      NT: 0,
    };

    for (const state of Object.keys(expectedForeignRates) as AustralianState[]) {
      const rate = expectedForeignRates[state];
      expect(STATE_STATUTORY_META[state].foreignResidentialSurchargePct).toBe(
        rate,
      );

      const foreignRes = calculateAustralianStampDuty({
        state,
        dutiableValueAud: 1_000_000,
        buyerType: 'foreign',
        propertyClass: 'residential',
      });
      expect(foreignRes.foreignSurchargeAud).toBe((1_000_000 * rate) / 100);
      expect(foreignRes.totalDutyAud).toBe(
        foreignRes.baseDutyAud + foreignRes.foreignSurchargeAud,
      );

      const foreignComm = calculateAustralianStampDuty({
        state,
        dutiableValueAud: 1_000_000,
        buyerType: 'foreign',
        propertyClass: 'commercial',
      });
      expect(foreignComm.foreignSurchargeAud).toBe(0);
    }
  });

  it('supports custom-rate override and safely handles zero, negative, NaN, and Infinity inputs', () => {
    const custom = calculateAustralianStampDuty({
      state: 'VIC',
      dutiableValueAud: 2_000_000,
      dutyMode: 'custom-rate',
      customDutyRatePct: 4.25,
    });
    expect(custom.baseDutyAud).toBe(85_000);
    expect(custom.foreignSurchargeAud).toBe(0);
    expect(custom.totalDutyAud).toBe(85_000);

    for (const invalid of [0, -500_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = calculateAustralianStampDuty({
        state: 'NSW',
        dutiableValueAud: invalid,
      });
      expect(res.totalDutyAud).toBe(0);
      expect(res.effectiveRatePct).toBe(0);
      expect(Number.isFinite(res.totalDutyAud)).toBe(true);
    }
  });
});
