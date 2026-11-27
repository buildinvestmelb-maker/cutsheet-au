import type { AustralianState } from '../../bridge/types';

export type StampDutyBuyerType = 'domestic' | 'foreign';
export type StampDutyPropertyClass = 'residential' | 'commercial';
export type StampDutyMode = 'statutory-progressive' | 'custom-rate';

export interface StampDutyInput {
  state: AustralianState;
  dutiableValueAud: number;
  buyerType?: StampDutyBuyerType;
  propertyClass?: StampDutyPropertyClass;
  dutyMode?: StampDutyMode;
  customDutyRatePct?: number;
}

export interface StampDutyResult {
  baseDutyAud: number;
  foreignSurchargeAud: number;
  totalDutyAud: number;
  effectiveRatePct: number;
  marginalRatePct: number;
  scheduleName: string;
  authority: string;
  levyLabel: string;
  bracketLabel: string;
}

export interface StateStatutoryMeta {
  state: AustralianState;
  authority: string;
  scheduleName: string;
  levyLabel: string;
  foreignResidentialSurchargePct: number;
  foreignSurchargeName: string;
  defaultCustomRatePct: number;
}

export const STATE_STATUTORY_META: Readonly<
  Record<AustralianState, StateStatutoryMeta>
> = {
  NSW: {
    state: 'NSW',
    authority: 'Revenue NSW',
    scheduleName: 'NSW Transfer Duty (2026–27)',
    levyLabel: 'Housing & Productivity Contribution (HPC) / s7.11',
    foreignResidentialSurchargePct: 8.0,
    foreignSurchargeName: 'Surcharge Purchaser Duty (8%)',
    defaultCustomRatePct: 5.5,
  },
  VIC: {
    state: 'VIC',
    authority: 'State Revenue Office Victoria (SRO)',
    scheduleName: 'VIC Land Transfer Duty — Non-PPR (2026–27)',
    levyLabel: 'GAIC / Windfall Gains Tax / ICP',
    foreignResidentialSurchargePct: 8.0,
    foreignSurchargeName: 'Foreign Purchaser Additional Duty (8%)',
    defaultCustomRatePct: 6.5,
  },
  QLD: {
    state: 'QLD',
    authority: 'Queensland Revenue Office (QRO)',
    scheduleName: 'QLD Transfer Duty — Standard (2026–27)',
    levyLabel: 'Infrastructure Charges Notice (ICN) / EDQ',
    foreignResidentialSurchargePct: 8.0,
    foreignSurchargeName: 'Additional Foreign Acquirer Duty — AFAD (8%)',
    defaultCustomRatePct: 5.75,
  },
  WA: {
    state: 'WA',
    authority: 'RevenueWA',
    scheduleName: 'WA Transfer Duty — General Rate (2026–27)',
    levyLabel: 'Metropolitan Region Improvement Tax / DCP',
    foreignResidentialSurchargePct: 7.0,
    foreignSurchargeName: 'Foreign Buyers Duty (7%)',
    defaultCustomRatePct: 5.15,
  },
  SA: {
    state: 'SA',
    authority: 'RevenueSA',
    scheduleName: 'SA Stamp Duty on Conveyances (2026–27)',
    levyLabel: 'Open Space & Infrastructure Contribution',
    foreignResidentialSurchargePct: 7.0,
    foreignSurchargeName: 'Foreign Ownership Surcharge (7%)',
    defaultCustomRatePct: 5.5,
  },
  TAS: {
    state: 'TAS',
    authority: 'State Revenue Office Tasmania',
    scheduleName: 'TAS Property Transfer Duty (2026–27)',
    levyLabel: 'Council Headworks & Public Open Space Levy',
    foreignResidentialSurchargePct: 8.0,
    foreignSurchargeName: 'Foreign Investor Duty Surcharge (8%)',
    defaultCustomRatePct: 4.5,
  },
  ACT: {
    state: 'ACT',
    authority: 'ACT Revenue Office',
    scheduleName: 'ACT Conveyance Duty (2026–27)',
    levyLabel: 'Lease Variation Charge (LVC)',
    foreignResidentialSurchargePct: 0.0,
    foreignSurchargeName: 'No Foreign Duty Surcharge (0%)',
    defaultCustomRatePct: 5.0,
  },
  NT: {
    state: 'NT',
    authority: 'Territory Revenue Office (NT)',
    scheduleName: 'NT Stamp Duty on Conveyances (2026–27)',
    levyLabel: 'NT Infrastructure & Developer Contribution',
    foreignResidentialSurchargePct: 0.0,
    foreignSurchargeName: 'No Foreign Duty Surcharge (0%)',
    defaultCustomRatePct: 5.45,
  },
};

