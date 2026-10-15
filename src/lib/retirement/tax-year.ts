/**
 * Statutory figures for one tax year. A yearly update changes this file and,
 * for state rate schedules, `STATE_BRACKETS` in `tax-tables.ts`.
 * Do not inflate these across projection years. `INFLATION` is only the
 * assumption used to grow contribution limits after `TAX_YEAR`.
 *
 * Not in this file, and not part of a yearly update unless the statute
 * changed: Social Security taxability thresholds, the RMD table and starting
 * ages, and the early-withdrawal penalties.
 */

export const TAX_YEAR = 2026;

/** Contribution limits for years after TAX_YEAR grow by this rate. Not a COLA. */
export const INFLATION = 0.03;

export const STANDARD_DEDUCTION = { single: 16_100, married: 32_200 };

/** Additional standard deduction for age 65. Joint is per person, so two people are twice `marriedEach`. */
export const AGE_65_DEDUCTION = { single: 2_050, marriedEach: 1_650 };

/**
 * Extra senior deduction (OBBBA). `amount` phases out in a straight line from
 * `phaseoutStart` to `phaseoutEnd`. Married `amount` is both spouses.
 */
export const SENIOR_DEDUCTION = {
  single: { amount: 6_000, phaseoutStart: 75_000, phaseoutEnd: 175_000 },
  married: { amount: 12_000, phaseoutStart: 150_000, phaseoutEnd: 250_000 },
};

export const CONTRIBUTION_LIMITS = {
  rothIra: 7_500,
  hsaSelf: 4_400,
  hsaFamily: 8_750,
  fourOhOneK: 24_500,
};

export const CATCH_UP = {
  rothIraFrom50: 1_100,
  hsaFrom55: 1_000,
  fourOhOneKFrom50: 8_000,
  /** Ages 60 through 63, instead of the age-50 amount. */
  fourOhOneKFrom60Through63: 11_250,
};

/**
 * 2026 Medicare IRMAA. CMS, November 2025.
 * Monthly Part B and Part D surcharges per person. Tier 0 is no surcharge.
 * MAGI at or below `singleMax` / `jointMax` stays in the tier. `singleCap` /
 * `jointCap` are the conversion ceilings. Tier 5 starts at `IRMAA_TIER5`.
 */
export const IRMAA_TIER5 = { single: 500_000, joint: 750_000 };

export const IRMAA_TIERS = [
  { id: 0, label: "Standard", singleMax: 109_000, jointMax: 218_000, singleCap: 109_000, jointCap: 218_000, partB: 0, partD: 0 },
  { id: 1, label: "Tier 1", singleMax: 137_000, jointMax: 274_000, singleCap: 137_000, jointCap: 274_000, partB: 81.2, partD: 14.5 },
  { id: 2, label: "Tier 2", singleMax: 171_000, jointMax: 342_000, singleCap: 171_000, jointCap: 342_000, partB: 202.9, partD: 37.5 },
  { id: 3, label: "Tier 3", singleMax: 205_000, jointMax: 410_000, singleCap: 205_000, jointCap: 410_000, partB: 324.6, partD: 60.4 },
  { id: 4, label: "Tier 4", singleMax: IRMAA_TIER5.single - 0.01, jointMax: IRMAA_TIER5.joint - 0.01, singleCap: 499_999, jointCap: 749_999, partB: 446.3, partD: 83.3 },
  { id: 5, label: "Tier 5", singleMax: Infinity, jointMax: Infinity, singleCap: Infinity, jointCap: Infinity, partB: 487, partD: 91 },
] as const;

export type IrmaaTier = (typeof IRMAA_TIERS)[number];

/** Top of the standard (no-surcharge) tier. */
export const IRMAA_SINGLE = IRMAA_TIERS[0].singleMax;
export const IRMAA_MARRIED = IRMAA_TIERS[0].jointMax;

/** Tiers a conversion can be capped at. Tier 5 has no ceiling. */
export const IRMAA_CAP_TIERS = IRMAA_TIERS.filter((tier) => tier.id < 5);

/** 2026 Georgia. O.C.G.A. § 48-7-27. The rate is not read from `STATE_BRACKETS`. */
export const GEORGIA = {
  rate: 0.0499,
  deduction: { single: 15_000, married: 30_000 },
  /** Retirement-income exclusion per person. */
  exclusionFrom65: 65_000,
  exclusionFrom62: 35_000,
};

/** Ordinary federal income-tax brackets for TAX_YEAR. `min` is the first taxed dollar. */
export const SINGLE_BRACKETS = [
  { rate: 0.1, min: 0, max: 12400, baseTax: 0 },
  { rate: 0.12, min: 12401, max: 50400, baseTax: 1240 },
  { rate: 0.22, min: 50401, max: 105700, baseTax: 5800 },
  { rate: 0.24, min: 105701, max: 201775, baseTax: 17966 },
  { rate: 0.32, min: 201776, max: 256225, baseTax: 41024 },
  { rate: 0.35, min: 256226, max: 640600, baseTax: 58448 },
  { rate: 0.37, min: 640601, max: Infinity, baseTax: 192979.25 },
] as const;

export const MARRIED_BRACKETS = [
  { rate: 0.1, min: 0, max: 24800, baseTax: 0 },
  { rate: 0.12, min: 24801, max: 100800, baseTax: 2480 },
  { rate: 0.22, min: 100801, max: 211400, baseTax: 11600 },
  { rate: 0.24, min: 211401, max: 403550, baseTax: 35932 },
  { rate: 0.32, min: 403551, max: 512450, baseTax: 82048 },
  { rate: 0.35, min: 512451, max: 768700, baseTax: 116896 },
  { rate: 0.37, min: 768701, max: Infinity, baseTax: 206583.5 },
] as const;
