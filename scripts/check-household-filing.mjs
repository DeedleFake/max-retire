import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const loaded = jiti("../src/lib/retirement/engine.ts");
const { defaultInputs, householdYear } = loaded.default ?? loaded;

function range(from, to) {
  const values = [];
  for (let value = from; value <= to; value++) values.push(value);
  return values;
}

// Independent of householdYear. Joint only while the menu is married, the marriage has started, and both people are still in their longevity year. The survivor is the taxpayer only after that marriage, once the primary is dead and the spouse is not.
function rule(inputs, year) {
  const menuMarried = inputs.filingStatus === "married";
  const marriageStarted = inputs.marriageYear !== null && year >= inputs.marriageYear;
  const spouseKnown = inputs.spouseBirthYear !== null;
  const primaryAge = year - inputs.birthYear;
  const spouseAge = spouseKnown ? year - inputs.spouseBirthYear : null;
  const primaryAlive = year <= inputs.birthYear + inputs.longevityAge;
  const spouseLiving = spouseKnown && year <= inputs.spouseBirthYear + inputs.spouseLongevityAge;
  const spouseAlive = menuMarried && marriageStarted && spouseLiving;
  const filing = primaryAlive && spouseAlive ? "married" : "single";
  const survivorIsSpouse = menuMarried && marriageStarted && spouseLiving && !primaryAlive;
  const taxAge = survivorIsSpouse ? spouseAge : primaryAge;
  const taxSpouseAge = filing === "married" ? spouseAge : null;
  return { spouseAge, filing, taxAge, taxSpouseAge, primaryAlive, spouseAlive };
}

function* households() {
  for (const birthYear of range(1955, 1960)) {
    for (const filingStatus of ["married", "single"]) {
      for (const spouseOffset of [null, 0, 5, 10]) {
        const spouseBirthYear = spouseOffset === null ? null : birthYear + spouseOffset;
        const spouseLongs = spouseBirthYear === null ? [100] : range(70, 100);
        for (const longevityAge of range(70, 100)) {
          for (const spouseLongevityAge of spouseLongs) {
            for (const marriageYear of [null, ...range(birthYear, birthYear + 30)]) {
              yield { birthYear, filingStatus, spouseBirthYear, longevityAge, spouseLongevityAge, marriageYear };
            }
          }
        }
      }
    }
  }
}

function yearsOf(home) {
  const births = [home.birthYear];
  if (home.spouseBirthYear !== null) births.push(home.spouseBirthYear);
  const deaths = [home.birthYear + home.longevityAge];
  if (home.spouseBirthYear !== null) deaths.push(home.spouseBirthYear + home.spouseLongevityAge);
  let first = Math.min(...births, home.marriageYear ?? home.birthYear) - 1;
  let last = Math.max(...deaths) + 1;
  const years = [];
  for (let year = first; year <= last; year++) years.push(year);
  return years;
}

function tell(inputs, year, expected, actual) {
  const lines = [
    `Primary birth ${inputs.birthYear}, longevity ${inputs.longevityAge}.`,
    inputs.spouseBirthYear === null
      ? "No spouse birth year."
      : `Spouse birth ${inputs.spouseBirthYear}, longevity ${inputs.spouseLongevityAge}.`,
    `Filing menu ${inputs.filingStatus}. Marriage year ${inputs.marriageYear ?? "none"}.`,
    `Calendar year ${year}.`,
    `The rule expects filing ${expected.filing}, taxpayer age ${expected.taxAge}, second age ${expected.taxSpouseAge ?? "none"}, primary ${expected.primaryAlive ? "alive" : "dead"}, spouse ${expected.spouseAlive ? "alive" : "dead"}.`,
    `householdYear returned filing ${actual.filing}, taxpayer age ${actual.taxAge}, second age ${actual.taxSpouseAge ?? "none"}, primary ${actual.primaryAlive ? "alive" : "dead"}, spouse ${actual.spouseAlive ? "alive" : "dead"}.`,
  ];
  return lines.join(" ");
}

const base = defaultInputs();
let householdsChecked = 0;
let yearsChecked = 0;
for (const home of households()) {
  const inputs = { ...base, ...home };
  householdsChecked += 1;
  for (const year of yearsOf(home)) {
    yearsChecked += 1;
    const expected = rule(inputs, year);
    const actual = householdYear(inputs, year);
    const same =
      actual.spouseAge === expected.spouseAge &&
      actual.filing === expected.filing &&
      actual.taxAge === expected.taxAge &&
      actual.taxSpouseAge === expected.taxSpouseAge &&
      actual.primaryAlive === expected.primaryAlive &&
      actual.spouseAlive === expected.spouseAlive;
    if (!same) {
      console.error(tell(inputs, year, expected, actual));
      console.error(JSON.stringify({ householdsChecked, yearsChecked, ok: false }));
      process.exit(1);
    }
  }
}
console.log(JSON.stringify({ ok: true, householdsChecked, yearsChecked }));
