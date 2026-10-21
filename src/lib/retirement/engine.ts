import {
  AGE_65_DEDUCTION,
  CATCH_UP,
  CONTRIBUTION_LIMITS,
  GEORGIA,
  INFLATION,
  IRMAA_CAP_TIERS,
  IRMAA_MARRIED,
  IRMAA_SINGLE,
  IRMAA_TIER5,
  IRMAA_TIERS,
  MARRIED_BRACKETS,
  SENIOR_DEDUCTION,
  SINGLE_BRACKETS,
  STANDARD_DEDUCTION,
  TAX_YEAR,
  type IrmaaTier,
} from "./tax-year";
import { RMD_FACTORS, STATE_BRACKETS, STATE_NAMES } from "./tax-tables";

export {
  INFLATION,
  IRMAA_CAP_TIERS,
  IRMAA_MARRIED,
  IRMAA_SINGLE,
  IRMAA_TIERS,
};
export const CURRENT_YEAR = TAX_YEAR;
export type { IrmaaTier } from "./tax-year";

export const ACCOUNT_TYPES = ["rothIra", "hsa", "fourOhOneK", "taxable"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type FilingStatus = "single" | "married";

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  rothIra: "Roth IRA",
  hsa: "HSA",
  fourOhOneK: "401(k)",
  taxable: "Taxable Brokerage",
};

export type AccountSettings = {
  enabled: boolean;
  rateOfReturn: number;
  stopContributionAge: number;
  startWithdrawalAge: number;
  annualWithdrawal: number;
  withdrawalIsPercentage: boolean;
  annualContribution: number;
  currentBalance: number;
  employerMatch: number;
  preRmdConversion: boolean;
  preRmdConversionBracketRate: number;
  rmdConversion: boolean;
  rmdConversionBracketRate: number;
  payConversionTaxFromTaxable: boolean;
  /** 2026 IRMAA tier id to cap Roth conversions at, or null for no MAGI cap. */
  irmaaBracket: number | null;
};

export type PlannerInputs = {
  birthYear: number;
  retirementYear: number;
  filingStatus: FilingStatus;
  marriageYear: number | null;
  spouseBirthYear: number | null;
  longevityAge: number;
  spouseLongevityAge: number;
  adjustedGrossIncome: number;
  socialSecurityIncome: number;
  socialSecurityStartAge: number;
  state: string;
  /** Search for the Roth conversions that maximize money left at the end. */
  optimizeDistributions: boolean;
  /** Primary age the maximized plan stops at. Ignored unless maximize is on. */
  optimizeThroughAge: number;
  /**
   * Share of the cash-out cost that maximization subtracts.
   * 0 counts a remaining 401(k) or HSA dollar in full. 1 subtracts the tax,
   * penalty, and extra IRMAA to cash it out. Roth and taxable money are full either way.
   */
  optimizeSpendableWeight: number;
  accounts: Record<AccountType, AccountSettings>;
  spouseAccounts: Record<AccountType, AccountSettings>;
};

export type AccountYear = {
  year: number;
  age: number;
  startBalance: number;
  contributionLimit: number;
  contribution: number;
  withdrawal: number;
  growth: number;
  endBalance: number;
};

export type TaxSummary = {
  agi: number;
  ssIncome: number;
  taxableSS: number;
  rmdAmount: number;
  conversionAmount: number;
  grossIncome: number;
  standardDeduction: number;
  additionalDeduction: number;
  elderlyAgiDeduction: number;
  totalDeductions: number;
  taxableIncome: number;
  federalTax: number;
  stateTax: number;
  totalTax: number;
  /** Other income + full Social Security + RMD + Roth conversions. */
  annualGross: number;
  /** Annual gross minus federal and state income tax. */
  annualNet: number;
  /** IRMAA MAGI: other income + taxable Social Security + RMD + Roth conversions. */
  irmaaMagi: number;
  irmaa: IrmaaFee;
};

/** Medicare surcharge assessed this year from MAGI two years earlier. */
export type IrmaaFee = {
  lookbackYear: number;
  lookbackMagi: number | null;
  lookbackFiling: FilingStatus | null;
  enrollees: number;
  tierId: number | null;
  tierLabel: string | null;
  partBMonthly: number;
  partDMonthly: number;
  /** null when someone is on Medicare but the lookback year is outside the projection. */
  annualFee: number | null;
};

export type ProjectionRow = {
  year: number;
  age: number;
  spouseAge: number | null;
  filingStatus: FilingStatus;
  accounts: Record<AccountType, AccountYear>;
  totalBalance: number;
  /** Face value minus the tax to cash out 401(k) and HSA balances this year. */
  liquidBalance: number;
  spendable: SpendableBreakdown;
  taxSummary: TaxSummary;
};

type Bracket = { rate: number; min: number; max: number; baseTax: number };
type Balances = Record<AccountType, number>;

export function catchUp(type: AccountType, age: number): number {
  if (type === "rothIra" && age >= 50) return CATCH_UP.rothIraFrom50;
  if (type === "hsa" && age >= 55) return CATCH_UP.hsaFrom55;
  if (type === "fourOhOneK") {
    if (age >= 60 && age <= 63) return CATCH_UP.fourOhOneKFrom60Through63;
    if (age >= 50) return CATCH_UP.fourOhOneKFrom50;
  }
  return 0;
}

function blankAccount(partial: Partial<AccountSettings> & Pick<AccountSettings, "annualContribution" | "stopContributionAge" | "startWithdrawalAge" | "enabled"> & { withdrawalIsPercentage?: boolean }): AccountSettings {
  return {
    enabled: partial.enabled,
    rateOfReturn: 8,
    stopContributionAge: partial.stopContributionAge,
    startWithdrawalAge: partial.startWithdrawalAge,
    annualWithdrawal: 0,
    withdrawalIsPercentage: partial.withdrawalIsPercentage ?? false,
    annualContribution: partial.annualContribution,
    currentBalance: 0,
    employerMatch: 0,
    preRmdConversion: false,
    preRmdConversionBracketRate: 12,
    rmdConversion: false,
    rmdConversionBracketRate: 12,
    payConversionTaxFromTaxable: false,
    irmaaBracket: null,
  };
}

export function createAccounts(who: "primary" | "spouse", birthYear: number): Record<AccountType, AccountSettings> {
  const age = CURRENT_YEAR - birthYear;
  return {
    rothIra: blankAccount({
      enabled: true,
      stopContributionAge: 60,
      startWithdrawalAge: 60,
      annualContribution: CONTRIBUTION_LIMITS.rothIra + catchUp("rothIra", age),
    }),
    hsa: blankAccount({
      enabled: true,
      stopContributionAge: 65,
      startWithdrawalAge: 65,
      annualContribution: CONTRIBUTION_LIMITS.hsaFamily / 2 + catchUp("hsa", age),
    }),
    fourOhOneK: blankAccount({
      enabled: who === "primary",
      stopContributionAge: 60,
      startWithdrawalAge: 60,
      annualContribution: CONTRIBUTION_LIMITS.fourOhOneK + catchUp("fourOhOneK", age),
    }),
    taxable: blankAccount({
      enabled: true,
      stopContributionAge: 60,
      startWithdrawalAge: 60,
      annualContribution: 24000,
      withdrawalIsPercentage: true,
    }),
  };
}