interface DutyComputation {
  baseDutyAud: number;
  marginalRatePct: number;
  bracketLabel: string;
}

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function computeNswDuty(
  value: number,
  propertyClass: StampDutyPropertyClass,
): DutyComputation {
  if (value <= 17_000) {
    return {
      baseDutyAud: Math.max(20, value * 0.0125),
      marginalRatePct: 1.25,
      bracketLabel: '$0 – $17,000 (1.25%, min $20)',
    };
  }
  if (value <= 37_000) {
    return {
      baseDutyAud: 212 + (value - 17_000) * 0.015,
      marginalRatePct: 1.5,
      bracketLabel: '$17,001 – $37,000 ($212 + 1.50%)',
    };
  }
  if (value <= 99_000) {
    return {
      baseDutyAud: 512 + (value - 37_000) * 0.0175,
      marginalRatePct: 1.75,
      bracketLabel: '$37,001 – $99,000 ($512 + 1.75%)',
    };
  }
  if (value <= 372_000) {
    return {
      baseDutyAud: 1_597 + (value - 99_000) * 0.035,
      marginalRatePct: 3.5,
      bracketLabel: '$99,001 – $372,000 ($1,597 + 3.50%)',
    };
  }
  if (value <= 1_240_000) {
    return {
      baseDutyAud: 11_152 + (value - 372_000) * 0.045,
      marginalRatePct: 4.5,
      bracketLabel: '$372,001 – $1,240,000 ($11,152 + 4.50%)',
    };
  }
  if (value <= 3_721_000) {
    return {
      baseDutyAud: 50_212 + (value - 1_240_000) * 0.055,
      marginalRatePct: 5.5,
      bracketLabel: '$1,240,001 – $3,721,000 ($50,212 + 5.50%)',
    };
  }
  if (propertyClass === 'residential') {
    return {
      baseDutyAud: 186_667 + (value - 3_721_000) * 0.07,
      marginalRatePct: 7.0,
      bracketLabel: 'Over $3,721,000 — Residential Premium ($186,667 + 7.00%)',
    };
  }
  return {
    baseDutyAud: 186_667 + (value - 3_721_000) * 0.055,
    marginalRatePct: 5.5,
    bracketLabel: 'Over $3,721,000 — Commercial/General ($186,667 + 5.50%)',
  };
}

function computeVicDuty(value: number): DutyComputation {
  if (value <= 25_000) {
    return {
      baseDutyAud: value * 0.014,
      marginalRatePct: 1.4,
      bracketLabel: '$0 – $25,000 (1.40%)',
    };
  }
  if (value <= 130_000) {
    return {
      baseDutyAud: 350 + (value - 25_000) * 0.024,
      marginalRatePct: 2.4,
      bracketLabel: '$25,001 – $130,000 ($350 + 2.40%)',
    };
  }
  if (value <= 960_000) {
    return {
      baseDutyAud: 2_870 + (value - 130_000) * 0.06,
      marginalRatePct: 6.0,
      bracketLabel: '$130,001 – $960,000 ($2,870 + 6.00%)',
    };
  }
  if (value <= 2_000_000) {
    return {
      baseDutyAud: value * 0.055,
      marginalRatePct: 5.5,
      bracketLabel: '$960,001 – $2,000,000 (5.50% flat)',
    };
  }
  return {
    baseDutyAud: 110_000 + (value - 2_000_000) * 0.065,
    marginalRatePct: 6.5,
    bracketLabel: 'Over $2,000,000 ($110,000 + 6.50%)',
  };
}

function computeQldDuty(value: number): DutyComputation {
  if (value <= 5_000) {
    return {
      baseDutyAud: 0,
      marginalRatePct: 0,
      bracketLabel: '$0 – $5,000 ($0)',
    };
  }
  if (value <= 75_000) {
    return {
      baseDutyAud: (value - 5_000) * 0.015,
      marginalRatePct: 1.5,
      bracketLabel: '$5,001 – $75,000 (1.50% over $5,000)',
    };
  }
  if (value <= 540_000) {
    return {
      baseDutyAud: 1_050 + (value - 75_000) * 0.035,
      marginalRatePct: 3.5,
      bracketLabel: '$75,001 – $540,000 ($1,050 + 3.50%)',
    };
  }
  if (value <= 1_000_000) {
    return {
      baseDutyAud: 17_325 + (value - 540_000) * 0.045,
      marginalRatePct: 4.5,
      bracketLabel: '$540,001 – $1,000,000 ($17,325 + 4.50%)',
    };
  }
  return {
    baseDutyAud: 38_025 + (value - 1_000_000) * 0.0575,
    marginalRatePct: 5.75,
    bracketLabel: 'Over $1,000,000 ($38,025 + 5.75%)',
  };
}

