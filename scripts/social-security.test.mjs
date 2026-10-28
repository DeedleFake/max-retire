import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const loaded = jiti("../src/lib/retirement/engine.ts");
const { defaultInputs, householdSocialSecurity, project, simulatePlan, optimizerCensus } = loaded.default ?? loaded;

function plan(overrides) {
  return { ...defaultInputs(), socialSecurityIncome: 0, spouseSocialSecurityIncome: 0, ...overrides };
}

test("a living worker is paid for six months of the start year and the full year after", () => {
  const inputs = plan({
    filingStatus: "single",
    marriageYear: null,
    spouseBirthYear: null,
    birthYear: 1960,
    longevityAge: 90,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2027), 12_000);
  assert.equal(householdSocialSecurity(inputs, 2028), 24_000);
});

test("the year of death pays six months and the next year pays nothing", () => {
  const inputs = plan({
    filingStatus: "single",
    marriageYear: null,
    spouseBirthYear: null,
    birthYear: 1960,
    longevityAge: 80,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2040), 12_000);
  assert.equal(householdSocialSecurity(inputs, 2041), 0);
});

test("two living spouses receive both checks and not a spousal top-up", () => {
  const inputs = plan({
    birthYear: 1960,
    spouseBirthYear: 1960,
    marriageYear: 2020,
    longevityAge: 100,
    spouseLongevityAge: 100,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 67,
    spouseSocialSecurityIncome: 12_000,
    spouseSocialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2030), 36_000);
});

test("after a death the survivor receives the larger benefit, not the sum", () => {
  const inputs = plan({
    birthYear: 1950,
    spouseBirthYear: 1950,
    marriageYear: 1980,
    longevityAge: 80,
    spouseLongevityAge: 100,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 66,
    spouseSocialSecurityIncome: 30_000,
    spouseSocialSecurityStartAge: 66,
  });
  assert.equal(householdSocialSecurity(inputs, 2031), 30_000);
});

test("a survivor at full retirement age is capped when the deceased claimed at 62", () => {
  const inputs = plan({
    birthYear: 1960,
    spouseBirthYear: 1955,
    marriageYear: 1990,
    longevityAge: 70,
    spouseLongevityAge: 100,
    socialSecurityIncome: 14_000,
    socialSecurityStartAge: 62,
    spouseSocialSecurityIncome: 0,
    spouseSocialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2031), 16_500);
});

test("a survivor under 60 receives nothing from the deceased worker", () => {
  const inputs = plan({
    birthYear: 1960,
    spouseBirthYear: 1990,
    marriageYear: 2015,
    longevityAge: 70,
    spouseLongevityAge: 100,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 67,
    spouseSocialSecurityIncome: 0,
    spouseSocialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2031), 0);
});

test("the year a survivor turns 60 pays the reduced benefit for July through December", () => {
  const inputs = plan({
    birthYear: 1950,
    spouseBirthYear: 1960,
    marriageYear: 1980,
    longevityAge: 69,
    spouseLongevityAge: 100,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 66,
    spouseSocialSecurityIncome: 0,
    spouseSocialSecurityStartAge: 67,
  });
  assert.equal(householdSocialSecurity(inputs, 2020), 8681.79);
});

test("the projection, the exact plan, and the solver use the same Social Security", () => {
  const inputs = plan({
    filingStatus: "single",
    marriageYear: null,
    spouseBirthYear: null,
    birthYear: 1960,
    retirementYear: 2026,
    longevityAge: 90,
    socialSecurityIncome: 24_000,
    socialSecurityStartAge: 67,
    optimizeDistributions: false,
  });
  const year = 2028;
  const expected = householdSocialSecurity(inputs, year);
  const projected = project(inputs).find((row) => row.year === year);
  const simulated = simulatePlan(inputs, {}).rows.find((row) => row.year === year);
  const solved = optimizerCensus(inputs).find((row) => row.year === year);
  assert.equal(projected.taxSummary.ssIncome, expected);
  assert.equal(simulated.taxSummary.ssIncome, expected);
  assert.equal(solved.ss, expected);
});