export function defaultInputs(): PlannerInputs {
  return {
    birthYear: 1955,
    retirementYear: TAX_YEAR,
    filingStatus: "married",
    marriageYear: TAX_YEAR,
    spouseBirthYear: 1960,
    longevityAge: 100,
    spouseLongevityAge: 100,
    adjustedGrossIncome: 0,
    socialSecurityIncome: 0,
    socialSecurityStartAge: 67,
    state: "GA",
    optimizeDistributions: false,
    optimizeThroughAge: 90,
    optimizeSpendableWeight: 1,
    accounts: createAccounts("primary", 1955),
    spouseAccounts: createAccounts("spouse", 1960),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAccountSettings(value: unknown): value is AccountSettings {
  if (!value || typeof value !== "object") return false;
  const account = value as Record<string, unknown>;
  const bracket = account.irmaaBracket;
  const bracketOk = bracket === null || (isFiniteNumber(bracket) && Number.isInteger(bracket) && bracket >= 0 && bracket <= 5);
  return (
    typeof account.enabled === "boolean" &&
    isFiniteNumber(account.rateOfReturn) &&
    isFiniteNumber(account.stopContributionAge) &&
    isFiniteNumber(account.startWithdrawalAge) &&
    isFiniteNumber(account.annualWithdrawal) &&
    typeof account.withdrawalIsPercentage === "boolean" &&
    isFiniteNumber(account.annualContribution) &&
    isFiniteNumber(account.currentBalance) &&
    isFiniteNumber(account.employerMatch) &&
    typeof account.preRmdConversion === "boolean" &&
    isFiniteNumber(account.preRmdConversionBracketRate) &&
    typeof account.rmdConversion === "boolean" &&
    isFiniteNumber(account.rmdConversionBracketRate) &&
    typeof account.payConversionTaxFromTaxable === "boolean" &&
    bracketOk
  );
}

function isAccountMap(value: unknown): value is Record<AccountType, AccountSettings> {
  if (!value || typeof value !== "object") return false;
  const map = value as Record<string, unknown>;
  return ACCOUNT_TYPES.every((type) => isAccountSettings(map[type]));
}

/** Minified JSON of the planner inputs. */
export function serializePlannerInputs(inputs: PlannerInputs): string {
  return JSON.stringify(inputs);
}

/** Parse minified (or pretty) planner JSON. Throws if it is not a plan. */
export function parsePlannerInputs(text: string): PlannerInputs {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (!raw || typeof raw !== "object") throw new Error("This is not a retirement plan.");
  const plan = raw as Record<string, unknown>;
  const filing = plan.filingStatus;
  const marriageYear = plan.marriageYear;
  const spouseBirthYear = plan.spouseBirthYear;
  const state = plan.state;
  if (
    !isFiniteNumber(plan.birthYear) ||
    !isFiniteNumber(plan.retirementYear) ||
    (filing !== "single" && filing !== "married") ||
    !(marriageYear === null || isFiniteNumber(marriageYear)) ||
    !(spouseBirthYear === null || isFiniteNumber(spouseBirthYear)) ||
    !isFiniteNumber(plan.longevityAge) ||
    !isFiniteNumber(plan.spouseLongevityAge) ||
    !isFiniteNumber(plan.adjustedGrossIncome) ||
    !isFiniteNumber(plan.socialSecurityIncome) ||
    !isFiniteNumber(plan.socialSecurityStartAge) ||
    typeof state !== "string" ||
    !(state in STATE_NAMES) ||
    (plan.optimizeDistributions !== undefined && typeof plan.optimizeDistributions !== "boolean") ||
    (plan.optimizeThroughAge !== undefined && !isFiniteNumber(plan.optimizeThroughAge)) ||
    (plan.optimizeSpendableWeight !== undefined && !isFiniteNumber(plan.optimizeSpendableWeight)) ||
    !isAccountMap(plan.accounts) ||
    !isAccountMap(plan.spouseAccounts)
  ) {
    throw new Error("This is not a retirement plan.");
  }
  return {
    birthYear: plan.birthYear,
    retirementYear: plan.retirementYear,
    filingStatus: filing,
    marriageYear,
    spouseBirthYear,
    longevityAge: plan.longevityAge,
    spouseLongevityAge: plan.spouseLongevityAge,
    adjustedGrossIncome: plan.adjustedGrossIncome,
    socialSecurityIncome: plan.socialSecurityIncome,
    socialSecurityStartAge: plan.socialSecurityStartAge,
    state,
    optimizeDistributions: plan.optimizeDistributions === true,
    optimizeThroughAge: isFiniteNumber(plan.optimizeThroughAge) ? plan.optimizeThroughAge : plan.longevityAge,
    optimizeSpendableWeight: isFiniteNumber(plan.optimizeSpendableWeight) ? Math.min(1, Math.max(0, plan.optimizeSpendableWeight)) : 1,
    accounts: plan.accounts,
    spouseAccounts: plan.spouseAccounts,
  };
}

/** IRS limit shown beside the contribution field (2026, catch-up at today's age). */
export function displayedLimit(type: AccountType, birthYear: number, filing: FilingStatus): number | null {
  if (type === "taxable") return null;
  const age = CURRENT_YEAR - birthYear;
  const base =
    type === "hsa" && filing === "married" ? CONTRIBUTION_LIMITS.hsaFamily / 2 : statutoryLimit(type);
  return base + catchUp(type, age);
}

function bracketsFor(filing: FilingStatus): readonly Bracket[] {
  return filing === "married" ? MARRIED_BRACKETS : SINGLE_BRACKETS;
}

function additionalStdDeduction(filing: FilingStatus, age: number, spouseAge: number | null): number {
  if (filing === "married" && spouseAge !== null) {
    const count = (age >= 65 ? 1 : 0) + (spouseAge >= 65 ? 1 : 0);
    return count * AGE_65_DEDUCTION.marriedEach;
  }
  return age >= 65 ? AGE_65_DEDUCTION.single : 0;
}

function seniorRow(both: boolean) {
  return both ? SENIOR_DEDUCTION.married : SENIOR_DEDUCTION.single;
}

function seniorBonus(filing: FilingStatus, age: number, spouseAge: number | null, phaseoutIncome: number): number {
  const both = filing === "married" && spouseAge !== null && age >= 65 && spouseAge >= 65;
  const any = age >= 65 || (spouseAge !== null && spouseAge >= 65);
  if (!any) return 0;
  const row = seniorRow(both);
  if (phaseoutIncome < row.phaseoutStart) return row.amount;
  if (phaseoutIncome >= row.phaseoutEnd) return 0;
  const slope = row.amount / (row.phaseoutEnd - row.phaseoutStart);
  return Math.max(0, row.amount - (phaseoutIncome - row.phaseoutStart) * slope);
}

function totalDeduction(filing: FilingStatus, age: number, spouseAge: number | null, phaseoutIncome: number): number {
  const base = filing === "married" ? STANDARD_DEDUCTION.married : STANDARD_DEDUCTION.single;
  return base + additionalStdDeduction(filing, age, spouseAge) + seniorBonus(filing, age, spouseAge, phaseoutIncome);
}

export function federalTax(gross: number, filing: FilingStatus, age: number, spouseAge: number | null, phaseoutIncome: number): number {
  const deduction = totalDeduction(filing, age, spouseAge, phaseoutIncome);
  const taxable = Math.max(0, gross - deduction);
  if (taxable === 0) return 0;
  const table = bracketsFor(filing);
  for (const b of table) {
    if (taxable <= b.max) return b.baseTax + (taxable - b.min + 1) * b.rate;
  }
  const last = table[table.length - 1];
  return last.baseTax + (taxable - last.min + 1) * last.rate;
}

/** Income taxed at one ordinary rate, and the federal tax that rate charges. */
export type FederalBracketSlice = { rate: number; income: number; tax: number };

/** Federal tax split by ordinary bracket. The slices add up to `federalTax` for the same inputs. */
export function federalBracketSlices(
  gross: number,
  filing: FilingStatus,
  age: number,
  spouseAge: number | null,
  phaseoutIncome: number,
): FederalBracketSlice[] {
  const deduction = totalDeduction(filing, age, spouseAge, phaseoutIncome);
  const taxable = Math.max(0, gross - deduction);
  if (taxable <= 0) return [];
  const table = bracketsFor(filing);
  const slices: FederalBracketSlice[] = [];
  for (let i = 0; i < table.length; i++) {
    const bracket = table[i];
    if (taxable < bracket.min) break;
    if (taxable <= bracket.max || i + 1 >= table.length) {
      const income = taxable - bracket.min + 1;
      slices.push({ rate: bracket.rate, income, tax: income * bracket.rate });
      break;
    }
    const tax = table[i + 1].baseTax - bracket.baseTax;
    slices.push({ rate: bracket.rate, income: bracket.rate > 0 ? tax / bracket.rate : 0, tax });
  }
  return slices;
}

/** Gross income that fills the chosen ordinary bracket, including the deduction. */
function bracketCeiling(ratePercent: number, filing: FilingStatus, age: number, spouseAge: number | null, phaseoutIncome: number): number {
  const deduction = totalDeduction(filing, age, spouseAge, phaseoutIncome);
  for (const b of bracketsFor(filing)) {
    if (Math.abs(b.rate - ratePercent / 100) < 0.001) return b.max + deduction;
  }
  return deduction;
}

/** 2026 Georgia retirement-income exclusion, per person (O.C.G.A. § 48-7-27). */
function georgiaRetirementCap(age: number): number {
  if (age >= 65) return GEORGIA.exclusionFrom65;
  if (age >= 62) return GEORGIA.exclusionFrom62;
  return 0;
}

function georgiaDeduction(filing: FilingStatus): number {
  return filing === "married" ? GEORGIA.deduction.married : GEORGIA.deduction.single;
}

/**
 * Georgia taxable income.
 * Social Security is exempt. Each spouse's retirement exclusion covers only that
 * spouse's own 401(k) distributions; the other-income input is treated as the
 * primary's unearned retirement income (pension, interest, dividends). The 2026
 * standard deduction is $15,000 single / $30,000 joint (HB 463).
 */
function georgiaTaxable(
  income: number,
  filing: FilingStatus,
  age: number,
  spouseAge: number | null,
  taxableSS: number,
  retirement: { primary: number; spouse: number; other: number },
): number {
  const withoutSS = Math.max(0, income - taxableSS);
  const primaryExcluded = Math.min(georgiaRetirementCap(age), Math.max(0, retirement.primary) + Math.max(0, retirement.other));
  const spouseExcluded =
    filing === "married" && spouseAge !== null ? Math.min(georgiaRetirementCap(spouseAge), Math.max(0, retirement.spouse)) : 0;
  const deduction = georgiaDeduction(filing);
  return Math.max(0, withoutSS - primaryExcluded - spouseExcluded - deduction);
}

export function stateTax(
  income: number,
  state: string,
  filing: FilingStatus,
  age: number,
  spouseAge: number | null,
  taxableSS: number,
  retirement: { primary: number; spouse: number; other: number } = {
    primary: 0,
    spouse: 0,
    other: Math.max(0, income - taxableSS),
  },
): number {
  const schedule = STATE_BRACKETS[state];
  if (!schedule || schedule.single.length === 0) return 0;
  if (state === "GA") return georgiaTaxable(income, filing, age, spouseAge, taxableSS, retirement) * GEORGIA.rate;
  if (state === "OH") {
    const floor = 26_050;
    if (income <= floor) return 0;
    return 332 + 0.0275 * (income - floor);
  }
  const table = filing === "married" ? schedule.married : schedule.single;
  let tax = 0;
  for (let i = 0; i < table.length; i++) {
    const floor = table[i].min;
    const ceiling = i + 1 < table.length ? table[i + 1].min : Infinity;
    const slice = Math.min(income, ceiling) - floor;
    if (slice > 0) tax += slice * table[i].rate;
    if (income <= ceiling) break;
  }
  return tax;
}

/** Pieces of the spendable total for one year. */
export type SpendableBreakdown = {
  roth: number;
  taxable: number;
  fourOhOneKPrimary: number;
  fourOhOneKSpouse: number;
  hsaPrimary: number;
  hsaSpouse: number;
  face: number;
  federalBefore: number;
  stateBefore: number;
  federalAfter: number;
  stateAfter: number;
  /** Federal tax on this year's income, split by ordinary bracket. */
  federalBracketsBefore: FederalBracketSlice[];
  /** Federal tax if the remaining 401(k) and HSA were cashed out, split by ordinary bracket. */
  federalBracketsAfter: FederalBracketSlice[];
  /** Extra federal and state tax from cashing out the remaining 401(k) and HSA. Never negative. */
  extraTax: number;
  penalty401Primary: number;
  penalty401Spouse: number;
  penaltyHsaPrimary: number;
  penaltyHsaSpouse: number;
  /** Extra IRMAA two years later caused by cashing out the remaining 401(k) and HSA. */
  irmaaFromCashout: number;
  /** Year that extra surcharge would be paid. Null when nobody in the projection would be on Medicare then. */
  irmaaCashoutYear: number | null;
  /** This year's IRMAA surcharge. Null when the lookback year is outside the projection. */
  irmaaThisYear: number | null;
  irmaaFeeBefore: number;
  irmaaFeeAfter: number;
  spendable: number;
};

/**
 * What the household could spend if every account were cashed out this year.
 * Roth and taxable balances count in full. A 401(k) or HSA withdrawal is stacked
 * on income already counted, and only the extra federal and state tax is removed.
 * Cashing out a 401(k) before 60 adds the 10% penalty. An HSA spent on anything
 * other than medical care adds the 20% penalty before 65. This year's IRMAA
 * surcharge is removed when it is known. The higher IRMAA that the cash-out
 * would cause two years later is removed as well.
 */
export function spendableTotal(args: {
  face: number;
  roth: number;
  taxable: number;
  pretax401: { primary: number; spouse: number };
  hsa: { primary: number; spouse: number };
  ordinary: number;
  retirement: { primary: number; spouse: number };
  age: number;
  spouseAge: number | null;
  spouseActive: boolean;
  filing: FilingStatus;
  state: string;
  ssIncome: number;
  agi: number;
  irmaaThisYear: number | null;
  futureEnrollees: number;
  futureYear: number | null;
}): SpendableBreakdown {
  const fourOhOneKPrimary = Math.max(0, args.pretax401.primary);
  const fourOhOneKSpouse = args.spouseActive ? Math.max(0, args.pretax401.spouse) : 0;
  const hsaPrimary = Math.max(0, args.hsa.primary);
  const hsaSpouse = args.spouseActive ? Math.max(0, args.hsa.spouse) : 0;
  const extra = fourOhOneKPrimary + fourOhOneKSpouse + hsaPrimary + hsaSpouse;
  const bill = (ordinary: number, retirement: { primary: number; spouse: number }) => {
    const taxableSS = taxableSocialSecurity(args.ssIncome, args.agi + ordinary, args.filing);
    const gross = args.agi + taxableSS + ordinary;
    const phaseout = args.agi + ordinary;
    return {
      federal: federalTax(gross, args.filing, args.age, args.spouseAge, phaseout),
      state: stateTax(gross, args.state, args.filing, args.age, args.spouseAge, taxableSS, {
        primary: retirement.primary,
        spouse: retirement.spouse,
        other: args.agi,
      }),
      brackets: federalBracketSlices(gross, args.filing, args.age, args.spouseAge, phaseout),
    };
  };
  const before = bill(args.ordinary, args.retirement);
  const after =
    extra > 0
      ? bill(args.ordinary + extra, {
          primary: args.retirement.primary + fourOhOneKPrimary,
          spouse: args.retirement.spouse + fourOhOneKSpouse,
        })
      : before;
  const extraTax = Math.max(0, after.federal + after.state - (before.federal + before.state));
  const penalty401Primary = args.age < 60 ? fourOhOneKPrimary * 0.1 : 0;
  const penalty401Spouse = args.spouseActive && args.spouseAge !== null && args.spouseAge < 60 ? fourOhOneKSpouse * 0.1 : 0;
  const penaltyHsaPrimary = args.age < 65 ? hsaPrimary * 0.2 : 0;
  const penaltyHsaSpouse = args.spouseActive && args.spouseAge !== null && args.spouseAge < 65 ? hsaSpouse * 0.2 : 0;
  const penalties = penalty401Primary + penalty401Spouse + penaltyHsaPrimary + penaltyHsaSpouse;
  const magiFor = (ordinary: number) => {
    const taxableSS = taxableSocialSecurity(args.ssIncome, args.agi + ordinary, args.filing);
    return args.agi + taxableSS + ordinary;
  };
  const surcharge = (magi: number) => {
    if (args.futureEnrollees <= 0) return 0;
    const tier = irmaaTierFor(magi, args.filing);
    return (tier.partB + tier.partD) * 12 * args.futureEnrollees;
  };
  const irmaaFeeBefore = surcharge(magiFor(args.ordinary));
  const irmaaFeeAfter = surcharge(magiFor(args.ordinary + extra));
  const irmaaFromCashout = Math.max(0, irmaaFeeAfter - irmaaFeeBefore);
  const irmaaDue = args.irmaaThisYear ?? 0;
  return {
    roth: args.roth,
    taxable: args.taxable,
    fourOhOneKPrimary,
    fourOhOneKSpouse,
    hsaPrimary,
    hsaSpouse,
    face: args.face,
    federalBefore: before.federal,
    stateBefore: before.state,
    federalAfter: after.federal,
    stateAfter: after.state,
    federalBracketsBefore: before.brackets,
    federalBracketsAfter: after.brackets,
    extraTax,
    penalty401Primary,
    penalty401Spouse,
    penaltyHsaPrimary,
    penaltyHsaSpouse,
    irmaaFromCashout,
    irmaaCashoutYear: args.futureEnrollees > 0 ? args.futureYear : null,
    irmaaThisYear: args.irmaaThisYear,
    irmaaFeeBefore,
    irmaaFeeAfter,
    spendable: Math.max(0, args.face - extraTax - penalties - irmaaDue - irmaaFromCashout),
  };
}

/** 0 counts pretax balances at face value. 1 subtracts the full cost to cash them out. */
export function spendableWeight(inputs: PlannerInputs): number {
  const weight = inputs.optimizeSpendableWeight;
  if (!Number.isFinite(weight)) return 1;
  return Math.min(1, Math.max(0, weight));
}

/**
 * Money the maximization is aiming at.
 * Taxes and IRMAA already paid are always subtracted. The extra tax, penalty,
 * and IRMAA from cashing out what is still in a 401(k) or HSA count only in part.
 */
export function targetObjective(spendable: SpendableBreakdown, kept: number, spent: number, weight: number): number {
  const penalties = spendable.penalty401Primary + spendable.penalty401Spouse + spendable.penaltyHsaPrimary + spendable.penaltyHsaSpouse;
  const haircut = spendable.extraTax + penalties + spendable.irmaaFromCashout;
  return spendable.face - weight * haircut + kept - spent;
}

/** Taxable portion of Social Security benefits. */
export function taxableSocialSecurity(benefit: number, otherIncome: number, filing: FilingStatus): number {
  if (benefit <= 0) return 0;
  const provisional = otherIncome + benefit / 2;
  const first = filing === "married" ? 32000 : 25000;
  const second = filing === "married" ? 44000 : 34000;
  const cap = filing === "married" ? 6000 : 4500;
  if (provisional <= first) return 0;
  const lower = Math.min(0.5 * benefit, 0.5 * (provisional - first));
  if (provisional <= second) return lower;
  return Math.min(0.85 * benefit, 0.85 * (provisional - second) + Math.min(lower, cap));
}

function rmdStartAge(birthYear: number): number {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  if (birthYear >= 1949) return 72;
  return 70;
}

function rmdFactor(age: number): number {
  const key = Math.min(age, 120);
  return RMD_FACTORS[key] ?? RMD_FACTORS[120];
}

export function irmaaTierFor(magi: number, filing: FilingStatus): IrmaaTier {
  const top = filing === "married" ? IRMAA_TIER5.joint : IRMAA_TIER5.single;
  if (magi >= top) return IRMAA_TIERS[5];
  for (const tier of IRMAA_TIERS) {
    if (tier.id === 5) break;
    const max = filing === "married" ? tier.jointMax : tier.singleMax;
    if (magi <= max) return tier;
  }
  return IRMAA_TIERS[4];
}

/** MAGI ceiling for Roth conversions. null and the top tier mean no cap. */
export function irmaaCapAmount(bracket: number | null, filing: FilingStatus): number {
  if (bracket === null) return Infinity;
  const tier = IRMAA_TIERS.find((item) => item.id === bracket);
  if (!tier) return Infinity;
  return filing === "married" ? tier.jointCap : tier.singleCap;
}

function medicareEnrollees(age: number, spouseAge: number | null, filing: FilingStatus): number {
  const primary = age >= 65 ? 1 : 0;
  const spouse = filing === "married" && spouseAge !== null && spouseAge >= 65 ? 1 : 0;
  return primary + spouse;
}

/** People who would pay IRMAA two years after `age` if the household is still in the projection. */
export function irmaaCashoutEnrollees(inputs: PlannerInputs, age: number, spouseAge: number | null): { year: number; enrollees: number } {
  const year = inputs.birthYear + age + 2;
  if (age + 2 > longevityEndAge(inputs)) return { year, enrollees: 0 };
  const futureSpouse = spouseAge === null ? null : spouseAge + 2;
  const married = inputs.filingStatus === "married" && inputs.marriageYear !== null && year >= inputs.marriageYear && futureSpouse !== null;
  return { year, enrollees: medicareEnrollees(age + 2, futureSpouse, married ? "married" : "single") };
}

function assessIrmaa(year: number, age: number, spouseAge: number | null, filing: FilingStatus, prior: ProjectionRow | undefined): IrmaaFee {
  const lookbackYear = year - 2;
  const enrollees = medicareEnrollees(age, spouseAge, filing);
  if (!prior) {
    return {
      lookbackYear,
      lookbackMagi: null,
      lookbackFiling: null,
      enrollees,
      tierId: null,
      tierLabel: null,
      partBMonthly: 0,
      partDMonthly: 0,
      annualFee: enrollees === 0 ? 0 : null,
    };
  }
  const tier = irmaaTierFor(prior.taxSummary.irmaaMagi, prior.filingStatus);
  const monthly = tier.partB + tier.partD;
  return {
    lookbackYear,
    lookbackMagi: prior.taxSummary.irmaaMagi,
    lookbackFiling: prior.filingStatus,
    enrollees,
    tierId: enrollees === 0 ? null : tier.id,
    tierLabel: enrollees === 0 ? null : tier.label,
    partBMonthly: enrollees === 0 ? 0 : tier.partB,
    partDMonthly: enrollees === 0 ? 0 : tier.partD,
    annualFee: monthly * 12 * enrollees,
  };
}

function statutoryLimit(type: AccountType): number {
  if (type === "rothIra") return CONTRIBUTION_LIMITS.rothIra;
  if (type === "hsa") return CONTRIBUTION_LIMITS.hsaSelf;
  if (type === "fourOhOneK") return CONTRIBUTION_LIMITS.fourOhOneK;
  return Infinity;
}

function contributionLimit(type: AccountType, year: number, age: number): number {
  if (type === "taxable") return Infinity;
  const inflated = statutoryLimit(type) * Math.pow(1 + INFLATION, year - CURRENT_YEAR);
  return inflated + catchUp(type, age);
}

type YearSlice = {
  accounts: Record<AccountType, AccountYear>;
  rmdAmount: number;
  conversionAmount: number;
  cashKept: number;
  convertible: number;
  netRmdToTaxable: number;
  /** Conversion tax that reduced the Roth deposit instead of the taxable account. */
  conversionTaxWithheld: number;
  /** Federal and state tax removed from an account or withheld from a deposit. */
  taxRemoved: number;
};

function projectPerson(
  settings: Record<AccountType, AccountSettings>,
  balances: Balances,
  year: number,
  age: number,
  retired: boolean,
  marriedThisYear: boolean,
  birthYear: number,
  spouseAge: number | null,
  agi: number,
  types: AccountType[],
  state: string,
  ssBenefitAnnual: number,
  ssStartAge: number,
  ordinaryAlready: number,
  who: "primary" | "spouse",
  plannedConversion: number | null = null,
): YearSlice {
  const filing: FilingStatus = marriedThisYear ? "married" : "single";
  const ss = age >= ssStartAge ? ssBenefitAnnual : 0;
  const taxableSS = taxableSocialSecurity(ss, agi, filing);
  const baseIncome = agi + taxableSS;
  const rmdAge = rmdStartAge(birthYear);
  const k401 = settings.fourOhOneK;
  const retirementSplit = (mine: number) =>
    who === "primary" ? { primary: mine, spouse: 0, other: agi } : { primary: 0, spouse: mine, other: agi };

  let rmdAmount = 0;
  let netRmdToTaxable = 0;
  let rmdConversionGross = 0;
  let netRmdConversionToRoth = 0;
  let rmdConversionTax = 0;
  let rmdTax = 0;

  if (k401.enabled && age >= rmdAge) {
    const factor = rmdFactor(age);
    rmdAmount = balances.fourOhOneK / factor;
    const fed = federalTax(baseIncome + rmdAmount, filing, age, spouseAge, baseIncome) - federalTax(baseIncome, filing, age, spouseAge, baseIncome);
    const st =
      stateTax(baseIncome + rmdAmount, state, filing, age, spouseAge, taxableSS, retirementSplit(rmdAmount)) -
      stateTax(baseIncome, state, filing, age, spouseAge, taxableSS, retirementSplit(0));
    rmdTax = fed + st;
    netRmdToTaxable = rmdAmount - rmdTax;

    if (plannedConversion === null && k401.rmdConversion) {
      const cap = irmaaCapAmount(k401.irmaaBracket, filing);
      const ceiling = Math.min(bracketCeiling(k401.rmdConversionBracketRate, filing, age, spouseAge, baseIncome), cap);
      let extra = Math.max(0, ceiling - baseIncome - rmdAmount - ordinaryAlready);
      for (let i = 0; i < 5; i++) {
        const ssTax = taxableSocialSecurity(ss, agi + rmdAmount + ordinaryAlready + extra, filing);
        const next = Math.max(0, ceiling - agi - rmdAmount - ordinaryAlready - ssTax);
        if (Math.abs(next - extra) < 1) break;
        extra = next;
      }
      const conversion = Math.min(extra, balances.fourOhOneK - rmdAmount);
      if (conversion > 0) {
        const other = agi + rmdAmount + conversion;
        const ssTax = taxableSocialSecurity(ss, other, filing);
        const gross = other + ssTax;
        const fedAll = federalTax(gross, filing, age, spouseAge, agi) - federalTax(baseIncome, filing, age, spouseAge, agi);
        const stAll =
          stateTax(gross, state, filing, age, spouseAge, ssTax, retirementSplit(rmdAmount + conversion)) -
          stateTax(baseIncome, state, filing, age, spouseAge, taxableSS, retirementSplit(0));
        rmdConversionTax = fedAll + stAll - rmdTax;
        rmdConversionGross = conversion;
        netRmdConversionToRoth = conversion - rmdConversionTax;
      }
    }
  }

  let preGross = 0;
  let netPreToRoth = 0;
  let preTax = 0;
  if (plannedConversion === null && k401.enabled && k401.preRmdConversion && retired && age >= 60 && age < rmdAge) {
    const cap = irmaaCapAmount(k401.irmaaBracket, filing);
    const ceiling = Math.min(bracketCeiling(k401.preRmdConversionBracketRate, filing, age, spouseAge, baseIncome), cap);
    let extra = Math.max(0, ceiling - baseIncome - ordinaryAlready);
    for (let i = 0; i < 5; i++) {
      const ssTax = taxableSocialSecurity(ss, agi + ordinaryAlready + extra, filing);
      const next = Math.max(0, ceiling - agi - ordinaryAlready - ssTax);
      if (Math.abs(next - extra) < 1) break;
      extra = next;
    }
    const conversion = Math.min(extra, balances.fourOhOneK);
    const other = agi + conversion;
    const ssTax = taxableSocialSecurity(ss, other, filing);
    const gross = other + ssTax;
    const fed = federalTax(gross, filing, age, spouseAge, agi) - federalTax(baseIncome, filing, age, spouseAge, agi);
    const st =
      stateTax(gross, state, filing, age, spouseAge, ssTax, retirementSplit(conversion)) -
      stateTax(baseIncome, state, filing, age, spouseAge, taxableSS, retirementSplit(0));
    preTax = fed + st;
    preGross = conversion;
    netPreToRoth = conversion - preTax;
  }

  if (plannedConversion !== null && plannedConversion > 0 && k401.enabled && retired && age >= 60) {
    const available = Math.max(0, balances.fourOhOneK - rmdAmount);
    const conversion = Math.min(plannedConversion, available);
    if (conversion > 0) {
      const already = ordinaryAlready;
      const split = (mine: number, otherRetirement: number) =>
        who === "primary"
          ? { primary: mine, spouse: otherRetirement, other: agi }
          : { primary: otherRetirement, spouse: mine, other: agi };
      const baselineOrdinary = rmdAmount + already;
      const ssBaseline = taxableSocialSecurity(ss, agi + baselineOrdinary, filing);
      const baselineGross = agi + baselineOrdinary + ssBaseline;
      const stacked = baselineOrdinary + conversion;
      const ssTax = taxableSocialSecurity(ss, agi + stacked, filing);
      const gross = agi + stacked + ssTax;
      const fedAll = federalTax(gross, filing, age, spouseAge, agi) - federalTax(baselineGross, filing, age, spouseAge, agi);
      const stAll =
        stateTax(gross, state, filing, age, spouseAge, ssTax, split(rmdAmount + conversion, already)) -
        stateTax(baselineGross, state, filing, age, spouseAge, ssBaseline, split(rmdAmount, already));
      const convTax = Math.max(0, fedAll + stAll);
      if (rmdAmount > 0) {
        rmdConversionTax = convTax;
        rmdConversionGross = conversion;
        netRmdConversionToRoth = conversion - convTax;
      } else {
        preTax = convTax;
        preGross = conversion;
        netPreToRoth = conversion - preTax;
      }
    }
  }

  let taxPaidFromTaxable = 0;
  if (k401.payConversionTaxFromTaxable) {
    const taxDue = preTax + rmdConversionTax;
    const covered = Math.min(taxDue, balances.taxable);
    taxPaidFromTaxable = covered;
    let remaining = covered;
    if (preGross > 0) {
      const paid = Math.min(preTax, remaining);
      netPreToRoth = preGross - (preTax - paid);
      remaining -= paid;
    }
    if (rmdConversionGross > 0) {
      const paid = Math.min(rmdConversionTax, remaining);
      netRmdConversionToRoth = rmdConversionGross - (rmdConversionTax - paid);
      remaining -= paid;
    }
  }

  const periodOn = age < rmdAge ? k401.preRmdConversion : k401.rmdConversion;
  let convertible = k401.enabled && retired && age >= 60 && periodOn ? Math.max(0, balances.fourOhOneK - rmdAmount) : 0;
  if (convertible > 0) {
    const rate = age < rmdAge ? k401.preRmdConversionBracketRate : k401.rmdConversionBracketRate;
    const cap = Math.min(bracketCeiling(rate, filing, age, spouseAge, baseIncome), irmaaCapAmount(k401.irmaaBracket, filing));
    if (Number.isFinite(cap)) {
      const already = ordinaryAlready + rmdAmount;
      let extra = Math.max(0, cap - agi - already);
      for (let i = 0; i < 5; i++) {
        const ssTax = taxableSocialSecurity(ss, agi + already + extra, filing);
        const next = Math.max(0, cap - agi - already - ssTax);
        if (Math.abs(next - extra) < 1) break;
        extra = next;
      }
      convertible = Math.min(convertible, extra);
    }
  }
  const accounts = {} as Record<AccountType, AccountYear>;
  let cashKept = 0;
  for (const type of types) {
    const acct = settings[type];
    if (!acct.enabled) {
      accounts[type] = {
        year,
        age,
        startBalance: balances[type],
        contributionLimit: 0,
        contribution: 0,
        withdrawal: 0,
        growth: 0,
        endBalance: balances[type],
      };
      continue;
    }
    const limit = contributionLimit(type, year, age);
    const stopBecauseRetired = type === "rothIra" || type === "fourOhOneK" || type === "taxable";
    const stopped = stopBecauseRetired ? retired : age >= acct.stopContributionAge;
    let contribution = 0;
    if (!stopped) {
      const inflated = Math.pow(1 + INFLATION, year - CURRENT_YEAR);
      contribution = acct.annualContribution * inflated;
      if (type === "fourOhOneK" && acct.employerMatch > 0) {
        contribution += acct.employerMatch * inflated;
      }
    }
    if (type === "taxable") contribution += netRmdToTaxable;
    if (type === "rothIra") contribution += netPreToRoth + netRmdConversionToRoth;

    const start = balances[type];
    let scheduled = 0;
    if (age >= acct.startWithdrawalAge) {
      scheduled = acct.withdrawalIsPercentage ? (start + contribution) * (acct.annualWithdrawal / 100) : acct.annualWithdrawal;
    }
    let mandatory = 0;
    if (type === "fourOhOneK" && age >= rmdAge) mandatory += start / rmdFactor(age);
    if (type === "fourOhOneK") mandatory += preGross + rmdConversionGross;
    if (type === "taxable" && taxPaidFromTaxable > 0) mandatory += taxPaidFromTaxable;
    const available = start + contribution;
    const withdrawal = Math.min(available, mandatory + Math.max(0, scheduled));
    cashKept += Math.max(0, withdrawal - Math.min(mandatory, available));
    const afterCashflow = start + contribution - withdrawal;
    const growth = afterCashflow * (acct.rateOfReturn / 100);
    const end = Math.max(0, afterCashflow + growth);
    balances[type] = end;
    accounts[type] = {
      year,
      age,
      startBalance: start,
      contributionLimit: limit === Infinity ? 0 : limit,
      contribution,
      withdrawal,
      growth,
      endBalance: end,
    };
  }
  return {
    accounts,
    rmdAmount,
    conversionAmount: preGross + rmdConversionGross,
    cashKept,
    convertible,
    netRmdToTaxable,
    conversionTaxWithheld: Math.max(0, preTax + rmdConversionTax - taxPaidFromTaxable),
    taxRemoved: rmdTax + preTax + rmdConversionTax,
  };
}

function mergeAccounts(
  primary: Record<AccountType, AccountYear>,
  spouse: Record<AccountType, AccountYear> | null,
): Record<AccountType, AccountYear> {
  const merged = {} as Record<AccountType, AccountYear>;
  for (const type of ACCOUNT_TYPES) {
    const a = primary[type];
    const b = spouse?.[type];
    if (!a) continue;
    if (!b) {
      merged[type] = a;
      continue;
    }
    merged[type] = {
      year: a.year,
      age: a.age,
      startBalance: a.startBalance + b.startBalance,
      contributionLimit: a.contributionLimit + b.contributionLimit,
      contribution: a.contribution + b.contribution,
      withdrawal: a.withdrawal + b.withdrawal,
      growth: a.growth + b.growth,
      endBalance: a.endBalance + b.endBalance,
    };
  }
  return merged;
}

function depositBeforeGrowth(account: AccountYear, amount: number, ratePct: number, balances: Balances, type: AccountType) {
  if (amount <= 0) return;
  const growth = ratePct / 100;
  const after = account.startBalance + account.contribution - account.withdrawal;
  const next = after + amount;
  account.contribution += amount;
  account.growth = next * growth;
  account.endBalance = Math.max(0, next + account.growth);
  balances[type] = account.endBalance;
}

/** Withdraw before growth. Returns the amount the account could actually pay. */
function withdrawBeforeGrowth(account: AccountYear, amount: number, ratePct: number, balances: Balances, type: AccountType): number {
  if (amount <= 0) return 0;
  const growth = ratePct / 100;
  const after = account.startBalance + account.contribution - account.withdrawal;
  const paid = Math.min(Math.max(0, after), amount);
  const next = after - paid;
  account.withdrawal += paid;
  account.growth = next * growth;
  account.endBalance = Math.max(0, next + account.growth);
  balances[type] = account.endBalance;
  return paid;
}

export type ConversionPlan = Record<number, { primary: number; spouse: number }>;

/** Last primary age from longevity, extended when a spouse lives longer. */
export function longevityEndAge(inputs: PlannerInputs): number {
  const startAge = CURRENT_YEAR - inputs.birthYear;
  let endAge = inputs.longevityAge;
  if (inputs.filingStatus === "married" && inputs.spouseBirthYear !== null) {
    const spouseEnd = inputs.spouseBirthYear + inputs.spouseLongevityAge;
    const primaryEnd = inputs.birthYear + inputs.longevityAge;
    endAge = Math.max(primaryEnd, spouseEnd) - inputs.birthYear;
  }
  return Math.max(startAge, endAge);
}

/** Primary age at which "Maximize at age" scores the money still held. */
export function optimizationTargetAge(inputs: PlannerInputs): number {
  const startAge = CURRENT_YEAR - inputs.birthYear;
  const chosen = Number.isFinite(inputs.optimizeThroughAge) ? Math.round(inputs.optimizeThroughAge) : inputs.longevityAge;
  return Math.max(startAge, Math.min(120, chosen));
}

/** Last primary age shown in the table. Maximize does not cut this short. */
export function projectionEndAge(inputs: PlannerInputs): number {
  const life = longevityEndAge(inputs);
  if (!inputs.optimizeDistributions) return life;
  return Math.max(life, optimizationTargetAge(inputs));
}

type Simulation = {
  rows: ProjectionRow[];
  score: number;
  room: Record<number, { primary: number; spouse: number }>;
};

function runProjection(inputs: PlannerInputs, plan: ConversionPlan | null, settleSpouseTax: boolean): Simulation {
  const rows: ProjectionRow[] = [];
  const room: Record<number, { primary: number; spouse: number }> = {};
  const startAge = CURRENT_YEAR - inputs.birthYear;
  const endAge = projectionEndAge(inputs);
  const targetAge = inputs.optimizeDistributions ? optimizationTargetAge(inputs) : endAge;

  const balances: Balances = {
    rothIra: inputs.accounts.rothIra.enabled ? inputs.accounts.rothIra.currentBalance : 0,
    hsa: inputs.accounts.hsa.enabled ? inputs.accounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.accounts.fourOhOneK.enabled ? inputs.accounts.fourOhOneK.currentBalance : 0,
    taxable: inputs.accounts.taxable.enabled ? inputs.accounts.taxable.currentBalance : 0,
  };
  const spouseBalances: Balances = {
    rothIra: inputs.spouseAccounts.rothIra.enabled ? inputs.spouseAccounts.rothIra.currentBalance : 0,
    hsa: inputs.spouseAccounts.hsa.enabled ? inputs.spouseAccounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.spouseAccounts.fourOhOneK.enabled ? inputs.spouseAccounts.fourOhOneK.currentBalance : 0,
    taxable: 0,
  };
  const married = inputs.filingStatus === "married";
  let kept = 0;
  let spent = 0;
  let targetScore: number | null = null;

  for (let age = startAge; age <= endAge; age++) {
    const year = inputs.birthYear + age;
    const marriedNow = married && inputs.marriageYear !== null && year >= inputs.marriageYear;
    const spouseAge = inputs.spouseBirthYear !== null ? year - inputs.spouseBirthYear : null;
    const retired = year >= inputs.retirementYear;
    const plannedPrimary = plan ? (plan[year]?.primary ?? 0) : null;
    const primary = projectPerson(
      inputs.accounts,
      balances,
      year,
      age,
      retired,
      marriedNow,
      inputs.birthYear,
      marriedNow ? spouseAge : null,
      inputs.adjustedGrossIncome,
      [...ACCOUNT_TYPES],
      inputs.state,
      inputs.socialSecurityIncome,
      inputs.socialSecurityStartAge,
      0,
      "primary",
      plannedPrimary,
    );
    let spouse: YearSlice | null = null;
    if (married && marriedNow && spouseAge !== null && inputs.spouseBirthYear !== null) {
      const plannedSpouse = plan ? (plan[year]?.spouse ?? 0) : null;
      spouse = projectPerson(
        inputs.spouseAccounts,
        spouseBalances,
        year,
        spouseAge,
        retired,
        marriedNow,
        inputs.spouseBirthYear,
        age,
        inputs.adjustedGrossIncome,
        ["rothIra", "hsa", "fourOhOneK"],
        inputs.state,
        inputs.socialSecurityIncome,
        inputs.socialSecurityStartAge,
        primary.rmdAmount + primary.conversionAmount,
        "spouse",
        plannedSpouse,
      );
      if (inputs.accounts.taxable.enabled) {
        const taxableRate = inputs.accounts.taxable.rateOfReturn;
        depositBeforeGrowth(primary.accounts.taxable, spouse.netRmdToTaxable, taxableRate, balances, "taxable");
        const moveTax = inputs.spouseAccounts.fourOhOneK.payConversionTaxFromTaxable;
        if (moveTax && spouse.conversionTaxWithheld > 0 && inputs.spouseAccounts.rothIra.enabled) {
          const paid = withdrawBeforeGrowth(primary.accounts.taxable, spouse.conversionTaxWithheld, taxableRate, balances, "taxable");
          depositBeforeGrowth(spouse.accounts.rothIra, paid, inputs.spouseAccounts.rothIra.rateOfReturn, spouseBalances, "rothIra");
        }
      } else {
        kept += spouse.netRmdToTaxable;
      }
    }
    room[year] = { primary: primary.convertible, spouse: spouse?.convertible ?? 0 };
    kept += primary.cashKept + (spouse?.cashKept ?? 0);
    const accounts = mergeAccounts(primary.accounts, spouse ? spouse.accounts : null);
    const filingNow: FilingStatus = marriedNow ? "married" : "single";
    const ssIncome = age >= inputs.socialSecurityStartAge ? inputs.socialSecurityIncome : 0;
    const rmdAmount = primary.rmdAmount + (spouse?.rmdAmount ?? 0);
    const conversionAmount = primary.conversionAmount + (spouse?.conversionAmount ?? 0);
    const ordinary = rmdAmount + conversionAmount;
    const taxableSS = taxableSocialSecurity(ssIncome, inputs.adjustedGrossIncome + ordinary, filingNow);
    const gross = inputs.adjustedGrossIncome + taxableSS + ordinary;
    const standardDeduction = filingNow === "married" ? STANDARD_DEDUCTION.married : STANDARD_DEDUCTION.single;
    const additionalDeduction = additionalStdDeduction(filingNow, age, spouseAge);
    const elderlyAgiDeduction = seniorBonus(filingNow, age, spouseAge, inputs.adjustedGrossIncome + ordinary);
    const totalDeductions = standardDeduction + additionalDeduction + elderlyAgiDeduction;
    const taxableIncome = Math.max(0, gross - totalDeductions);
    const fed = federalTax(gross, filingNow, age, spouseAge, inputs.adjustedGrossIncome + ordinary);
    const st = stateTax(gross, inputs.state, filingNow, age, spouseAge, taxableSS, {
      primary: primary.rmdAmount + primary.conversionAmount,
      spouse: (spouse?.rmdAmount ?? 0) + (spouse?.conversionAmount ?? 0),
      other: inputs.adjustedGrossIncome,
    });
    const removed = primary.taxRemoved + (spouse?.taxRemoved ?? 0);
    spent += Math.max(0, fed + st - removed);
    const annualGross = inputs.adjustedGrossIncome + ssIncome + ordinary;
    const irmaaMagi = inputs.adjustedGrossIncome + taxableSS + ordinary;
    let total = 0;
    for (const type of ACCOUNT_TYPES) total += accounts[type].endBalance;
    const filingForRow: FilingStatus = filingNow;
    const prior = rows.find((item) => item.year === year - 2);
    const irmaa = assessIrmaa(year, age, spouseAge, filingForRow, prior);
    if (irmaa.annualFee !== null) spent += irmaa.annualFee;
    const spendable = spendableTotal({
      face: total,
      roth: accounts.rothIra.endBalance,
      taxable: accounts.taxable.endBalance,
      pretax401: {
        primary: primary.accounts.fourOhOneK.endBalance,
        spouse: spouse?.accounts.fourOhOneK.endBalance ?? 0,
      },
      hsa: {
        primary: primary.accounts.hsa.endBalance,
        spouse: spouse?.accounts.hsa.endBalance ?? 0,
      },
      ordinary,
      retirement: {
        primary: primary.rmdAmount + primary.conversionAmount,
        spouse: (spouse?.rmdAmount ?? 0) + (spouse?.conversionAmount ?? 0),
      },
      age,
      spouseAge,
      spouseActive: spouse !== null,
      filing: filingNow,
      state: inputs.state,
      ssIncome,
      agi: inputs.adjustedGrossIncome,
      irmaaThisYear: irmaa.annualFee,
      futureEnrollees: irmaaCashoutEnrollees(inputs, age, spouseAge).enrollees,
      futureYear: irmaaCashoutEnrollees(inputs, age, spouseAge).year,
    });
    if (age === targetAge) targetScore = targetObjective(spendable, kept, spent, spendableWeight(inputs));
    rows.push({
      year,
      age,
      spouseAge,
      filingStatus: filingForRow,
      accounts,
      totalBalance: total,
      liquidBalance: spendable.spendable,
      spendable,
      taxSummary: {
        agi: inputs.adjustedGrossIncome,
        ssIncome,
        taxableSS,
        rmdAmount,
        conversionAmount,
        grossIncome: gross,
        standardDeduction,
        additionalDeduction,
        elderlyAgiDeduction,
        totalDeductions,
        taxableIncome,
        federalTax: fed,
        stateTax: st,
        totalTax: fed + st,
        annualGross,
        annualNet: annualGross - fed - st,
        irmaaMagi,
        irmaa,
      },
    });
  }
  return { rows, score: targetScore ?? 0, room };
}

const CONVERSION_RATES = [10, 12, 22, 24, 32, 35];

function conversionCandidates(
  room: number,
  filing: FilingStatus,
  age: number,
  spouseAge: number | null,
  ordinaryAlready: number,
  agi: number,
): number[] {
  if (room <= 1) return [0];
  const values = [0, room, room * 0.25, room * 0.5, room * 0.75];
  const phaseout = agi + ordinaryAlready;
  for (const rate of CONVERSION_RATES) {
    values.push(bracketCeiling(rate, filing, age, spouseAge, phaseout) - agi - ordinaryAlready);
  }
  for (const tier of IRMAA_TIERS) {
    if (!Number.isFinite(tier.jointCap)) continue;
    const cap = filing === "married" ? tier.jointCap : tier.singleCap;
    values.push(cap - agi - ordinaryAlready);
  }
  const unique = new Set<number>();
  for (const value of values) {
    if (value <= 1) {
      unique.add(0);
      continue;
    }
    unique.add(Math.round(Math.min(room, value)));
  }
  unique.add(Math.round(room));
  return [...unique].sort((a, b) => a - b);
}

function optimizePlan(inputs: PlannerInputs): ConversionPlan {
  let plan: ConversionPlan = {};
  let preview = runProjection(inputs, plan, true);
  for (const row of preview.rows) plan[row.year] = { primary: 0, spouse: 0 };
  for (let pass = 0; pass < 2; pass++) {
    preview = runProjection(inputs, plan, true);
    for (const row of preview.rows) {
      const who: Array<"primary" | "spouse"> = ["primary", "spouse"];
      for (const person of who) {
        const room = preview.room[row.year]?.[person] ?? 0;
        if (room <= 1) continue;
        const current = plan[row.year]?.[person] ?? 0;
        const other = person === "primary" ? (plan[row.year]?.spouse ?? 0) : (plan[row.year]?.primary ?? 0);
        const ordinary = Math.max(0, row.taxSummary.rmdAmount + other);
        const options = conversionCandidates(
          room,
          row.filingStatus,
          person === "primary" ? row.age : (row.spouseAge ?? row.age),
          person === "primary" ? row.spouseAge : row.age,
          ordinary,
          inputs.adjustedGrossIncome,
        );
        let best = current;
        let bestScore = preview.score;
        for (const amount of options) {
          if (Math.abs(amount - best) < 1) continue;
          const next: ConversionPlan = {
            ...plan,
            [row.year]: {
              primary: person === "primary" ? amount : (plan[row.year]?.primary ?? 0),
              spouse: person === "spouse" ? amount : (plan[row.year]?.spouse ?? 0),
            },
          };
          const sim = runProjection(inputs, next, true);
          if (sim.score > bestScore + 1) {
            bestScore = sim.score;
            best = amount;
          }
        }
        if (Math.abs(best - current) >= 1) {
          plan = {
            ...plan,
            [row.year]: {
              primary: person === "primary" ? best : (plan[row.year]?.primary ?? 0),
              spouse: person === "spouse" ? best : (plan[row.year]?.spouse ?? 0),
            },
          };
          preview = runProjection(inputs, plan, true);
        }
      }
    }
  }
  return plan;
}

export function project(inputs: PlannerInputs): ProjectionRow[] {
  if (!inputs.optimizeDistributions) return runProjection(inputs, null, false).rows;
  return runProjection(inputs, optimizePlan(inputs), true).rows;
}

type MoneyBalances = Record<AccountType, number>;

function baseContribution(acct: AccountSettings, type: AccountType, year: number, age: number, retired: boolean): number {
  if (!acct.enabled) return 0;
  const stopBecauseRetired = type === "rothIra" || type === "fourOhOneK" || type === "taxable";
  const stopped = stopBecauseRetired ? retired : age >= acct.stopContributionAge;
  if (stopped) return 0;
  const inflated = Math.pow(1 + INFLATION, year - CURRENT_YEAR);
  let contribution = acct.annualContribution * inflated;
  if (type === "fourOhOneK" && acct.employerMatch > 0) contribution += acct.employerMatch * inflated;
  return contribution;
}

function wantedWithdrawal(acct: AccountSettings, age: number, pool: number): number {
  if (!acct.enabled || age < acct.startWithdrawalAge || acct.annualWithdrawal <= 0) return 0;
  if (acct.withdrawalIsPercentage) return pool * (acct.annualWithdrawal / 100);
  return acct.annualWithdrawal;
}

function applyAccount(
  acct: AccountSettings,
  start: number,
  contribution: number,
  withdrawal: number,
): { end: number; growth: number; contribution: number; withdrawal: number } {
  if (!acct.enabled) return { end: start, growth: 0, contribution: 0, withdrawal: 0 };
  const after = start + contribution - withdrawal;
  const growth = after * (acct.rateOfReturn / 100);
  return { end: Math.max(0, after + growth), growth, contribution, withdrawal };
}

/**
 * Projection used by the exact optimizer.
 * Distribution tax on a required minimum is paid from the taxable account up to
 * the cash there. Conversion tax is paid from that account only when that
 * person's switch is on, and only a plan that can cover it is kept. Otherwise
 * the conversion tax is withheld from that person's Roth deposit.
 * Balances still in a 401(k) or HSA are reduced by the chosen share of the cost to cash them out.
 * When maximize is on, that score is taken at the target age. Later years still
 * run through longevity, with no further Roth conversions.
 */
export function simulatePlan(inputs: PlannerInputs, plan: ConversionPlan): { rows: ProjectionRow[]; score: number } {
  const rows: ProjectionRow[] = [];
  const startAge = CURRENT_YEAR - inputs.birthYear;
  const endAge = projectionEndAge(inputs);
  const targetAge = inputs.optimizeDistributions ? optimizationTargetAge(inputs) : endAge;
  const primary: MoneyBalances = {
    rothIra: inputs.accounts.rothIra.enabled ? inputs.accounts.rothIra.currentBalance : 0,
    hsa: inputs.accounts.hsa.enabled ? inputs.accounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.accounts.fourOhOneK.enabled ? inputs.accounts.fourOhOneK.currentBalance : 0,
    taxable: inputs.accounts.taxable.enabled ? inputs.accounts.taxable.currentBalance : 0,
  };
  const spouse: MoneyBalances = {
    rothIra: inputs.spouseAccounts.rothIra.enabled ? inputs.spouseAccounts.rothIra.currentBalance : 0,
    hsa: inputs.spouseAccounts.hsa.enabled ? inputs.spouseAccounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.spouseAccounts.fourOhOneK.enabled ? inputs.spouseAccounts.fourOhOneK.currentBalance : 0,
    taxable: 0,
  };
  const married = inputs.filingStatus === "married";
  let kept = 0;
  let spent = 0;
  let targetScore: number | null = null;

  for (let age = startAge; age <= endAge; age++) {
    const year = inputs.birthYear + age;
    const spouseAge = inputs.spouseBirthYear !== null ? year - inputs.spouseBirthYear : null;
    const marriedNow = married && inputs.marriageYear !== null && year >= inputs.marriageYear && spouseAge !== null;
    const retired = year >= inputs.retirementYear;
    const filingNow: FilingStatus = marriedNow ? "married" : "single";
    const spouseActive = marriedNow && inputs.spouseBirthYear !== null && spouseAge !== null;

    const rmdAgeP = rmdStartAge(inputs.birthYear);
    const rmdAgeS = inputs.spouseBirthYear === null ? 120 : rmdStartAge(inputs.spouseBirthYear);
    const rmdP = inputs.accounts.fourOhOneK.enabled && age >= rmdAgeP ? primary.fourOhOneK / rmdFactor(age) : 0;
    const rmdS =
      spouseActive && inputs.spouseAccounts.fourOhOneK.enabled && spouseAge !== null && spouseAge >= rmdAgeS
        ? spouse.fourOhOneK / rmdFactor(spouseAge)
        : 0;
    const roomP = inputs.accounts.fourOhOneK.enabled && retired && age >= 60 ? Math.max(0, primary.fourOhOneK - rmdP) : 0;
    const roomS =
      spouseActive && inputs.spouseAccounts.fourOhOneK.enabled && retired && spouseAge !== null && spouseAge >= 60
        ? Math.max(0, spouse.fourOhOneK - rmdS)
        : 0;
    const allowP =
      roomP > 0 && (age < rmdAgeP ? inputs.accounts.fourOhOneK.preRmdConversion : inputs.accounts.fourOhOneK.rmdConversion);
    const allowS =
      roomS > 0 &&
      spouseAge !== null &&
      (spouseAge < rmdAgeS ? inputs.spouseAccounts.fourOhOneK.preRmdConversion : inputs.spouseAccounts.fourOhOneK.rmdConversion);
    const convP = allowP ? Math.min(roomP, Math.max(0, plan[year]?.primary ?? 0)) : 0;
    const convS = allowS ? Math.min(roomS, Math.max(0, plan[year]?.spouse ?? 0)) : 0;

    const ssIncome = age >= inputs.socialSecurityStartAge ? inputs.socialSecurityIncome : 0;
    const ordinary = rmdP + rmdS + convP + convS;
    const agi = inputs.adjustedGrossIncome;
    const taxableSS = taxableSocialSecurity(ssIncome, agi + ordinary, filingNow);
    const gross = agi + taxableSS + ordinary;
    const fed = federalTax(gross, filingNow, age, spouseAge, agi + ordinary);
    const st = stateTax(gross, inputs.state, filingNow, age, spouseAge, taxableSS, {
      primary: rmdP + convP,
      spouse: rmdS + convS,
      other: agi,
    });
    const baseSs = taxableSocialSecurity(ssIncome, agi, filingNow);
    const baseTax =
      federalTax(agi + baseSs, filingNow, age, spouseAge, agi) +
      stateTax(agi + baseSs, inputs.state, filingNow, age, spouseAge, baseSs, { primary: 0, spouse: 0, other: agi });
    const distTax = Math.max(0, fed + st - baseTax);
    const bill = (pRet: number, sRet: number) => {
      const amount = pRet + sRet;
      const ssTax = taxableSocialSecurity(ssIncome, agi + amount, filingNow);
      const grossIncome = agi + ssTax + amount;
      return (
        federalTax(grossIncome, filingNow, age, spouseAge, agi + amount) +
        stateTax(grossIncome, inputs.state, filingNow, age, spouseAge, ssTax, { primary: pRet, spouse: sRet, other: agi })
      );
    };
    const at0 = bill(0, 0);
    const atR = bill(rmdP, rmdS);
    const atP = bill(rmdP + convP, rmdS);
    const rmdTax = Math.min(distTax, Math.max(0, atR - at0));
    const throughP = Math.min(distTax, Math.max(rmdTax, atP - at0));
    const pConvTax = throughP - rmdTax;
    const sConvTax = distTax - throughP;
    const payP = inputs.accounts.fourOhOneK.payConversionTaxFromTaxable;
    const payS = spouseActive && inputs.spouseAccounts.fourOhOneK.payConversionTaxFromTaxable;
    const due = rmdTax + (payP ? pConvTax : 0) + (payS ? sConvTax : 0);

    const taxAcct = inputs.accounts.taxable;
    const taxContrib = baseContribution(taxAcct, "taxable", year, age, retired);
    const rmdDeposit = taxAcct.enabled ? rmdP + rmdS : 0;
    const pool = (taxAcct.enabled ? primary.taxable : 0) + taxContrib + rmdDeposit;
    const paid = Math.min(due, Math.max(0, pool));
    const whP = !payP && inputs.accounts.rothIra.enabled ? Math.min(pConvTax, convP) : 0;
    const whS = !payS && spouseActive && inputs.spouseAccounts.rothIra.enabled ? Math.min(sConvTax, convS) : 0;
    const rest = Math.max(0, distTax - paid - whP - whS);

    const pAccounts = {} as Record<AccountType, AccountYear>;
    const flow = (
      who: "primary" | "spouse",
      type: AccountType,
      start: number,
      contribution: number,
      withdrawal: number,
      personAge: number,
    ) => {
      const acct = (who === "primary" ? inputs.accounts : inputs.spouseAccounts)[type];
      const applied = applyAccount(acct, start, contribution, withdrawal);
      const row: AccountYear = {
        year,
        age: personAge,
        startBalance: start,
        contributionLimit: 0,
        contribution: applied.contribution,
        withdrawal: applied.withdrawal,
        growth: applied.growth,
        endBalance: applied.end,
      };
      return row;
    };

    const p401In = baseContribution(inputs.accounts.fourOhOneK, "fourOhOneK", year, age, retired);
    const p401Want = wantedWithdrawal(inputs.accounts.fourOhOneK, age, primary.fourOhOneK + p401In);
    const p401Kept = Math.min(p401Want, Math.max(0, primary.fourOhOneK + p401In - rmdP - convP));
    pAccounts.fourOhOneK = flow("primary", "fourOhOneK", primary.fourOhOneK, p401In, rmdP + convP + p401Kept, age);

    const pRothIn =
      baseContribution(inputs.accounts.rothIra, "rothIra", year, age, retired) +
      (inputs.accounts.rothIra.enabled ? convP - whP : 0);
    const pRothWant = wantedWithdrawal(inputs.accounts.rothIra, age, primary.rothIra + pRothIn);
    const pRothKept = inputs.accounts.rothIra.enabled ? Math.min(pRothWant, Math.max(0, primary.rothIra + pRothIn)) : 0;
    pAccounts.rothIra = flow("primary", "rothIra", primary.rothIra, pRothIn, pRothKept, age);

    const pHsaIn = baseContribution(inputs.accounts.hsa, "hsa", year, age, retired);
    const pHsaWant = wantedWithdrawal(inputs.accounts.hsa, age, primary.hsa + pHsaIn);
    const pHsaKept = inputs.accounts.hsa.enabled ? Math.min(pHsaWant, Math.max(0, primary.hsa + pHsaIn)) : 0;
    pAccounts.hsa = flow("primary", "hsa", primary.hsa, pHsaIn, pHsaKept, age);

    const taxWant = wantedWithdrawal(taxAcct, age, pool);
    const taxKept = taxAcct.enabled ? Math.min(taxWant, Math.max(0, pool - paid)) : 0;
    pAccounts.taxable = flow("primary", "taxable", primary.taxable, taxContrib + rmdDeposit, paid + taxKept, age);

    let sAccounts: Record<AccountType, AccountYear> | null = null;
    let s401Kept = 0;
    let sRothKept = 0;
    let sHsaKept = 0;
    if (spouseActive && spouseAge !== null && inputs.spouseBirthYear !== null) {
      sAccounts = {} as Record<AccountType, AccountYear>;
      const s401In = baseContribution(inputs.spouseAccounts.fourOhOneK, "fourOhOneK", year, spouseAge, retired);
      const s401Want = wantedWithdrawal(inputs.spouseAccounts.fourOhOneK, spouseAge, spouse.fourOhOneK + s401In);
      s401Kept = Math.min(s401Want, Math.max(0, spouse.fourOhOneK + s401In - rmdS - convS));
      sAccounts.fourOhOneK = flow("spouse", "fourOhOneK", spouse.fourOhOneK, s401In, rmdS + convS + s401Kept, spouseAge);
      const sRothIn =
        baseContribution(inputs.spouseAccounts.rothIra, "rothIra", year, spouseAge, retired) +
        (inputs.spouseAccounts.rothIra.enabled ? convS - whS : 0);
      const sRothWant = wantedWithdrawal(inputs.spouseAccounts.rothIra, spouseAge, spouse.rothIra + sRothIn);
      sRothKept = inputs.spouseAccounts.rothIra.enabled ? Math.min(sRothWant, Math.max(0, spouse.rothIra + sRothIn)) : 0;
      sAccounts.rothIra = flow("spouse", "rothIra", spouse.rothIra, sRothIn, sRothKept, spouseAge);
      const sHsaIn = baseContribution(inputs.spouseAccounts.hsa, "hsa", year, spouseAge, retired);
      const sHsaWant = wantedWithdrawal(inputs.spouseAccounts.hsa, spouseAge, spouse.hsa + sHsaIn);
      sHsaKept = inputs.spouseAccounts.hsa.enabled ? Math.min(sHsaWant, Math.max(0, spouse.hsa + sHsaIn)) : 0;
      sAccounts.hsa = flow("spouse", "hsa", spouse.hsa, sHsaIn, sHsaKept, spouseAge);
      sAccounts.taxable = {
        year,
        age: spouseAge,
        startBalance: 0,
        contributionLimit: 0,
        contribution: 0,
        withdrawal: 0,
        growth: 0,
        endBalance: 0,
      };
      spouse.fourOhOneK = sAccounts.fourOhOneK.endBalance;
      spouse.rothIra = sAccounts.rothIra.endBalance;
      spouse.hsa = sAccounts.hsa.endBalance;
    }

    primary.fourOhOneK = pAccounts.fourOhOneK.endBalance;
    primary.rothIra = pAccounts.rothIra.endBalance;
    primary.hsa = pAccounts.hsa.endBalance;
    primary.taxable = pAccounts.taxable.endBalance;

    kept += p401Kept + pRothKept + pHsaKept + taxKept + s401Kept + sRothKept + sHsaKept;
    kept += taxAcct.enabled ? 0 : rmdP + rmdS;
    if (!inputs.accounts.rothIra.enabled) kept += convP;
    if (spouseActive && !inputs.spouseAccounts.rothIra.enabled) kept += convS;
    spent += baseTax + rest;

    const accounts = mergeAccounts(pAccounts, sAccounts);
    let total = 0;
    for (const type of ACCOUNT_TYPES) total += accounts[type].endBalance;
    const prior = rows.find((item) => item.year === year - 2);
    const irmaa = assessIrmaa(year, age, spouseAge, filingNow, prior);
    if (irmaa.annualFee !== null) spent += irmaa.annualFee;
    const spendable = spendableTotal({
      face: total,
      roth: accounts.rothIra.endBalance,
      taxable: accounts.taxable.endBalance,
      pretax401: {
        primary: pAccounts.fourOhOneK.endBalance,
        spouse: sAccounts?.fourOhOneK.endBalance ?? 0,
      },
      hsa: {
        primary: pAccounts.hsa.endBalance,
        spouse: sAccounts?.hsa.endBalance ?? 0,
      },
      ordinary,
      retirement: { primary: rmdP + convP, spouse: rmdS + convS },
      age,
      spouseAge,
      spouseActive,
      filing: filingNow,
      state: inputs.state,
      ssIncome,
      agi,
      irmaaThisYear: irmaa.annualFee,
      futureEnrollees: irmaaCashoutEnrollees(inputs, age, spouseAge).enrollees,
      futureYear: irmaaCashoutEnrollees(inputs, age, spouseAge).year,
    });
    const standardDeduction = filingNow === "married" ? STANDARD_DEDUCTION.married : STANDARD_DEDUCTION.single;
    const additionalDeduction = additionalStdDeduction(filingNow, age, spouseAge);
    const elderlyAgiDeduction = seniorBonus(filingNow, age, spouseAge, agi + ordinary);
    const totalDeductions = standardDeduction + additionalDeduction + elderlyAgiDeduction;
    rows.push({
      year,
      age,
      spouseAge,
      filingStatus: filingNow,
      accounts,
      totalBalance: total,
      liquidBalance: spendable.spendable,
      spendable,
      taxSummary: {
        agi,
        ssIncome,
        taxableSS,
        rmdAmount: rmdP + rmdS,
        conversionAmount: convP + convS,
        grossIncome: gross,
        standardDeduction,
        additionalDeduction,
        elderlyAgiDeduction,
        totalDeductions,
        taxableIncome: Math.max(0, gross - totalDeductions),
        federalTax: fed,
        stateTax: st,
        totalTax: fed + st,
        annualGross: agi + ssIncome + ordinary,
        annualNet: agi + ssIncome + ordinary - fed - st,
        irmaaMagi: gross,
        irmaa,
      },
    });
    if (age === targetAge) targetScore = targetObjective(spendable, kept, spent, spendableWeight(inputs));
  }
  return { rows, score: targetScore ?? 0 };
}

export type OptimizerYear = {
  year: number;
  age: number;
  spouseAge: number | null;
  filing: FilingStatus;
  spouseActive: boolean;
  retired: boolean;
  ss: number;
  agi: number;
  baseTax: number;
  /** 1/RMD factor, or 0 when no distribution is required. */
  rmdRateP: number;
  rmdRateS: number;
  canConvertP: boolean;
  canConvertS: boolean;
  initialP: MoneyBalances;
  initialS: MoneyBalances;
  contribP: MoneyBalances;
  contribS: MoneyBalances;
  rateP: MoneyBalances;
  rateS: MoneyBalances;
  enabledP: Record<AccountType, boolean>;
  enabledS: Record<AccountType, boolean>;
  withdrawP: Record<AccountType, { mode: "none" | "fixed" | "pct"; amount: number }>;
  withdrawS: Record<AccountType, { mode: "none" | "fixed" | "pct"; amount: number }>;
  senior: "none" | "one" | "both";
  seniorLow: number;
  seniorHigh: number;
  seniorFull: number;
  seniorSlope: number;
  fixedDeduction: number;
  federalLines: { slope: number; intercept: number }[];
  state: "none" | "ga" | "brackets";
  stateCode: string;
  gaRate: number;
  gaDeduction: number;
  gaCapP: number;
  gaCapS: number;
  stateLines: { slope: number; intercept: number }[];
  enrollees: number;
  /** Inclusive MAGI top of IRMAA tiers 0 through 4. Tier 5 is everything above the last entry. */
  irmaaUpper: number[];
  /** Annual IRMAA fee charged this year if the lookback year's tier index is k. */
  irmaaFeeByTier: number[];
  /** Annual IRMAA fee two years later if this year's MAGI is in tier k. Zero past longevity. */
  irmaaCashoutFeeByTier: number[];
  /** Household MAGI ceiling for Roth conversions this year. Null when nothing caps them. */
  magiCap: number | null;
  /** Pay this person's conversion tax from the taxable account instead of withholding it. */
  payTaxP: boolean;
  payTaxS: boolean;
};

function withdrawalMode(acct: AccountSettings, age: number): { mode: "none" | "fixed" | "pct"; amount: number } {
  if (!acct.enabled || age < acct.startWithdrawalAge || acct.annualWithdrawal <= 0) return { mode: "none", amount: 0 };
  if (acct.withdrawalIsPercentage) return { mode: "pct", amount: acct.annualWithdrawal / 100 };
  return { mode: "fixed", amount: acct.annualWithdrawal };
}

function federalSupportLines(filing: FilingStatus): { slope: number; intercept: number }[] {
  const lines = [{ slope: 0, intercept: 0 }];
  for (const bracket of bracketsFor(filing)) {
    lines.push({ slope: bracket.rate, intercept: bracket.baseTax - bracket.min * bracket.rate });
  }
  return lines;
}

function stateSupportLines(state: string, filing: FilingStatus): { slope: number; intercept: number }[] {
  const schedule = STATE_BRACKETS[state];
  if (!schedule || schedule.single.length === 0 || state === "GA") return [];
  const table = filing === "married" ? schedule.married : schedule.single;
  const lines = [{ slope: 0, intercept: 0 }];
  let taxAt = 0;
  for (let i = 0; i < table.length; i++) {
    const floor = table[i].min;
    const rate = table[i].rate;
    lines.push({ slope: rate, intercept: taxAt - rate * floor });
    if (i + 1 < table.length) taxAt += rate * (table[i + 1].min - floor);
  }
  if (state === "OH") {
    const floor = 26_050;
    const lump = 332;
    lines[lines.length - 1] = { slope: 0.0275, intercept: lump - 0.0275 * floor };
  }
  return lines;
}

/** Deterministic per-year inputs shared by the projection and the solver. */
export function optimizerCensus(inputs: PlannerInputs): OptimizerYear[] {
  const years: OptimizerYear[] = [];
  const startAge = CURRENT_YEAR - inputs.birthYear;
  const endAge = inputs.optimizeDistributions ? optimizationTargetAge(inputs) : longevityEndAge(inputs);
  const zero = { rothIra: 0, hsa: 0, fourOhOneK: 0, taxable: 0 };
  const initialP: MoneyBalances = {
    rothIra: inputs.accounts.rothIra.enabled ? inputs.accounts.rothIra.currentBalance : 0,
    hsa: inputs.accounts.hsa.enabled ? inputs.accounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.accounts.fourOhOneK.enabled ? inputs.accounts.fourOhOneK.currentBalance : 0,
    taxable: inputs.accounts.taxable.enabled ? inputs.accounts.taxable.currentBalance : 0,
  };
  const initialS: MoneyBalances = {
    rothIra: inputs.spouseAccounts.rothIra.enabled ? inputs.spouseAccounts.rothIra.currentBalance : 0,
    hsa: inputs.spouseAccounts.hsa.enabled ? inputs.spouseAccounts.hsa.currentBalance : 0,
    fourOhOneK: inputs.spouseAccounts.fourOhOneK.enabled ? inputs.spouseAccounts.fourOhOneK.currentBalance : 0,
    taxable: 0,
  };
  const married = inputs.filingStatus === "married";
  for (let age = startAge; age <= endAge; age++) {
    const year = inputs.birthYear + age;
    const spouseAge = inputs.spouseBirthYear !== null ? year - inputs.spouseBirthYear : null;
    const marriedNow = married && inputs.marriageYear !== null && year >= inputs.marriageYear && spouseAge !== null;
    const retired = year >= inputs.retirementYear;
    const filing: FilingStatus = marriedNow ? "married" : "single";
    const spouseActive = marriedNow && inputs.spouseBirthYear !== null && spouseAge !== null;
    const ss = age >= inputs.socialSecurityStartAge ? inputs.socialSecurityIncome : 0;
    const agi = inputs.adjustedGrossIncome;
    const baseSs = taxableSocialSecurity(ss, agi, filing);
    const baseTax =
      federalTax(agi + baseSs, filing, age, spouseAge, agi) +
      stateTax(agi + baseSs, inputs.state, filing, age, spouseAge, baseSs, { primary: 0, spouse: 0, other: agi });
    const both = filing === "married" && spouseAge !== null && age >= 65 && spouseAge >= 65;
    const any = age >= 65 || (spouseAge !== null && spouseAge >= 65);
    const senior = !any ? "none" : both ? "both" : "one";
    const accounts = inputs.accounts;
    const spouseAccounts = inputs.spouseAccounts;
    const enabledP = {
      rothIra: accounts.rothIra.enabled,
      hsa: accounts.hsa.enabled,
      fourOhOneK: accounts.fourOhOneK.enabled,
      taxable: accounts.taxable.enabled,
    };
    const enabledS = {
      rothIra: spouseActive && spouseAccounts.rothIra.enabled,
      hsa: spouseActive && spouseAccounts.hsa.enabled,
      fourOhOneK: spouseActive && spouseAccounts.fourOhOneK.enabled,
      taxable: false,
    };
    const rates = (src: typeof accounts, enabled: Record<AccountType, boolean>): MoneyBalances => ({
      rothIra: enabled.rothIra ? src.rothIra.rateOfReturn : 0,
      hsa: enabled.hsa ? src.hsa.rateOfReturn : 0,
      fourOhOneK: enabled.fourOhOneK ? src.fourOhOneK.rateOfReturn : 0,
      taxable: enabled.taxable ? src.taxable.rateOfReturn : 0,
    });
    const contribs = (src: typeof accounts, enabled: Record<AccountType, boolean>, personAge: number): MoneyBalances => ({
      rothIra: enabled.rothIra ? baseContribution(src.rothIra, "rothIra", year, personAge, retired) : 0,
      hsa: enabled.hsa ? baseContribution(src.hsa, "hsa", year, personAge, retired) : 0,
      fourOhOneK: enabled.fourOhOneK ? baseContribution(src.fourOhOneK, "fourOhOneK", year, personAge, retired) : 0,
      taxable: enabled.taxable ? baseContribution(src.taxable, "taxable", year, personAge, retired) : 0,
    });
    const upper = IRMAA_TIERS.filter((tier) => tier.id < 5).map((tier) => (filing === "married" ? tier.jointMax : tier.singleMax));
    const feeByTier = IRMAA_TIERS.map((tier) => (tier.partB + tier.partD) * 12 * medicareEnrollees(age, spouseAge, filing));
    const rmdAgeP = rmdStartAge(inputs.birthYear);
    const rmdAgeS = inputs.spouseBirthYear === null ? 120 : rmdStartAge(inputs.spouseBirthYear);
    const phaseout = agi + baseSs;
    const allowed = (acct: AccountSettings, personAge: number, rmdAge: number, enabled: boolean) =>
      enabled && retired && personAge >= 60 && (personAge < rmdAge ? acct.preRmdConversion : acct.rmdConversion);
    const finiteCaps: number[] = [];
    const pushCap = (acct: AccountSettings, personAge: number, rmdAge: number, enabled: boolean) => {
      if (!allowed(acct, personAge, rmdAge, enabled)) return;
      const rate = personAge < rmdAge ? acct.preRmdConversionBracketRate : acct.rmdConversionBracketRate;
      const ceiling = Math.min(bracketCeiling(rate, filing, age, spouseAge, phaseout), irmaaCapAmount(acct.irmaaBracket, filing));
      if (Number.isFinite(ceiling)) finiteCaps.push(ceiling);
    };
    pushCap(accounts.fourOhOneK, age, rmdAgeP, enabledP.fourOhOneK);
    if (spouseActive && spouseAge !== null) pushCap(spouseAccounts.fourOhOneK, spouseAge, rmdAgeS, enabledS.fourOhOneK);
    years.push({
      year,
      age,
      spouseAge,
      filing,
      spouseActive,
      retired,
      ss,
      agi,
      baseTax,
      rmdRateP: enabledP.fourOhOneK && age >= rmdAgeP ? 1 / rmdFactor(age) : 0,
      rmdRateS:
        spouseActive && enabledS.fourOhOneK && spouseAge !== null && spouseAge >= rmdAgeS ? 1 / rmdFactor(spouseAge) : 0,
      canConvertP: allowed(accounts.fourOhOneK, age, rmdAgeP, enabledP.fourOhOneK),
      canConvertS: spouseActive && spouseAge !== null && allowed(spouseAccounts.fourOhOneK, spouseAge, rmdAgeS, enabledS.fourOhOneK),
      initialP,
      initialS,
      contribP: contribs(accounts, enabledP, age),
      contribS: spouseActive && spouseAge !== null ? contribs(spouseAccounts, enabledS, spouseAge) : { ...zero },
      rateP: rates(accounts, enabledP),
      rateS: spouseActive ? rates(spouseAccounts, enabledS) : { ...zero },
      enabledP,
      enabledS,
      withdrawP: {
        rothIra: withdrawalMode(accounts.rothIra, age),
        hsa: withdrawalMode(accounts.hsa, age),
        fourOhOneK: withdrawalMode(accounts.fourOhOneK, age),
        taxable: withdrawalMode(accounts.taxable, age),
      },
      withdrawS:
        spouseActive && spouseAge !== null
          ? {
              rothIra: withdrawalMode(spouseAccounts.rothIra, spouseAge),
              hsa: withdrawalMode(spouseAccounts.hsa, spouseAge),
              fourOhOneK: withdrawalMode(spouseAccounts.fourOhOneK, spouseAge),
              taxable: { mode: "none", amount: 0 },
            }
          : {
              rothIra: { mode: "none", amount: 0 },
              hsa: { mode: "none", amount: 0 },
              fourOhOneK: { mode: "none", amount: 0 },
              taxable: { mode: "none", amount: 0 },
            },
      senior,
      seniorLow: seniorRow(senior === "both").phaseoutStart,
      seniorHigh: seniorRow(senior === "both").phaseoutEnd,
      seniorFull: seniorRow(senior === "both").amount,
      seniorSlope: seniorRow(senior === "both").amount / (seniorRow(senior === "both").phaseoutEnd - seniorRow(senior === "both").phaseoutStart),
      fixedDeduction: (filing === "married" ? STANDARD_DEDUCTION.married : STANDARD_DEDUCTION.single) + additionalStdDeduction(filing, age, spouseAge),
      federalLines: federalSupportLines(filing),
      state: inputs.state === "GA" ? "ga" : stateSupportLines(inputs.state, filing).length > 0 ? "brackets" : "none",
      stateCode: inputs.state,
      gaRate: GEORGIA.rate,
      gaDeduction: georgiaDeduction(filing),
      gaCapP: georgiaRetirementCap(age),
      gaCapS: filing === "married" && spouseAge !== null ? georgiaRetirementCap(spouseAge) : 0,
      stateLines: stateSupportLines(inputs.state, filing),
      enrollees: medicareEnrollees(age, spouseAge, filing),
      irmaaUpper: upper,
      irmaaFeeByTier: feeByTier,
      irmaaCashoutFeeByTier: IRMAA_TIERS.map((tier) => (tier.partB + tier.partD) * 12 * irmaaCashoutEnrollees(inputs, age, spouseAge).enrollees),
      magiCap: finiteCaps.length > 0 ? Math.min(...finiteCaps) : null,
      payTaxP: accounts.fourOhOneK.payConversionTaxFromTaxable,
      payTaxS: spouseActive && spouseAccounts.fourOhOneK.payConversionTaxFromTaxable,
    });
  }
  return years;
}
