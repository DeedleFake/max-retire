import loadHighs from "highs";
import { MARRIED_BRACKETS, SINGLE_BRACKETS, STATE_BRACKETS } from "./tax-tables";
import {
  type ConversionPlan,
  type FilingStatus,
  type PlannerInputs,
  type ProjectionRow,
  federalTax,
  optimizerCensus,
  project,
  simulatePlan,
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
      const table = STATE_BRACKETS[year.stateCode] ?? [];
      const scale = table.length > 1 && year.filing === "married" ? 2 : 1;
      for (const row of table) {
        const hit = crossing(base[i], base[i + 1], (x) => magiAt(year, x), row.min * scale);
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
      this.ge(sub(vr(part), vr(z, piece.lo)));
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
 * Tax is paid from the taxable account. A plan that would owe more tax than that
 * account holds is withheld from the Roth instead; that case is the fallback model.
 */
export async function solveOptimalPlan(
  inputs: PlannerInputs,
  onProgress?: (rows: ProjectionRow[]) => void,
): Promise<ExactPlan | null> {
  const failures: PlanFailure[] = [];
  const covered = await solveModel(inputs, true, onProgress, failures);
  if (covered) return covered;
  const full = await solveModel(inputs, false, onProgress, failures);
  if (full) return full;
  for (const failure of failures) console.warn(`[retirement] ${failure.reason}`, failure.detail);
  return null;
}

async function solveModel(
  inputs: PlannerInputs,
  requireCovered: boolean,
  onProgress: ((rows: ProjectionRow[]) => void) | undefined,
  failures: PlanFailure[],
): Promise<ExactPlan | null> {
  const years = optimizerCensus(inputs);
  if (years.length === 0) return rejectPlan(failures, "maximization had no years to solve", { requireCovered });
  const limits = yearLimits(years);
  const big = moneyBound(years);
  const model = new Model(big);
  const live = (who: "p" | "s", key: AccountKey) => years.map((year) => (who === "p" ? year.enabledP : year.enabledS)[accountKey(key)]);
  const tiersByYear: number[][] = [];

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
    if (requireCovered) {
      model.eq(sub(vr(`Pd_${i}`), vr(`Dist_${i}`)));
      if (year.enabledP.taxable) model.ge(sub(pool, vr(`Dist_${i}`)));
      model.bound(`Wp_${i}`, 0, 0);
      model.bound(`Ws_${i}`, 0, 0);
    } else if (year.enabledP.taxable) {
      model.minOf(`Pd_${i}`, vr(`Dist_${i}`), pool, limit.taxHi, poolCap);
      if (year.enabledP.rothIra && year.canConvertP) model.minOf(`Wp_${i}`, sub(vr(`Dist_${i}`), vr(`Pd_${i}`)), vr(`Cp_${i}`), limit.taxHi, Math.max(limit.convHiP, 1));
      else model.bound(`Wp_${i}`, 0, 0);
      if (year.spouseActive && year.enabledS.rothIra && year.canConvertS) {
        model.minOf(`Ws_${i}`, sub(sub(vr(`Dist_${i}`), vr(`Pd_${i}`)), vr(`Wp_${i}`)), vr(`Cs_${i}`), limit.taxHi, Math.max(limit.convHiS, 1));
      } else model.bound(`Ws_${i}`, 0, 0);
    } else {
      model.bound(`Pd_${i}`, 0, 0);
      if (year.enabledP.rothIra && year.canConvertP) model.minOf(`Wp_${i}`, vr(`Dist_${i}`), vr(`Cp_${i}`), limit.taxHi, Math.max(limit.convHiP, 1));
      else model.bound(`Wp_${i}`, 0, 0);
      if (year.spouseActive && year.enabledS.rothIra && year.canConvertS) {
        model.minOf(`Ws_${i}`, sub(vr(`Dist_${i}`), vr(`Wp_${i}`)), vr(`Cs_${i}`), limit.taxHi, Math.max(limit.convHiS, 1));
      } else model.bound(`Ws_${i}`, 0, 0);
    }
    model.bound(`Un_${i}`, 0, limit.taxHi);
    model.eq(sub(add(add(add(vr(`Pd_${i}`), vr(`Wp_${i}`)), vr(`Ws_${i}`)), vr(`Un_${i}`)), vr(`Dist_${i}`)));
    model.gain(vr(`Un_${i}`, -1));
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
      requireCovered,
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
      requireCovered,
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