function computeWaDuty(value: number): DutyComputation {
  if (value <= 120_000) {
    return {
      baseDutyAud: value * 0.019,
      marginalRatePct: 1.9,
      bracketLabel: '$0 – $120,000 (1.90%)',
    };
  }
  if (value <= 150_000) {
    return {
      baseDutyAud: 2_280 + (value - 120_000) * 0.0285,
      marginalRatePct: 2.85,
      bracketLabel: '$120,001 – $150,000 ($2,280 + 2.85%)',
    };
  }
  if (value <= 360_000) {
    return {
      baseDutyAud: 3_135 + (value - 150_000) * 0.038,
      marginalRatePct: 3.8,
      bracketLabel: '$150,001 – $360,000 ($3,135 + 3.80%)',
    };
  }
  if (value <= 725_000) {
    return {
      baseDutyAud: 11_115 + (value - 360_000) * 0.0475,
      marginalRatePct: 4.75,
      bracketLabel: '$360,001 – $725,000 ($11,115 + 4.75%)',
    };
  }
  // Exact continuous statutory base at $725,000 is $28,452.50 ($11,115 + 4.75% * $365,000),
  // matching RevenueWA's statutory output ($42,615 at $1,000,000) without boundary discontinuity.
  return {
    baseDutyAud: 28_452.5 + (value - 725_000) * 0.0515,
    marginalRatePct: 5.15,
    bracketLabel: 'Over $725,000 ($28,453 + 5.15%)',
  };
}

function computeSaDuty(value: number): DutyComputation {
  if (value <= 12_000) {
    return {
      baseDutyAud: value * 0.01,
      marginalRatePct: 1.0,
      bracketLabel: '$0 – $12,000 (1.00%)',
    };
  }
  if (value <= 30_000) {
    return {
      baseDutyAud: 120 + (value - 12_000) * 0.02,
      marginalRatePct: 2.0,
      bracketLabel: '$12,001 – $30,000 ($120 + 2.00%)',
    };
  }
  if (value <= 50_000) {
    return {
      baseDutyAud: 480 + (value - 30_000) * 0.03,
      marginalRatePct: 3.0,
      bracketLabel: '$30,001 – $50,000 ($480 + 3.00%)',
    };
  }
  if (value <= 100_000) {
    return {
      baseDutyAud: 1_080 + (value - 50_000) * 0.035,
      marginalRatePct: 3.5,
      bracketLabel: '$50,001 – $100,000 ($1,080 + 3.50%)',
    };
  }
  if (value <= 200_000) {
    return {
      baseDutyAud: 2_830 + (value - 100_000) * 0.04,
      marginalRatePct: 4.0,
      bracketLabel: '$100,001 – $200,000 ($2,830 + 4.00%)',
    };
  }
  if (value <= 250_000) {
    return {
      baseDutyAud: 6_830 + (value - 200_000) * 0.0425,
      marginalRatePct: 4.25,
      bracketLabel: '$200,001 – $250,000 ($6,830 + 4.25%)',
    };
  }
  if (value <= 300_000) {
    return {
      baseDutyAud: 8_955 + (value - 250_000) * 0.0475,
      marginalRatePct: 4.75,
      bracketLabel: '$250,001 – $300,000 ($8,955 + 4.75%)',
    };
  }
  if (value <= 500_000) {
    return {
      baseDutyAud: 11_330 + (value - 300_000) * 0.05,
      marginalRatePct: 5.0,
      bracketLabel: '$300,001 – $500,000 ($11,330 + 5.00%)',
    };
  }
  return {
    baseDutyAud: 21_330 + (value - 500_000) * 0.055,
    marginalRatePct: 5.5,
    bracketLabel: 'Over $500,000 ($21,330 + 5.50%)',
  };
}

