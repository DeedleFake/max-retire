import loadHighs from "highs";
import { MARRIED_BRACKETS, SINGLE_BRACKETS } from "./tax-year";
import { STATE_BRACKETS } from "./tax-tables";
import {
  type ConversionPlan,
  type FilingStatus,
  type PlannerInputs,
  type ProjectionRow,
  federalTax,
  optimizerCensus,
  project,
  simulatePlan,
  spendableWeight,
  stateTax,
  taxableSocialSecurity,
  type OptimizerYear,
} from "./engine";

type Sense = "=" | "<=" | ">=";
type AccountKey = "401" | "roth" | "hsa" | "tax";

class Expr {
  readonly coef = new Map<string, number>();
  c = 0;

  v(name: string, k = 1): this {
    if (k !== 0) this.coef.set(name, (this.coef.get(name) ?? 0) + k);
    return this;
  }

  k(n: number): this {
    this.c += n;
    return this;
  }

  clone(): Expr {
    const next = new Expr();
    for (const [name, coef] of this.coef) next.coef.set(name, coef);
    next.c = this.c;
    return next;
  }
}

function vr(name: string, k = 1): Expr {
  return new Expr().v(name, k);
}

function con(n: number): Expr {
  return new Expr().k(n);
}

function add(a: Expr, b: Expr): Expr {
  const next = a.clone();
  for (const [name, coef] of b.coef) next.v(name, coef);
  return next.k(b.c);
}

function sub(a: Expr, b: Expr): Expr {
  const next = a.clone();
  for (const [name, coef] of b.coef) next.v(name, -coef);
  return next.k(-b.c);
}

function scale(value: Expr, factor: number): Expr {
  const next = value.clone();
  for (const [name, coef] of [...next.coef]) next.coef.set(name, coef * factor);
  next.c *= factor;
  return next;
}

type Piece = { lo: number; hi: number; slope: number; intercept: number };
type TaxPiece = Piece & { tier: number };

/** Linear pieces of taxable Social Security versus other income. */
export function socialSecurityPieces(benefit: number, filing: FilingStatus): Piece[] {
  if (benefit <= 0) return [{ lo: 0, hi: 1e12, slope: 0, intercept: 0 }];
  const first = filing === "married" ? 32_000 : 25_000;
  const second = filing === "married" ? 44_000 : 34_000;
  const halfCap = filing === "married" ? 6_000 : 4_500;
  const knots = new Set<number>([0, 1e12]);
  const mark = (provisional: number) => {
    const other = provisional - benefit / 2;
    if (other > 0 && other < 1e12) knots.add(other);
  };
  mark(first);
  mark(second);
  mark(first + benefit);
  const base = Math.min(0.5 * benefit, halfCap);
  mark(second + Math.max(0, 0.85 * benefit - base) / 0.85);
  const points = [...knots].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    const left = taxableSocialSecurity(benefit, lo, filing);
    const mid = Math.min(hi - 1e-4, lo + Math.min(1_000, (hi - lo) / 2));
    const slope = mid <= lo ? 0 : (taxableSocialSecurity(benefit, mid, filing) - left) / (mid - lo);
    pieces.push({ lo, hi, slope, intercept: left - slope * lo });
  }
  return pieces;
}

function bonusAt(year: OptimizerYear, other: number): number {
  if (year.senior === "none") return 0;
  if (other < year.seniorLow) return year.seniorFull;
  if (other >= year.seniorHigh) return 0;
  return Math.max(0, year.seniorFull - (other - year.seniorLow) * year.seniorSlope);
}

function magiAt(year: OptimizerYear, ordinary: number): number {
  const other = year.agi + ordinary;
  return other + taxableSocialSecurity(year.ss, other, year.filing);
}

/** Federal tax, plus state tax where it depends only on the ordinary-income total. */
function incomeTaxAt(year: OptimizerYear, ordinary: number): number {
  const other = year.agi + ordinary;
  const ssTax = taxableSocialSecurity(year.ss, other, year.filing);
  const gross = other + ssTax;
  const federal = federalTax(gross, year.filing, year.age, year.spouseAge, other);
  if (year.state !== "brackets") return federal;
  return federal + stateTax(gross, year.stateCode, year.filing, year.age, year.spouseAge, ssTax);
}

function tierAt(year: OptimizerYear, ordinary: number): number {
  const magi = magiAt(year, ordinary);
  // Stay a dollar under each legal cliff. The projection rounds conversions to the
  // cent, and a plan sitting exactly on $218,000 was scored as the next tier.
  for (let i = 0; i < year.irmaaUpper.length; i++) if (magi <= year.irmaaUpper[i] - 1 + 1e-6) return i;
  return 5;
}

/** Annual IRMAA surcharge two years later, as a step function of this year's ordinary income. */
function irmaaFeePieces(year: OptimizerYear, maxOrdinary: number, fees: number[]): Piece[] {
  const cap = Math.max(0, maxOrdinary);
  const knots = new Set<number>([0, cap]);
  for (const upper of year.irmaaUpper) {
    if (!Number.isFinite(upper)) continue;
    const hit = crossing(0, cap, (value) => magiAt(year, value), upper);
    if (hit !== null) knots.add(hit);
  }
  const points = [...knots].sort((a, b) => a - b);
  const tierOf = (ordinary: number) => {
    const magi = magiAt(year, ordinary);
    for (let index = 0; index < year.irmaaUpper.length; index++) if (magi <= year.irmaaUpper[index]) return index;
    return year.irmaaUpper.length;
  };
  // The legal tier includes its top dollar. The next piece starts a dollar later so
  // a balance on the line cannot collect the cheap tier and the expensive tier at once.
  // A one-cent gap was small enough for the solver to stand on both.
  const pieces: Piece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const lo = i === 0 ? points[i] : Math.min(points[i] + 1, points[i + 1]);
    const hi = points[i + 1];
    if (hi <= lo + 1e-6) continue;
    pieces.push({ lo, hi, slope: 0, intercept: fees[tierOf((lo + hi) / 2)] ?? 0 });
  }
  if (pieces.length === 0) pieces.push({ lo: 0, hi: cap, slope: 0, intercept: fees[tierOf(0)] ?? 0 });
  return pieces;
}

