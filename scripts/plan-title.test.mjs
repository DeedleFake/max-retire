import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { defaultInputs, parsePlannerInputs, serializePlannerInputs, planFileName } = jiti("../src/lib/retirement/engine.ts");

test("a plan name round-trips through the saved file", () => {
  const inputs = { ...defaultInputs(), title: "Roth conversions before 70" };
  const loaded = parsePlannerInputs(serializePlannerInputs(inputs));
  assert.equal(loaded.title, "Roth conversions before 70");
  assert.equal(planFileName(loaded.title), "Roth conversions before 70.json");
});

test("a file saved before plan names existed still opens", () => {
  const saved = JSON.parse(serializePlannerInputs(defaultInputs()));
  delete saved.title;
  const loaded = parsePlannerInputs(JSON.stringify(saved));
  assert.equal(loaded.title, "Retirement plan");
});

test("the download name drops characters a file name cannot use", () => {
  assert.equal(planFileName('  Plan: "A" / B  '), "Plan A B.json");
  assert.equal(planFileName("   "), "retirement-plan.json");
});
