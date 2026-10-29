import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const loaded = jiti("../src/lib/retirement/engine.ts");
const { project, defaultInputs, simulatePlan, optimizerCensus } = loaded.default ?? loaded;

function row(rows, year) {
  const found = rows.find((item) => item.year === year);
  assert.ok(found, `missing ${year}`);
  return found;
}

function expectTax(found, expected) {
  const tax = found.taxSummary;
  assert.equal(found.filingStatus, expected.filing, `${found.year} filing`);
  assert.equal(tax.standardDeduction, expected.std, `${found.year} standard deduction`);
  assert.equal(tax.additionalDeduction, expected.add, `${found.year} additional deduction`);
  assert.equal(tax.elderlyAgiDeduction, expected.senior, `${found.year} senior deduction`);
  assert.equal(tax.federalTax, expected.fed, `${found.year} federal tax`);
  assert.equal(tax.irmaa.enrollees, expected.enrollees, `${found.year} Medicare enrollees`);
  assert.equal(tax.irmaa.lookbackFiling, expected.lookback, `${found.year} IRMAA lookback filing`);
}

function openedPlan() {
  const inputs = defaultInputs();
  inputs.optimizeDistributions = false;
  for (const group of [inputs.accounts, inputs.spouseAccounts]) {
    group.fourOhOneK.preRmdConversion = false;
    group.fourOhOneK.rmdConversion = false;
  }
  return inputs;
}

function silenceContributions(inputs) {
  for (const group of [inputs.accounts, inputs.spouseAccounts]) {
    for (const type of ["rothIra", "hsa", "fourOhOneK", "taxable"]) {
      group[type].annualContribution = 0;
      group[type].annualWithdrawal = 0;
    }
  }
}

test("a new plan starts with maximize on", () => {
  const inputs = defaultInputs();
  assert.equal(inputs.optimizeDistributions, true);
  assert.equal(inputs.accounts.fourOhOneK.preRmdConversion, true);
  assert.equal(inputs.accounts.fourOhOneK.rmdConversion, true);
  assert.equal(inputs.accounts.fourOhOneK.preRmdConversionBracketRate, 37);
  assert.equal(inputs.spouseAccounts.fourOhOneK.payConversionTaxFromTaxable, true);
});

test("the year of the primary death stays joint and the next year is single", () => {
  const inputs = openedPlan();
  inputs.longevityAge = 80;
  inputs.spouseLongevityAge = 100;
  inputs.adjustedGrossIncome = 80_000;
  inputs.socialSecurityIncome = 0;
  const projected = project(inputs);
  const simulated = simulatePlan(inputs, {});
  const census = optimizerCensus(inputs);
  const death = {
    filing: "married",
    std: 32_200,
    add: 3_300,
    senior: 12_000,
    fed: 3404,
    enrollees: 2,
    lookback: "married",
  };
  const widow = {
    filing: "single",
    std: 16_100,
    add: 2_050,
    senior: 5_700,
    fed: 7065,
    enrollees: 1,
    lookback: "married",
  };
  for (const rows of [projected, simulated.rows]) {
    expectTax(row(rows, 2035), death);
    expectTax(row(rows, 2036), widow);
    expectTax(row(rows, 2038), { ...widow, lookback: "single" });
  }
  for (const year of [2036, 2038]) {
    const solved = census.find((item) => item.year === year);
    assert.equal(solved.filing, "single", `${year} solver filing`);
    assert.equal(solved.spouseActive, true, `${year} spouse balances stay`);
    assert.equal(solved.primaryAlive, false, `${year} primary is dead`);
    assert.equal(solved.spouseAlive, true, `${year} spouse is alive`);
    assert.equal(solved.taxAge, year - inputs.spouseBirthYear, `${year} taxpayer age`);
    assert.equal(solved.taxSpouseAge, null, `${year} no second taxpayer`);
    assert.equal(solved.enrollees, 1, `${year} solver Medicare enrollees`);
    assert.equal(solved.fixedDeduction, 18_150, `${year} solver deduction`);
    assert.equal(solved.gaCapP, 65_000, `${year} living spouse exclusion`);
    assert.equal(solved.gaCapS, 0, `${year} dead spouse exclusion`);
    assert.equal(row(projected, year).spendable.irmaaFeeBefore, row(simulated.rows, year).spendable.irmaaFeeBefore);
  }
});

