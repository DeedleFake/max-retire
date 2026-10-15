import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const engine = await server.ssrLoadModule("/src/lib/retirement/engine.ts");
const optimize = await server.ssrLoadModule("/src/lib/retirement/optimize.ts");

function long() {
  const inputs = engine.defaultInputs();
  inputs.filingStatus = "single";
  inputs.marriageYear = null;
  inputs.spouseBirthYear = null;
  inputs.birthYear = 1960;
  inputs.retirementYear = 2026;
  inputs.longevityAge = 95;
  inputs.state = "GA";
  inputs.socialSecurityIncome = 30_000;
  inputs.socialSecurityStartAge = 67;
  inputs.adjustedGrossIncome = 0;
  inputs.accounts.fourOhOneK.currentBalance = 800_000;
  inputs.accounts.fourOhOneK.rateOfReturn = 7;
  inputs.accounts.fourOhOneK.annualContribution = 0;
  inputs.accounts.taxable.currentBalance = 400_000;
  inputs.accounts.taxable.rateOfReturn = 5;
  inputs.accounts.taxable.annualContribution = 0;
  inputs.accounts.rothIra.currentBalance = 0;
  inputs.accounts.rothIra.rateOfReturn = 7;
  inputs.accounts.rothIra.annualContribution = 0;
  inputs.accounts.hsa.enabled = false;
  inputs.optimizeDistributions = true;
  return inputs;
}

const mode = process.argv[2] ?? "full";
const limit = process.argv[3] ?? "8";
const nodes = process.argv[4] ?? "0";
process.env.PLAN_MODE = mode;
process.env.PLAN_LIMIT = limit;
process.env.PLAN_NODES = nodes;
const started = Date.now();
try {
  const inputs = long();
  const solved = await optimize.solveOptimalPlan(inputs);
  console.log(mode, "ms", Date.now() - started, "ok", Boolean(solved), solved ? Math.round(solved.score) : "");
  if (solved) {
    for (const row of solved.rows) {
      const tax = row.accounts.taxable;
      console.log(
        row.year,
        "age",
        row.age,
        "conv",
        Math.round(row.taxSummary.conversionAmount),
        "rmd",
        Math.round(row.taxSummary.rmdAmount),
        "fed",
        Math.round(row.taxSummary.federalTax),
        "st",
        Math.round(row.taxSummary.stateTax),
        "taxStart",
        Math.round(tax.startBalance),
        "taxEnd",
        Math.round(tax.endBalance),
        "taxWd",
        Math.round(tax.withdrawal),
      );
    }
  }
} catch (error) {
  console.log("THREW", error instanceof Error ? `${error.name}: ${error.message}` : error);
}
await server.close();