function computeTasDuty(value: number): DutyComputation {
  if (value <= 3_000) {
    return {
      baseDutyAud: 50,
      marginalRatePct: 0,
      bracketLabel: '$0 – $3,000 ($50 flat)',
    };
  }
  if (value <= 25_000) {
    return {
      baseDutyAud: 50 + (value - 3_000) * 0.0175,
      marginalRatePct: 1.75,
      bracketLabel: '$3,001 – $25,000 ($50 + 1.75%)',
    };
  }
  if (value <= 75_000) {
    return {
      baseDutyAud: 435 + (value - 25_000) * 0.0225,
      marginalRatePct: 2.25,
      bracketLabel: '$25,001 – $75,000 ($435 + 2.25%)',
    };
  }
  if (value <= 200_000) {
    return {
      baseDutyAud: 1_560 + (value - 75_000) * 0.035,
      marginalRatePct: 3.5,
      bracketLabel: '$75,001 – $200,000 ($1,560 + 3.50%)',
    };
  }
  if (value <= 375_000) {
    return {
      baseDutyAud: 5_935 + (value - 200_000) * 0.04,
      marginalRatePct: 4.0,
      bracketLabel: '$200,001 – $375,000 ($5,935 + 4.00%)',
    };
  }
  if (value <= 725_000) {
    return {
      baseDutyAud: 12_935 + (value - 375_000) * 0.0425,
      marginalRatePct: 4.25,
      bracketLabel: '$375,001 – $725,000 ($12,935 + 4.25%)',
    };
  }
  return {
    baseDutyAud: 27_810 + (value - 725_000) * 0.045,
    marginalRatePct: 4.5,
    bracketLabel: 'Over $725,000 ($27,810 + 4.50%)',
  };
}

function computeActDuty(
  value: number,
  propertyClass: StampDutyPropertyClass,
): DutyComputation {
  if (propertyClass === 'commercial') {
    if (value <= 2_100_000) {
      return {
        baseDutyAud: 0,
        marginalRatePct: 0,
        bracketLabel: 'Commercial <= $2,100,000 ($0 exempt)',
      };
    }
    return {
      baseDutyAud: value * 0.05,
      marginalRatePct: 5.0,
      bracketLabel: 'Commercial > $2,100,000 (5.00% flat)',
    };
  }

  if (value <= 200_000) {
    return {
      baseDutyAud: value * 0.012,
      marginalRatePct: 1.2,
      bracketLabel: '$0 – $200,000 (1.20%)',
    };
  }
  if (value <= 300_000) {
    return {
      baseDutyAud: 2_400 + (value - 200_000) * 0.022,
      marginalRatePct: 2.2,
      bracketLabel: '$200,001 – $300,000 ($2,400 + 2.20%)',
    };
  }
  if (value <= 500_000) {
    return {
      baseDutyAud: 4_600 + (value - 300_000) * 0.034,
      marginalRatePct: 3.4,
      bracketLabel: '$300,001 – $500,000 ($4,600 + 3.40%)',
    };
  }
  if (value <= 750_000) {
    return {
      baseDutyAud: 11_400 + (value - 500_000) * 0.0432,
      marginalRatePct: 4.32,
      bracketLabel: '$500,001 – $750,000 ($11,400 + 4.32%)',
    };
  }
  if (value <= 1_000_000) {
    return {
      baseDutyAud: 22_200 + (value - 750_000) * 0.059,
      marginalRatePct: 5.9,
      bracketLabel: '$750,001 – $1,000,000 ($22,200 + 5.90%)',
    };
  }
  if (value <= 1_455_000) {
    return {
      baseDutyAud: 36_950 + (value - 1_000_000) * 0.064,
      marginalRatePct: 6.4,
      bracketLabel: '$1,000,001 – $1,455,000 ($36,950 + 6.40%)',
    };
  }
  return {
    baseDutyAud: value * 0.0454,
    marginalRatePct: 4.54,
    bracketLabel: 'Over $1,455,000 (4.54% flat)',
  };
}