test("the year of the spouse death stays joint and the next year is single", () => {
  const inputs = openedPlan();
  inputs.longevityAge = 100;
  inputs.spouseLongevityAge = 70;
  inputs.adjustedGrossIncome = 80_000;
  inputs.socialSecurityIncome = 0;
  const projected = project(inputs);
  const simulated = simulatePlan(inputs, {});
  const census = optimizerCensus(inputs);
  const death = {
    filing: "married",
    std: 32_200,
    add: 3_300,
    senior: 12_000,
    fed: 3404,
    enrollees: 2,
    lookback: "married",
  };
  const survivor = {
    filing: "single",
    std: 16_100,
    add: 2_050,
    senior: 5_700,
    fed: 7065,
    enrollees: 1,
    lookback: "married",
  };
  for (const rows of [projected, simulated.rows]) {
    expectTax(row(rows, 2030), death);
    expectTax(row(rows, 2031), survivor);
  }
  const solved = census.find((item) => item.year === 2031);
  assert.equal(solved.filing, "single");
  assert.equal(solved.spouseActive, true);
  assert.equal(solved.primaryAlive, true);
  assert.equal(solved.spouseAlive, false);
  assert.equal(solved.taxAge, 2031 - inputs.birthYear);
  assert.equal(solved.taxSpouseAge, null);
  assert.equal(solved.enrollees, 1);
  assert.ok(row(projected, 2031).totalBalance >= 0);
});

test("a year before the marriage is a single return", () => {
  const inputs = openedPlan();
  inputs.marriageYear = 2040;
  inputs.adjustedGrossIncome = 0;
  const projected = project(inputs);
  const before = {
    filing: "single",
    std: 16_100,
    add: 2_050,
    senior: 6_000,
    fed: 0,
    enrollees: 1,
    lookback: "single",
  };
  const wed = {
    filing: "married",
    std: 32_200,
    add: 3_300,
    senior: 12_000,
    fed: 0,
    enrollees: 2,
    lookback: "single",
  };
  expectTax(row(projected, 2039), before);
  expectTax(row(projected, 2040), wed);
  const census = optimizerCensus(inputs);
  assert.equal(census.find((item) => item.year === 2039).filing, "single");
  assert.equal(census.find((item) => item.year === 2039).spouseActive, false);
  assert.equal(census.find((item) => item.year === 2040).filing, "married");
  assert.equal(census.find((item) => item.year === 2040).spouseActive, true);
});

test("the surviving spouse keeps the Georgia retirement exclusion and the balance", () => {
  const inputs = openedPlan();
  inputs.longevityAge = 80;
  inputs.spouseLongevityAge = 100;
  inputs.adjustedGrossIncome = 0;
  inputs.socialSecurityIncome = 0;
  silenceContributions(inputs);
  inputs.accounts.rothIra.enabled = false;
  inputs.accounts.hsa.enabled = false;
  inputs.accounts.taxable.enabled = false;
  inputs.accounts.fourOhOneK.enabled = false;
  inputs.spouseAccounts.rothIra.enabled = false;
  inputs.spouseAccounts.hsa.enabled = false;
  inputs.spouseAccounts.fourOhOneK.enabled = true;
  inputs.spouseAccounts.fourOhOneK.currentBalance = 500_000;
  const projected = project(inputs);
  const simulated = simulatePlan(inputs, {});
  for (const found of [row(projected, 2036), row(simulated.rows, 2036)]) {
    assert.equal(found.filingStatus, "single");
    assert.equal(found.taxSummary.stateTax, 0, "spouse RMD is inside the single exclusion");
    assert.equal(found.spendable.stateBefore, 0, "spendable state tax uses the same exclusion");
    assert.ok(found.accounts.fourOhOneK.endBalance > 100_000, "spouse 401(k) is not dropped");
  }
});

test("a survivor under 65 does not pay IRMAA for a dead spouse", () => {
  const inputs = openedPlan();
  inputs.longevityAge = 80;
  inputs.spouseBirthYear = 1980;
  inputs.spouseLongevityAge = 100;
  inputs.adjustedGrossIncome = 300_000;
  inputs.socialSecurityIncome = 0;
  const projected = project(inputs);
  const found = row(projected, 2036);
  expectTax(found, {
    filing: "single",
    std: 16_100,
    add: 0,
    senior: 0,
    fed: 68_134.25,
    enrollees: 0,
    lookback: "married",
  });
  assert.equal(found.spendable.irmaaFeeBefore, 0);
});