function crossing(lo: number, hi: number, value: (x: number) => number, target: number): number | null {
  const left = value(lo);
  const right = value(hi);
  if (!Number.isFinite(target) || (left - target) * (right - target) > 0) return null;
  if (Math.abs(left - right) < 1e-8) return null;
  let a = lo;
  let b = hi;
  for (let n = 0; n < 48; n++) {
    const mid = (a + b) / 2;
    if (value(mid) < target) a = mid;
    else b = mid;
  }
  if (b <= lo + 1e-4 || b >= hi - 1e-4) return null;
  return b;
}

/** Largest ordinary income whose MAGI stays at or under `magiTarget`. Null when even the top is under it. */
function ordinaryRoom(year: OptimizerYear, magiTarget: number, ordinaryHi: number): number | null {
  if (!(ordinaryHi > 0) || !Number.isFinite(magiTarget)) return null;
  if (magiAt(year, 0) >= magiTarget) return 0;
  if (magiAt(year, ordinaryHi) <= magiTarget) return null;
  const hit = crossing(0, ordinaryHi, (value) => magiAt(year, value), magiTarget);
  return hit === null ? 0 : Math.max(0, hit);
}

/** Exact straight pieces of income tax versus ordinary income, each inside one IRMAA tier. */
function incomeTaxPieces(year: OptimizerYear, maxOrdinary: number): TaxPiece[] {
  const cap = Math.max(0, maxOrdinary);
  const knots = new Set<number>([0, cap]);
  const add = (x: number) => {
    if (x > 1e-4 && x < cap - 1e-4) knots.add(x);
  };
  for (const piece of socialSecurityPieces(year.ss, year.filing)) add(piece.lo - year.agi);
  if (year.senior !== "none") {
    add(year.seniorLow - year.agi);
    add(year.seniorHigh - year.agi);
  }
  const taxableIncome = (x: number) => Math.max(0, magiAt(year, x) - year.fixedDeduction - bonusAt(year, year.agi + x));
  const base = [...knots].sort((a, b) => a - b);
  const brackets = year.filing === "married" ? MARRIED_BRACKETS : SINGLE_BRACKETS;
  for (let i = 0; i < base.length - 1; i++) {
    for (const bracket of brackets) {
      if (!Number.isFinite(bracket.max)) continue;
      const hit = crossing(base[i], base[i + 1], taxableIncome, bracket.max);
      if (hit !== null) knots.add(hit);
    }
    if (year.state === "brackets") {
      const schedule = STATE_BRACKETS[year.stateCode];
      const table = (year.filing === "married" ? schedule?.married : schedule?.single) ?? [];
      for (const row of table) {
        const hit = crossing(base[i], base[i + 1], (x) => magiAt(year, x), row.min);
        if (hit !== null) knots.add(hit);
      }
    }
    for (const upper of year.irmaaUpper) {
      const hit = crossing(base[i], base[i + 1], (x) => magiAt(year, x), upper - 1);
      if (hit !== null) knots.add(hit);
    }
  }
  const points = [...knots].sort((a, b) => a - b);
  const refined = [points[0]];
  const refine = (lo: number, hi: number, depth: number) => {
    const y0 = incomeTaxAt(year, lo);
    const y1 = incomeTaxAt(year, hi);
    const mid = (lo + hi) / 2;
    const chord = y0 + ((y1 - y0) * (mid - lo)) / (hi - lo);
    if (depth > 10 || hi - lo < 1 || Math.abs(incomeTaxAt(year, mid) - chord) <= 0.25) {
      refined.push(hi);
      return;
    }
    refine(lo, mid, depth + 1);
    refine(mid, hi, depth + 1);
  };
  for (let i = 0; i < points.length - 1; i++) if (points[i + 1] > points[i] + 1e-6) refine(points[i], points[i + 1], 0);
  const unique = [...new Set(refined.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
  const raw: TaxPiece[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const lo = unique[i];
    const hi = unique[i + 1];
    if (hi <= lo + 1e-6) continue;
    const y0 = incomeTaxAt(year, lo);
    const y1 = incomeTaxAt(year, hi);
    const slope = (y1 - y0) / (hi - lo);
    raw.push({ lo, hi, slope, intercept: y0 - slope * lo, tier: tierAt(year, (lo + hi) / 2) });
  }
  const merged: TaxPiece[] = [];
  for (const piece of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.tier === piece.tier &&
      Math.abs(prev.slope - piece.slope) < 1e-5 &&
      Math.abs(incomeTaxAt(year, piece.lo) - (prev.intercept + prev.slope * piece.lo)) < 0.2
    ) {
      prev.hi = piece.hi;
      continue;
    }
    merged.push({ ...piece });
  }
  if (merged.length === 0) merged.push({ lo: 0, hi: Math.max(cap, 0), slope: 0, intercept: incomeTaxAt(year, 0), tier: tierAt(year, 0) });
  return merged;
}

class Model {
  private readonly rows: { expr: Expr; sense: Sense }[] = [];
  private readonly objective = new Expr();
  private readonly bounds = new Map<string, { lo: number; hi: number }>();
  private readonly integers = new Set<string>();
  readonly big: number;

  constructor(big: number) {
    this.big = big;
  }

  eq(value: Expr) {
    this.rows.push({ expr: value, sense: "=" });
  }

  le(value: Expr) {
    this.rows.push({ expr: value, sense: "<=" });
  }

  ge(value: Expr) {
    this.rows.push({ expr: value, sense: ">=" });
  }

  gain(value: Expr) {
    for (const [name, coef] of value.coef) this.objective.v(name, coef);
    this.objective.k(value.c);
  }

  bound(name: string, lo: number, hi: number) {
    this.bounds.set(name, { lo, hi });
  }

  integer(name: string, lo = 0, hi = 1) {
    this.integers.add(name);
    this.bound(name, lo, hi);
  }

  /** x = min(a, b). Upper bounds are the big-M coefficients and must cover a and b. */
  minOf(name: string, a: Expr, b: Expr, ubA: number, ubB: number) {
    const z = `${name}z`;
    const capA = Math.max(ubA, 0);
    const capB = Math.max(ubB, 0);
    this.integer(z);
    this.bound(name, 0, Math.max(Math.min(capA, capB), 0));
    this.le(sub(vr(name), a));
    this.le(sub(vr(name), b));
    this.ge(sub(vr(name), a).v(z, -capA).k(capA));
    this.ge(sub(vr(name), b).v(z, capB));
    this.le(sub(a, b).v(z, capA).k(-capA));
    this.le(sub(b, a).v(z, -capB));
  }

  /** result equals the linear piece of input that contains it, on [0, domainHi]. */
  piecewise(prefix: string, input: Expr, pieces: Piece[], result: string, domainHi: number) {
    const hiLimit = Math.max(domainHi, 0);
    const usable: Piece[] = [];
    for (const piece of pieces) {
      const hi = Math.min(piece.hi, hiLimit);
      if (hi < piece.lo - 1e-6) continue;
      if (hi < piece.lo + 1e-8 && hiLimit > piece.lo + 1e-6) continue;
      usable.push({ ...piece, hi: Math.max(hi, piece.lo) });
    }
    if (usable.length === 0) {
      const last = pieces[pieces.length - 1] ?? { lo: 0, hi: 0, slope: 0, intercept: 0 };
      usable.push({ ...last, lo: hiLimit, hi: hiLimit });
    }
    const peak = usable.reduce((max, piece) => Math.max(max, Math.abs(piece.intercept) + Math.abs(piece.slope) * piece.hi), 0);
    this.bound(result, -Math.max(peak, 1), Math.max(peak, 1));
    const choice = new Expr();
    const assigned = new Expr();
    const value = new Expr();
    usable.forEach((piece, index) => {
      const z = `${prefix}z${index}`;
      const part = `${prefix}y${index}`;
      this.integer(z);
      this.bound(part, 0, piece.hi);
      this.le(sub(vr(part), vr(z, piece.hi)));
      // part >= lo when z is 1, and part >= 0 when z is 0. Multiplying lo by z let a
      // rounding error of 1e-7 pull the next tier back onto the boundary dollar.
      this.ge(sub(vr(part), vr(z, piece.hi)).k(piece.hi - piece.lo));
      choice.v(z, 1);
      assigned.v(part, 1);
      value.v(z, piece.intercept);
      value.v(part, piece.slope);
    });
    this.eq(sub(choice, con(1)));
    this.eq(sub(assigned, input));
    this.eq(sub(vr(result), value));
  }

  lp(): string {
    const objective = formatExpr(this.objective);
    const lines = ["Maximize", ` obj: ${objective.body}${Math.abs(objective.constant) < 1e-9 ? "" : ` ${signed(objective.constant)}`}`, "Subject To"];
    this.rows.forEach((row, index) => {
      const formatted = formatExpr(row.expr);
      lines.push(` r${index}: ${formatted.body} ${row.sense} ${trim(-formatted.constant)}`);
    });
    lines.push("Bounds");
    const names = new Set<string>(this.bounds.keys());
    for (const row of this.rows) for (const name of row.expr.coef.keys()) names.add(name);
    for (const name of this.objective.coef.keys()) names.add(name);
    for (const name of names) {
      const bound = this.bounds.get(name) ?? { lo: 0, hi: this.big };
      lines.push(` ${trim(bound.lo)} <= ${name} <= ${trim(bound.hi)}`);
    }
    if (this.integers.size > 0) {
      lines.push("General");
      for (const name of this.integers) lines.push(` ${name}`);
    }
    lines.push("End");
    return lines.join("\n");
  }
}

function signed(n: number): string {
  return n < 0 ? `- ${trim(-n)}` : `+ ${trim(n)}`;
}

function trim(n: number): string {
  if (!Number.isFinite(n) || Object.is(n, -0)) return "0";
  return String(Number(n.toPrecision(12)));
}

function formatExpr(value: Expr): { body: string; constant: number } {
  const parts: string[] = [];
  for (const [name, coef] of value.coef) {
    if (Math.abs(coef) < 1e-9) continue;
    const text = Math.abs(Math.abs(coef) - 1) < 1e-9 ? name : `${trim(Math.abs(coef))} ${name}`;
    parts.push(coef < 0 ? `- ${text}` : parts.length === 0 ? text : `+ ${text}`);
  }
  return { body: parts.length > 0 ? parts.join(" ") : "0", constant: value.c };
}

let solverPromise: ReturnType<typeof loadHighs> | null = null;

function cents(value: number): number {
  return Math.floor(Math.max(0, value) * 100 + 1e-6) / 100;
}

function solver() {
  if (!solverPromise) {
    const browser = typeof window !== "undefined" || "DedicatedWorkerGlobalScope" in globalThis;
    solverPromise = browser ? loadHighs({ locateFile: () => "/highs.wasm" }) : loadHighs();
  }
  return solverPromise;
}

function moneyBound(years: OptimizerYear[]): number {
  const rates = years.flatMap((year) => [
    year.rateP.fourOhOneK,
    year.rateP.rothIra,
    year.rateP.hsa,
    year.rateP.taxable,
    year.rateS.fourOhOneK,
    year.rateS.rothIra,
    year.rateS.hsa,
  ]);
  const growth = 1 + Math.max(0, ...rates) / 100;
  let balance =
    years[0].initialP.fourOhOneK +
    years[0].initialS.fourOhOneK +
    years[0].initialP.taxable +
    years[0].initialP.rothIra +
    years[0].initialS.rothIra +
    years[0].initialP.hsa +
    years[0].initialS.hsa;
  for (const year of years) {
    balance +=
      year.contribP.fourOhOneK +
      year.contribS.fourOhOneK +
      year.contribP.taxable +
      year.contribP.rothIra +
      year.contribS.rothIra +
      year.contribP.hsa +
      year.contribS.hsa +
      year.agi +
      year.ss;
    balance *= growth;
  }
  return balance + 50_000;
}

type YearLimits = {
  magiHi: number;
  taxHi: number;
  poolHi: number;
  convHiP: number;
  convHiS: number;
  ordinaryHi: number;
  start401P: number;
  start401S: number;
};

/** Per-year maxima. Extra withdrawals only shrink balances, so the largest balances pay no extra withdrawal. */
function yearLimits(years: OptimizerYear[]): YearLimits[] {
  let p401 = years[0]?.initialP.fourOhOneK ?? 0;
  let s401 = years[0]?.initialS.fourOhOneK ?? 0;
  let taxable = years[0]?.initialP.taxable ?? 0;
  return years.map((year) => {
    const startP = year.enabledP.fourOhOneK ? p401 : 0;
    const startS = year.spouseActive && year.enabledS.fourOhOneK ? s401 : 0;
    const ordinaryHi = (year.canConvertP || year.rmdRateP > 0 ? startP : 0) + (year.canConvertS || year.rmdRateS > 0 ? startS : 0);
    const ssHi = Math.min(year.ss, 0.85 * year.ss);
    const magiHi = year.agi + ssHi + ordinaryHi;
    const phaseout = year.agi + ordinaryHi;
    const fedHi = federalTax(Math.max(magiHi, year.agi), year.filing, year.age, year.spouseAge, phaseout);
    let stateHi = 0;
    if (year.state === "ga") stateHi = year.gaRate * Math.max(0, magiHi);
    else if (year.state === "brackets") {
      const slope = year.stateLines.reduce((max, line) => Math.max(max, line.slope), 0);
      stateHi = slope * Math.max(0, magiHi);
    }
    const rmdP = year.rmdRateP * startP;
    const rmdS = year.rmdRateS * startS;
    const deposit = year.enabledP.taxable ? rmdP + rmdS : 0;
    const poolHi = (year.enabledP.taxable ? taxable : 0) + year.contribP.taxable + deposit;
    if (year.enabledP.fourOhOneK) {
      p401 = Math.max(0, startP + year.contribP.fourOhOneK - rmdP) * (1 + year.rateP.fourOhOneK / 100);
    }
    if (year.spouseActive && year.enabledS.fourOhOneK) {
      s401 = Math.max(0, startS + year.contribS.fourOhOneK - rmdS) * (1 + year.rateS.fourOhOneK / 100);
    } else if (!year.spouseActive) {
      s401 = years[0]?.initialS.fourOhOneK ?? 0;
    }
    if (year.enabledP.taxable) taxable = Math.max(0, poolHi) * (1 + year.rateP.taxable / 100);
    return {
      magiHi: magiHi + 1,
      taxHi: Math.max(1, fedHi + stateHi + 1),
      poolHi: Math.max(0, poolHi),
      convHiP: year.canConvertP ? startP : 0,
      convHiS: year.canConvertS ? startS : 0,
      ordinaryHi,
      start401P: startP,
      start401S: startS,
    };
  });
}

function startOf(name: string, index: number, initial: number, live: boolean[]): Expr {
  if (!live[index]) return con(initial);
  for (let prev = index - 1; prev >= 0; prev--) {
    if (live[prev]) return vr(`${name}_${prev}`);
  }
  return con(initial);
}

function accountKey(key: AccountKey): "fourOhOneK" | "rothIra" | "hsa" | "taxable" {
  if (key === "401") return "fourOhOneK";
  if (key === "roth") return "rothIra";
  if (key === "hsa") return "hsa";
  return "taxable";
}

const SOLVER_STATUS: Record<number, string> = {
  7: "Optimal",
  8: "Infeasible",
  9: "Unbounded or infeasible",
  10: "Unbounded",
  13: "Time limit",
  14: "Iteration limit",
};

function solverStatus(status: number): string {
  return SOLVER_STATUS[status] ?? `status ${status}`;
}

type PlanFailure = { reason: string; detail: Record<string, unknown> };

function rejectPlan(failures: PlanFailure[], reason: string, detail: Record<string, unknown>): null {
  failures.push({ reason, detail });
  return null;
}

export type ExactPlan = { rows: ProjectionRow[]; score: number; proven: boolean };

/**
 * Conversions that maximize usable money.
 * A switched-off period does not convert. A switched-on period stops at that
 * bracket and the IRMAA cap. Conversion tax comes from the taxable account only
 * when that switch is on; otherwise it is withheld from the Roth deposit.
 */
export async function solveOptimalPlan(
  inputs: PlannerInputs,
  onProgress?: (rows: ProjectionRow[]) => void,
): Promise<ExactPlan | null> {
  const failures: PlanFailure[] = [];
  const solved = await solveModel(inputs, onProgress, failures);
  if (solved) return solved;
  for (const failure of failures) console.warn(`[retirement] ${failure.reason}`, failure.detail);
  return null;
}

async function solveModel(
  inputs: PlannerInputs,
  onProgress: ((rows: ProjectionRow[]) => void) | undefined,
  failures: PlanFailure[],
): Promise<ExactPlan | null> {
  const years = optimizerCensus(inputs);
  if (years.length === 0) return rejectPlan(failures, "maximization had no years to solve", {});
  const limits = yearLimits(years);
  const big = moneyBound(years);
  const model = new Model(big);
  const live = (who: "p" | "s", key: AccountKey) => years.map((year) => (who === "p" ? year.enabledP : year.enabledS)[accountKey(key)]);
  const tiersByYear: number[][] = [];

  const forceMax = (name: string, diff: Expr, ceiling: number) => {
    const z = `${name}z`;
    const span = Math.max(ceiling, 1);
    model.integer(z);
    model.bound(name, 0, span);
    model.ge(sub(vr(name), diff));
    model.le(sub(vr(name), diff).v(z, span).k(-span));
    model.le(sub(vr(name), vr(z, span)));
    return vr(name);
  };

  const addGeorgia = (prefix: string, year: OptimizerYear, limit: YearLimits, primaryRet: Expr, spouseRet: Expr, ordinaryExpr: Expr) => {
    const exP = `${prefix}ExP`;
    const exS = `${prefix}ExS`;
    if (year.gaCapP > 0) {
      const capped = add(primaryRet, con(Math.max(0, year.agi)));
      const ub = Math.max(limit.ordinaryHi + Math.max(year.agi, 0), year.gaCapP, 1);
      model.minOf(exP, capped, con(year.gaCapP), ub, year.gaCapP);
    } else model.bound(exP, 0, 0);
    if (year.gaCapS > 0) {
      model.minOf(exS, spouseRet, con(year.gaCapS), Math.max(limit.ordinaryHi, year.gaCapS, 1), year.gaCapS);
    } else model.bound(exS, 0, 0);
    const raw = sub(sub(sub(add(ordinaryExpr, con(year.agi)), vr(exP)), vr(exS)), con(year.gaDeduction));
    const span = Math.max(limit.magiHi + year.gaDeduction, 1);
    const ga = `${prefix}Ga`;
    const z = `${prefix}Gz`;
    model.integer(z);
    model.bound(ga, 0, span);
    model.ge(sub(vr(ga), raw));
    model.le(sub(vr(ga), raw).v(z, span).k(-span));
    model.le(sub(vr(ga), vr(z, span)));
    model.bound(`${prefix}St`, 0, limit.taxHi);
    model.eq(sub(vr(`${prefix}St`), scale(vr(ga), year.gaRate)));
  };

  const incrementalTax = (
    prefix: string,
    year: OptimizerYear,
    limit: YearLimits,
    ordinaryExpr: Expr,
    primaryRet: Expr,
    spouseRet: Expr,
  ) => {
    const domain = Math.max(limit.ordinaryHi, 1);
    model.piecewise(prefix, ordinaryExpr, incomeTaxPieces(year, domain), `${prefix}F`, domain);
    const stateExpr = year.state === "ga" ? vr(`${prefix}St`) : con(0);
    if (year.state === "ga") addGeorgia(prefix, year, limit, primaryRet, spouseRet, ordinaryExpr);
    return forceMax(`${prefix}Inc`, sub(add(vr(`${prefix}F`), stateExpr), con(year.baseTax)), Math.max(limit.taxHi * 2, 1));
  };

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const limit = limits[i];
    model.bound(`Cp_${i}`, 0, year.canConvertP ? limit.convHiP : 0);
    model.bound(`Cs_${i}`, 0, year.canConvertS ? limit.convHiS : 0);
    model.bound(`Rp_${i}`, 0, year.rmdRateP > 0 ? limit.start401P : 0);
    model.bound(`Rs_${i}`, 0, year.rmdRateS > 0 ? limit.start401S : 0);
    for (const who of ["p", "s"] as const) {
      if (who === "s" && !year.spouseActive) continue;
      for (const key of ["401", "roth", "hsa", "tax"] as const) {
        if (live(who, key)[i]) model.bound(`E${who}${key}_${i}`, 0, big);
      }
    }
  }

  let baseTaxes = 0;
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const limit = limits[i];
    const begin = (who: "p" | "s", key: AccountKey) => {
      const initial = (who === "p" ? year.initialP : year.initialS)[accountKey(key)];
      return startOf(`E${who}${key}`, i, initial, live(who, key));
    };
    const growth = (who: "p" | "s", key: AccountKey) => 1 + (who === "p" ? year.rateP : year.rateS)[accountKey(key)] / 100;
    const contrib = (who: "p" | "s", key: AccountKey) => (who === "p" ? year.contribP : year.contribS)[accountKey(key)];
    const endOf = (who: "p" | "s", key: AccountKey, after: Expr) => {
      if (!live(who, key)[i]) return;
      model.eq(sub(vr(`E${who}${key}_${i}`), scale(after, growth(who, key))));
      if (i === years.length - 1) model.gain(vr(`E${who}${key}_${i}`));
    };

    const s401p = begin("p", "401");
    if (year.rmdRateP > 0) model.eq(sub(vr(`Rp_${i}`), scale(s401p, year.rmdRateP)));
    if (year.canConvertP) model.le(sub(add(vr(`Cp_${i}`), vr(`Rp_${i}`)), s401p));
    if (year.spouseActive) {
      const s401s = begin("s", "401");
      if (year.rmdRateS > 0) model.eq(sub(vr(`Rs_${i}`), scale(s401s, year.rmdRateS)));
      if (year.canConvertS) model.le(sub(add(vr(`Cs_${i}`), vr(`Rs_${i}`)), s401s));
    }

    const ordinary = vr(`Rp_${i}`).v(`Rs_${i}`).v(`Cp_${i}`).v(`Cs_${i}`);
    if (year.magiCap !== null && (year.canConvertP || year.canConvertS)) {
      const room = ordinaryRoom(year, year.magiCap - 1, Math.max(0, limit.ordinaryHi));
      if (room !== null) {
        const hi = Math.max(limit.ordinaryHi, 1);
        const convHi = Math.max(limit.convHiP + limit.convHiS, 1);
        model.integer(`CapZ_${i}`);
        model.le(sub(add(vr(`Cp_${i}`), vr(`Cs_${i}`)), vr(`CapZ_${i}`, convHi)));
        model.le(sub(ordinary, con(room + hi)).v(`CapZ_${i}`, hi));
      }
    }
    const ordinaryHi = Math.max(0, limit.ordinaryHi);
    const pieces = incomeTaxPieces(year, ordinaryHi);
    tiersByYear[i] = pieces.map((piece) => piece.tier);
    model.piecewise(`tx${i}`, ordinary, pieces, `Tax_${i}`, ordinaryHi);

    const income = add(ordinary, con(year.agi));
    model.bound(`St_${i}`, 0, limit.taxHi);
    if (year.state === "ga") {
      model.bound(`ExP_${i}`, 0, Math.max(0, year.gaCapP));
      model.bound(`ExS_${i}`, 0, Math.max(0, year.gaCapS));
      model.le(sub(vr(`ExP_${i}`), add(add(vr(`Rp_${i}`), vr(`Cp_${i}`)), con(year.agi))));
      model.le(sub(vr(`ExS_${i}`), add(vr(`Rs_${i}`), vr(`Cs_${i}`))));
      model.bound(`Ga_${i}`, 0, Math.max(0, limit.magiHi));
      model.ge(sub(vr(`Ga_${i}`), sub(sub(sub(income, vr(`ExP_${i}`)), vr(`ExS_${i}`)), con(year.gaDeduction))));
      model.ge(sub(vr(`St_${i}`), scale(vr(`Ga_${i}`), year.gaRate)));
    } else model.eq(vr(`St_${i}`));

    model.bound(`Dist_${i}`, 0, limit.taxHi);
    model.ge(sub(vr(`Dist_${i}`), add(vr(`Tax_${i}`), vr(`St_${i}`))).k(year.baseTax));
    const pool = year.enabledP.taxable ? add(add(begin("p", "tax"), con(contrib("p", "tax"))), add(vr(`Rp_${i}`), vr(`Rs_${i}`))) : con(0);
    const poolCap = year.enabledP.taxable ? Math.max(limit.poolHi, 1) : 0;
    const withholdP = year.canConvertP && !year.payTaxP;
    const withholdS = year.canConvertS && !year.payTaxS;
    const coverP = year.canConvertP && year.payTaxP;
    const coverS = year.canConvertS && year.payTaxS;
    let due = vr(`Dist_${i}`);
    let pConvTax = con(0);
    let sConvTax = con(0);
    if (withholdP || withholdS) {
      const rmdOrd = add(vr(`Rp_${i}`), vr(`Rs_${i}`));
      const dr = incrementalTax(`txR${i}`, year, limit, rmdOrd, vr(`Rp_${i}`), vr(`Rs_${i}`));
      if (year.canConvertP && year.canConvertS) {
        const through = add(rmdOrd, vr(`Cp_${i}`));
        const dp = incrementalTax(`txP${i}`, year, limit, through, add(vr(`Rp_${i}`), vr(`Cp_${i}`)), vr(`Rs_${i}`));
        pConvTax = forceMax(`Pc${i}`, sub(dp, dr), limit.taxHi * 2);
        sConvTax = forceMax(`Sc${i}`, sub(vr(`Dist_${i}`), dp), limit.taxHi * 2);
      } else if (year.canConvertP) {
        pConvTax = forceMax(`Pc${i}`, sub(vr(`Dist_${i}`), dr), limit.taxHi * 2);
      } else {
        sConvTax = forceMax(`Sc${i}`, sub(vr(`Dist_${i}`), dr), limit.taxHi * 2);
      }
      due = dr;
      if (coverP) due = add(due, pConvTax);
      if (coverS) due = add(due, sConvTax);
    }
    const dueUb = withholdP || withholdS ? limit.taxHi * 4 : limit.taxHi;
    if (year.enabledP.taxable) model.minOf(`Pd_${i}`, due, pool, Math.max(dueUb, 1), Math.max(poolCap, 1));
    else model.bound(`Pd_${i}`, 0, 0);
    const requirePool = (flag: string, conv: string, convHi: number) => {
      model.integer(flag);
      model.le(sub(vr(conv), vr(flag, Math.max(convHi, 1))));
      model.ge(sub(pool, due).k(Math.max(dueUb, 1)).v(flag, -Math.max(dueUb, 1)));
    };
    if (coverP) requirePool(`CovP_${i}`, `Cp_${i}`, limit.convHiP);
    if (coverS) requirePool(`CovS_${i}`, `Cs_${i}`, limit.convHiS);
    if (withholdP && year.enabledP.rothIra) model.minOf(`Wp_${i}`, pConvTax, vr(`Cp_${i}`), limit.taxHi, Math.max(limit.convHiP, 1));
    else model.bound(`Wp_${i}`, 0, 0);
    if (withholdS && year.enabledS.rothIra) model.minOf(`Ws_${i}`, sConvTax, vr(`Cs_${i}`), limit.taxHi, Math.max(limit.convHiS, 1));
    else model.bound(`Ws_${i}`, 0, 0);
    model.bound(`Un_${i}`, 0, limit.taxHi);
    model.bound(`Ov_${i}`, 0, 100);
    model.eq(sub(add(add(add(vr(`Pd_${i}`), vr(`Wp_${i}`)), vr(`Ws_${i}`)), vr(`Un_${i}`)), add(vr(`Dist_${i}`), vr(`Ov_${i}`))));
    model.gain(vr(`Un_${i}`, -1));
    model.gain(vr(`Ov_${i}`, -1));
    baseTaxes += year.baseTax;

    const kept = (
      name: string,
      withdrawal: { mode: "none" | "fixed" | "pct"; amount: number },
      poolExpr: Expr,
      room: Expr,
      ubPool: number,
      ubRoom: number,
    ) => {
      if (withdrawal.mode === "none") return con(0);
      const want = withdrawal.mode === "fixed" ? con(withdrawal.amount) : scale(poolExpr, withdrawal.amount);
      const ubWant = withdrawal.mode === "fixed" ? withdrawal.amount : withdrawal.amount * ubPool;
      model.minOf(name, want, room, Math.max(ubWant, 0), Math.max(ubRoom, 0));
      model.gain(vr(name));
      return vr(name);
    };

    const pool401p = add(s401p, con(contrib("p", "401")));
    const mand401p = add(vr(`Rp_${i}`), vr(`Cp_${i}`));
    const ub401p = limit.start401P + contrib("p", "401");
    const k401p = kept(`K401p_${i}`, year.withdrawP.fourOhOneK, pool401p, sub(pool401p, mand401p), ub401p, ub401p);
    endOf("p", "401", sub(sub(pool401p, mand401p), k401p));

    const rothPoolP = add(begin("p", "roth"), con(contrib("p", "roth")));
    const rothInP = year.enabledP.rothIra ? add(rothPoolP, sub(vr(`Cp_${i}`), vr(`Wp_${i}`))) : rothPoolP;
    const kRothP = kept(`Krothp_${i}`, year.withdrawP.rothIra, rothInP, rothInP, big, big);
    endOf("p", "roth", sub(rothInP, kRothP));

    const hsaPoolP = add(begin("p", "hsa"), con(contrib("p", "hsa")));
    const kHsaP = kept(`Khsap_${i}`, year.withdrawP.hsa, hsaPoolP, hsaPoolP, big, big);
    endOf("p", "hsa", sub(hsaPoolP, kHsaP));

    const kTax = kept(`Ktax_${i}`, year.withdrawP.taxable, pool, sub(pool, vr(`Pd_${i}`)), poolCap, poolCap);
    endOf("p", "tax", sub(sub(pool, vr(`Pd_${i}`)), kTax));
    if (!year.enabledP.taxable) model.gain(add(vr(`Rp_${i}`), vr(`Rs_${i}`)));
    if (!year.enabledP.rothIra) model.gain(vr(`Cp_${i}`));

    if (year.spouseActive) {
      const pool401s = add(begin("s", "401"), con(contrib("s", "401")));
      const mand401s = add(vr(`Rs_${i}`), vr(`Cs_${i}`));
      const ub401s = limit.start401S + contrib("s", "401");
      const k401s = kept(`K401s_${i}`, year.withdrawS.fourOhOneK, pool401s, sub(pool401s, mand401s), ub401s, ub401s);
      endOf("s", "401", sub(sub(pool401s, mand401s), k401s));
      const rothInS = year.enabledS.rothIra
        ? add(add(begin("s", "roth"), con(contrib("s", "roth"))), sub(vr(`Cs_${i}`), vr(`Ws_${i}`)))
        : add(begin("s", "roth"), con(contrib("s", "roth")));
      const kRothS = kept(`Kroths_${i}`, year.withdrawS.rothIra, rothInS, rothInS, big, big);
      endOf("s", "roth", sub(rothInS, kRothS));
      const hsaPoolS = add(begin("s", "hsa"), con(contrib("s", "hsa")));
      const kHsaS = kept(`Khsas_${i}`, year.withdrawS.hsa, hsaPoolS, hsaPoolS, big, big);
      endOf("s", "hsa", sub(hsaPoolS, kHsaS));
      if (!year.enabledS.rothIra) model.gain(vr(`Cs_${i}`));
    }

    if (i >= 2) {
      const lookback = tiersByYear[i - 2] ?? [];
      const fees = lookback.map((tier) => year.irmaaFeeByTier[tier] ?? 0);
      if (fees.length === 0 || fees.every((fee) => fee === 0)) {
        /* no Medicare surcharge uses this lookback */
      } else if (fees.every((fee) => fee === fees[0])) {
        model.gain(con(-fees[0]));
      } else {
        const fee = new Expr();
        fees.forEach((amount, index) => fee.v(`tx${i - 2}z${index}`, amount));
        model.gain(scale(fee, -1));
      }
    }
  }

  const last = years.length - 1;
  if (last >= 0) {
    const year = years[last];
    const limit = limits[last];
    const grown = (start: number, addend: number, rate: number) => Math.max(0, start + addend) * (1 + Math.max(0, rate) / 100);
    let hsaP = years[0].initialP.hsa;
    let hsaS = years[0].initialS.hsa;
    for (const item of years) {
      hsaP = item.enabledP.hsa ? grown(hsaP, item.contribP.hsa, item.rateP.hsa) : 0;
      hsaS = item.spouseActive && item.enabledS.hsa ? grown(hsaS, item.contribS.hsa, item.rateS.hsa) : 0;
    }
    const endOfAccount = (who: "p" | "s", key: AccountKey) => {
      const enabled = (who === "p" ? year.enabledP : year.enabledS)[accountKey(key)];
      if (!enabled || (who === "s" && !year.spouseActive)) return con(0);
      return vr(`E${who}${key}_${last}`);
    };
    const l401p = endOfAccount("p", "401");
    const l401s = endOfAccount("s", "401");
    const lhsaP = endOfAccount("p", "hsa");
    const lhsaS = endOfAccount("s", "hsa");
    const pretaxHi =
      (year.enabledP.fourOhOneK ? grown(limit.start401P, year.contribP.fourOhOneK, year.rateP.fourOhOneK) : 0) +
      (year.spouseActive && year.enabledS.fourOhOneK ? grown(limit.start401S, year.contribS.fourOhOneK, year.rateS.fourOhOneK) : 0) +
      hsaP +
      hsaS;
    const weight = spendableWeight(inputs);
    if (pretaxHi > 1 && weight > 0) {
      const ordinary = vr(`Rp_${last}`).v(`Rs_${last}`).v(`Cp_${last}`).v(`Cs_${last}`);
      const pretax = add(add(l401p, l401s), add(lhsaP, lhsaS));
      const domain = Math.max(limit.ordinaryHi, 0) + pretaxHi;
      const pieces = incomeTaxPieces(year, domain);
      model.eq(sub(vr(`OrdL_${last}`), add(ordinary, pretax)));
      model.piecewise(`lq${last}`, vr(`OrdL_${last}`), pieces, `TaxL_${last}`, domain);
      model.bound(`Lf_${last}`, 0, model.big);
      model.ge(sub(vr(`Lf_${last}`), sub(vr(`TaxL_${last}`), vr(`Tax_${last}`))));
      model.gain(vr(`Lf_${last}`, -weight));
      if (year.state === "ga") {
        const income = add(add(ordinary, pretax), con(year.agi));
        model.bound(`ExP2_${last}`, 0, Math.max(0, year.gaCapP));
        model.bound(`ExS2_${last}`, 0, Math.max(0, year.gaCapS));
        model.le(sub(vr(`ExP2_${last}`), add(add(add(vr(`Rp_${last}`), vr(`Cp_${last}`)), l401p), con(year.agi))));
        model.le(sub(vr(`ExS2_${last}`), add(add(vr(`Rs_${last}`), vr(`Cs_${last}`)), l401s)));
        model.bound(`Ga2_${last}`, 0, model.big);
        model.ge(sub(vr(`Ga2_${last}`), sub(sub(sub(income, vr(`ExP2_${last}`)), vr(`ExS2_${last}`)), con(year.gaDeduction))));
        model.bound(`St2_${last}`, 0, model.big);
        model.ge(sub(vr(`St2_${last}`), scale(vr(`Ga2_${last}`), year.gaRate)));
        model.bound(`Ls_${last}`, 0, model.big);
        model.ge(sub(vr(`Ls_${last}`), sub(vr(`St2_${last}`), vr(`St_${last}`))));
        model.gain(vr(`Ls_${last}`, -weight));
      }
      const cashFees = year.irmaaCashoutFeeByTier;
      if (cashFees.some((fee) => fee !== cashFees[0])) {
        const ordinaryHi = Math.max(limit.ordinaryHi, 0);
        model.piecewise(`ib${last}`, ordinary, irmaaFeePieces(year, ordinaryHi, cashFees), `Ib_${last}`, ordinaryHi);
        model.piecewise(`ia${last}`, vr(`OrdL_${last}`), irmaaFeePieces(year, domain, cashFees), `Ia_${last}`, domain);
        model.gain(scale(sub(vr(`Ib_${last}`), vr(`Ia_${last}`)), weight));
      }
    }
    if (weight > 0 && year.age < 60) model.gain(scale(l401p, -0.1 * weight));
    if (weight > 0 && year.spouseActive && year.spouseAge !== null && year.spouseAge < 60) model.gain(scale(l401s, -0.1 * weight));
    if (weight > 0 && year.age < 65) model.gain(scale(lhsaP, -0.2 * weight));
    if (weight > 0 && year.spouseActive && year.spouseAge !== null && year.spouseAge < 65) model.gain(scale(lhsaS, -0.2 * weight));
  }

  for (const who of ["p", "s"] as const) {
    for (const key of ["401", "roth", "hsa", "tax"] as const) {
      const flags = live(who, key);
      if (flags.some(Boolean)) continue;
      const initial = (who === "p" ? years[0].initialP : years[0].initialS)[accountKey(key)];
      if (who === "s" && !years[years.length - 1].spouseActive) continue;
      if (initial !== 0) model.gain(con(initial));
    }
  }
  model.gain(con(-baseTaxes));

  const highs = await solver();
  const names = await highs.withModel({ format: "lp", data: model.lp() }, (native) => {
    native.options.set("output_flag", false);
    native.options.set("mip_rel_gap", 0);
    native.options.set("mip_abs_gap", 0.5);
    native.options.set("time_limit", 60);
    const primaryAt = years.map((_, index) => {
      try {
        return native.getColByName(`Cp_${index}`);
      } catch {
        return -1;
      }
    });
    const spouseAt = years.map((_, index) => {
      try {
        return native.getColByName(`Cs_${index}`);
      } catch {
        return -1;
      }
    });
    const emit = (values: ArrayLike<number> | undefined) => {
      if (!values || !onProgress) return;
      const plan: ConversionPlan = {};
      years.forEach((year, index) => {
        const primary = primaryAt[index] >= 0 ? values[primaryAt[index]] : 0;
        const spouse = spouseAt[index] >= 0 ? values[spouseAt[index]] : 0;
        plan[year.year] = {
          primary: cents(primary),
          spouse: cents(spouse),
        };
      });
      onProgress(simulatePlan(inputs, plan).rows);
    };
    const run = native.run({
      [highs.constants.callbackType.mipImprovingSolution](event) {
        emit(event.data.mip_solution);
      },
    });
    let objective = Number.NaN;
    try {
      objective = native.getObjectiveValue();
    } catch {
      objective = Number.NaN;
    }
    const solvedNames: Record<string, number> = {};
    try {
      const solution = native.getSolution();
      const dims = native.getDimensions();
      for (let col = 0; col < dims.numCols; col++) solvedNames[native.getColName(col)] = solution.colValue[col];
      emit(solution.colValue);
    } catch {
      return { status: run.modelStatus, objective, names: solvedNames };
    }
    return { status: run.modelStatus, objective, names: solvedNames };
  });

  if (!Number.isFinite(names.objective) || Object.keys(names.names).length === 0) {
    return rejectPlan(failures, "maximization returned no usable solution", {
      status: solverStatus(names.status),
      objective: names.objective,
      years: years.length,
      fromAge: years[0]?.age,
      throughAge: years[years.length - 1]?.age,
    });
  }
  const plan: ConversionPlan = {};
  for (let i = 0; i < years.length; i++) {
    plan[years[i].year] = {
      primary: cents(names.names[`Cp_${i}`] ?? 0),
      spouse: cents(names.names[`Cs_${i}`] ?? 0),
    };
  }
  const sim = simulatePlan(inputs, plan);
  const gap = Math.abs(sim.score - names.objective);
  if (gap > 20) {
    return rejectPlan(failures, "maximization score did not match the projection", {
      status: solverStatus(names.status),
      solverScore: names.objective,
      projectionScore: sim.score,
      gap,
      tolerance: 20,
      years: years.length,
      fromAge: years[0]?.age,
      throughAge: years[years.length - 1]?.age,
    });
  }
  if (names.status !== 7) {
    console.warn("[retirement] maximization stopped before it could prove this is the maximum", {
      status: solverStatus(names.status),
      solverScore: names.objective,
      projectionScore: sim.score,
      gap,
      years: years.length,
      fromAge: years[0]?.age,
      throughAge: years[years.length - 1]?.age,
    });
  }
  return { ...sim, proven: names.status === 7 };
}

/** Exact plan when the switch is on. The previous search is used if the solver does not agree with the projection. */
export async function projectExact(
  inputs: PlannerInputs,
  onProgress?: (rows: ProjectionRow[]) => void,
): Promise<{ rows: ProjectionRow[]; exact: boolean }> {
  if (!inputs.optimizeDistributions) return { rows: project(inputs), exact: true };
  try {
    const solved = await solveOptimalPlan(inputs, onProgress);
    if (solved) return { rows: solved.rows, exact: solved.proven };
  } catch (error) {
    console.error("[retirement] maximization failed", error);
  }
  console.warn("[retirement] showing the approximate search instead of a maximization plan");
  return { rows: project(inputs), exact: false };
}