function computeNtDuty(value: number): DutyComputation {
  if (value < 525_000) {
    const vThousands = value / 1000;
    const baseDutyAud = 0.06571441 * vThousands * vThousands + 15 * vThousands;
    const marginalRatePct = Number(
      (((2 * 0.06571441 * vThousands + 15) / 1000) * 100).toFixed(2),
    );
    return {
      baseDutyAud,
      marginalRatePct,
      bracketLabel: 'Under $525,000 (quadratic formula: 0.06571441V² + 15V)',
    };
  }
  if (value <= 3_000_000) {
    return {
      baseDutyAud: value * 0.0495,
      marginalRatePct: 4.95,
      bracketLabel: '$525,000 – $3,000,000 (4.95% flat)',
    };
  }
  if (value <= 5_000_000) {
    return {
      baseDutyAud: value * 0.0575,
      marginalRatePct: 5.75,
      bracketLabel: '$3,000,001 – $5,000,000 (5.75% flat)',
    };
  }
  return {
    baseDutyAud: value * 0.0595,
    marginalRatePct: 5.95,
    bracketLabel: 'Over $5,000,000 (5.95% flat)',
  };
}

/**
 * Calculates Australian 2026–27 statutory progressive transfer/stamp duty (or custom flat rate)
 * across all 8 Australian states and territories, including foreign residential surcharges.
 */
export function calculateAustralianStampDuty(
  input: StampDutyInput,
): StampDutyResult {
  const meta = STATE_STATUTORY_META[input.state] ?? STATE_STATUTORY_META.NSW;
  const buyerType: StampDutyBuyerType = input.buyerType ?? 'domestic';
  const propertyClass: StampDutyPropertyClass =
    input.propertyClass ?? 'residential';
  const dutyMode: StampDutyMode = input.dutyMode ?? 'statutory-progressive';

  const rawValue = input.dutiableValueAud;
  const value =
    typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0
      ? rawValue
      : 0;

  if (value === 0) {
    return {
      baseDutyAud: 0,
      foreignSurchargeAud: 0,
      totalDutyAud: 0,
      effectiveRatePct: 0,
      marginalRatePct: 0,
      scheduleName:
        dutyMode === 'custom-rate'
          ? `${meta.state} Custom Flat Duty Override`
          : meta.scheduleName,
      authority: meta.authority,
      levyLabel: meta.levyLabel,
      bracketLabel: 'Zero dutiable value ($0)',
    };
  }

  if (dutyMode === 'custom-rate') {
    const rawRate = input.customDutyRatePct;
    const ratePct =
      typeof rawRate === 'number' && Number.isFinite(rawRate)
        ? Math.min(100, Math.max(0, rawRate))
        : meta.defaultCustomRatePct;
    const baseDutyAud = roundCents((value * ratePct) / 100);
    return {
      baseDutyAud,
      foreignSurchargeAud: 0,
      totalDutyAud: baseDutyAud,
      effectiveRatePct: Number(ratePct.toFixed(3)),
      marginalRatePct: Number(ratePct.toFixed(3)),
      scheduleName: `${meta.state} Custom Flat Duty Override`,
      authority: meta.authority,
      levyLabel: meta.levyLabel,
      bracketLabel: `Custom flat rate (${ratePct.toFixed(2)}%)`,
    };
  }

  let computed: DutyComputation;
  switch (input.state) {
    case 'NSW':
      computed = computeNswDuty(value, propertyClass);
      break;
    case 'VIC':
      computed = computeVicDuty(value);
      break;
    case 'QLD':
      computed = computeQldDuty(value);
      break;
    case 'WA':
      computed = computeWaDuty(value);
      break;
    case 'SA':
      computed = computeSaDuty(value);
      break;
    case 'TAS':
      computed = computeTasDuty(value);
      break;
    case 'ACT':
      computed = computeActDuty(value, propertyClass);
      break;
    case 'NT':
      computed = computeNtDuty(value);
      break;
  }

  const baseDutyAud = roundCents(computed.baseDutyAud);
  const foreignRatePct =
    buyerType === 'foreign' && propertyClass === 'residential'
      ? meta.foreignResidentialSurchargePct
      : 0;
  const foreignSurchargeAud = roundCents((value * foreignRatePct) / 100);
  const totalDutyAud = roundCents(baseDutyAud + foreignSurchargeAud);
  const effectiveRatePct = Number(((totalDutyAud / value) * 100).toFixed(3));
  const marginalRatePct = Number(
    (computed.marginalRatePct + foreignRatePct).toFixed(3),
  );

  return {
    baseDutyAud,
    foreignSurchargeAud,
    totalDutyAud,
    effectiveRatePct,
    marginalRatePct,
    scheduleName: meta.scheduleName,
    authority: meta.authority,
    levyLabel: meta.levyLabel,
    bracketLabel:
      foreignRatePct > 0
        ? `${computed.bracketLabel} + ${meta.foreignSurchargeName}`
        : computed.bracketLabel,
  };
}
