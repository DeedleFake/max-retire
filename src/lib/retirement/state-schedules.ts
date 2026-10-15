/**
 * 2026 wage-tax schedules. `min` is the first dollar of that marginal rate.
 * `single` is also married filing separately where a state uses that table.
 * `married` is a joint return. Head-of-household tables are not stored.
 *
 * These are the statutory rates. Except for Georgia, the planner applies them
 * to the same income it uses for the federal calculation. It does not apply
 * state standard deductions, personal exemptions, credits, or local income taxes.
 *
 * Not represented, because they are not a single pair of rate schedules:
 * Iowa's low-income exemption and alternate tax; Idaho's inflation-indexed
 * zero bracket (the 2026 dollar amount was not posted; the rate is 5.3%);
 * Arkansas's recomputation of the tax above $94,700; Ohio's separate 3%
 * business-income tax; Montana's lower rates on long-term capital gains.
 */

export type StateBracket = { rate: number; min: number };
export type StateSchedule = { single: StateBracket[]; married: StateBracket[] };

const none = (): StateSchedule => ({ single: [], married: [] });
const flat = (rate: number): StateSchedule => ({
  single: [{ rate, min: 0 }],
  married: [{ rate, min: 0 }],
});
const both = (rows: StateBracket[]): StateSchedule => ({
  single: rows,
  married: rows.map((row) => ({ ...row })),
});
const doubled = (rows: StateBracket[]): StateSchedule => ({
  single: rows,
  married: rows.map((row) => ({ rate: row.rate, min: row.min * 2 })),
});

export const STATE_BRACKETS: Record<string, StateSchedule> = {
  AK: none(),
  FL: none(),
  NV: none(),
  NH: none(),
  SD: none(),
  TN: none(),
  TX: none(),
  WA: none(),
  WY: none(),

  AZ: flat(0.025),
  CO: flat(0.044),
  GA: flat(0.0499),
  ID: flat(0.053),
  IL: flat(0.0495),
  IN: flat(0.0295),
  IA: flat(0.038),
  KY: flat(0.035),
  LA: flat(0.03),
  MI: flat(0.0425),
  NC: flat(0.0399),
  PA: flat(0.0307),
  UT: flat(0.0445),

  // 0% through $10,000 per spouse, then 4%. A joint return doubles the zero band.
  MS: doubled([
    { rate: 0, min: 0 },
    { rate: 0.04, min: 10_000 },
  ]),
  // $0 at or below $26,050, then $332 plus 2.75% of the excess. Same for every status.
  // stateTax applies the $332. The second row is the marginal rate above the floor.
  OH: both([
    { rate: 0, min: 0 },
    { rate: 0.0275, min: 26_050 },
  ]),

  AL: doubled([
    { rate: 0.02, min: 0 },
    { rate: 0.04, min: 500 },
    { rate: 0.05, min: 3_000 },
  ]),
  // Schedule for net income of $94,700 or less. Above that, Act 2 of 2026 recomputes the tax.
  AR: both([
    { rate: 0, min: 0 },
    { rate: 0.02, min: 5_600 },
    { rate: 0.03, min: 11_200 },
    { rate: 0.034, min: 16_000 },
    { rate: 0.037, min: 26_400 },
  ]),
  CA: {
    single: [
      { rate: 0.01, min: 0 },
      { rate: 0.02, min: 11_456 },
      { rate: 0.04, min: 27_157 },
      { rate: 0.06, min: 42_861 },
      { rate: 0.08, min: 59_498 },
      { rate: 0.093, min: 75_197 },
      { rate: 0.103, min: 384_109 },
      { rate: 0.113, min: 460_927 },
      { rate: 0.123, min: 768_213 },
      { rate: 0.133, min: 1_000_000 },
    ],
    married: [
      { rate: 0.01, min: 0 },
      { rate: 0.02, min: 22_912 },
      { rate: 0.04, min: 54_314 },
      { rate: 0.06, min: 85_722 },
      { rate: 0.08, min: 118_996 },
      { rate: 0.093, min: 150_394 },
      { rate: 0.103, min: 768_218 },
      { rate: 0.113, min: 921_854 },
      { rate: 0.123, min: 1_000_000 },
      { rate: 0.133, min: 1_536_426 },
    ],
  },
  CT: doubled([
    { rate: 0.02, min: 0 },
    { rate: 0.045, min: 10_000 },
    { rate: 0.055, min: 50_000 },
    { rate: 0.06, min: 100_000 },
    { rate: 0.065, min: 200_000 },
    { rate: 0.069, min: 250_000 },
    { rate: 0.0699, min: 500_000 },
  ]),
  DE: both([
    { rate: 0, min: 0 },
    { rate: 0.022, min: 2_000 },
    { rate: 0.039, min: 5_000 },
    { rate: 0.048, min: 10_000 },
    { rate: 0.052, min: 20_000 },
    { rate: 0.0555, min: 25_000 },
    { rate: 0.066, min: 60_000 },
  ]),
  DC: both([
    { rate: 0.04, min: 0 },
    { rate: 0.06, min: 10_000 },
    { rate: 0.065, min: 40_000 },
    { rate: 0.085, min: 60_000 },
    { rate: 0.0925, min: 250_000 },
    { rate: 0.0975, min: 500_000 },
    { rate: 0.1075, min: 1_000_000 },
  ]),
  HI: doubled([
    { rate: 0.014, min: 0 },
    { rate: 0.032, min: 9_600 },
    { rate: 0.055, min: 14_400 },
    { rate: 0.064, min: 19_200 },
    { rate: 0.068, min: 24_000 },
    { rate: 0.072, min: 36_000 },
    { rate: 0.076, min: 48_000 },
    { rate: 0.079, min: 125_000 },
    { rate: 0.0825, min: 175_000 },
    { rate: 0.09, min: 225_000 },
    { rate: 0.1, min: 275_000 },
    { rate: 0.11, min: 325_000 },
  ]),
  KS: doubled([
    { rate: 0.052, min: 0 },
    { rate: 0.0558, min: 23_000 },
  ]),
  ME: {
    single: [
      { rate: 0.058, min: 0 },
      { rate: 0.0675, min: 27_400 },
      { rate: 0.0715, min: 64_850 },
      { rate: 0.0915, min: 1_000_000 },
    ],
    married: [
      { rate: 0.058, min: 0 },
      { rate: 0.0675, min: 54_850 },
      { rate: 0.0715, min: 129_750 },
      { rate: 0.0915, min: 1_500_000 },
    ],
  },
  MD: {
    single: [
      { rate: 0.02, min: 0 },
      { rate: 0.03, min: 1_000 },
      { rate: 0.04, min: 2_000 },
      { rate: 0.0475, min: 3_000 },
      { rate: 0.05, min: 100_000 },
      { rate: 0.0525, min: 125_000 },
      { rate: 0.055, min: 150_000 },
      { rate: 0.0575, min: 250_000 },
      { rate: 0.0625, min: 500_000 },
      { rate: 0.065, min: 1_000_000 },
    ],
    married: [
      { rate: 0.02, min: 0 },
      { rate: 0.03, min: 1_000 },
      { rate: 0.04, min: 2_000 },
      { rate: 0.0475, min: 3_000 },
      { rate: 0.05, min: 150_000 },
      { rate: 0.0525, min: 175_000 },
      { rate: 0.055, min: 225_000 },
      { rate: 0.0575, min: 300_000 },
      { rate: 0.0625, min: 600_000 },
      { rate: 0.065, min: 1_200_000 },
    ],
  },
  MA: both([
    { rate: 0.05, min: 0 },
    { rate: 0.09, min: 1_107_750 },
  ]),
  MN: {
    single: [
      { rate: 0.0535, min: 0 },
      { rate: 0.068, min: 33_310 },
      { rate: 0.0785, min: 109_430 },
      { rate: 0.0985, min: 203_150 },
    ],
    married: [
      { rate: 0.0535, min: 0 },
      { rate: 0.068, min: 48_700 },
      { rate: 0.0785, min: 193_480 },
      { rate: 0.0985, min: 337_930 },
    ],
  },
  MO: both([
    { rate: 0, min: 0 },
    { rate: 0.02, min: 1_348 },
    { rate: 0.025, min: 2_696 },
    { rate: 0.03, min: 4_044 },
    { rate: 0.035, min: 5_392 },
    { rate: 0.04, min: 6_740 },
    { rate: 0.045, min: 8_088 },
    { rate: 0.047, min: 9_436 },
  ]),
  MT: doubled([
    { rate: 0.047, min: 0 },
    { rate: 0.0565, min: 47_500 },
  ]),
  NE: {
    single: [
      { rate: 0.0246, min: 0 },
      { rate: 0.0351, min: 4_130 },
      { rate: 0.0455, min: 24_760 },
    ],
    married: [
      { rate: 0.0246, min: 0 },
      { rate: 0.0351, min: 8_250 },
      { rate: 0.0455, min: 49_530 },
    ],
  },
  NJ: {
    single: [
      { rate: 0.014, min: 0 },
      { rate: 0.0175, min: 20_000 },
      { rate: 0.035, min: 35_000 },
      { rate: 0.05525, min: 40_000 },
      { rate: 0.0637, min: 75_000 },
      { rate: 0.0897, min: 500_000 },
      { rate: 0.1075, min: 1_000_000 },
    ],
    married: [
      { rate: 0.014, min: 0 },
      { rate: 0.0175, min: 20_000 },
      { rate: 0.0245, min: 50_000 },
      { rate: 0.035, min: 70_000 },
      { rate: 0.05525, min: 80_000 },
      { rate: 0.0637, min: 150_000 },
      { rate: 0.0897, min: 500_000 },
      { rate: 0.1075, min: 1_000_000 },
    ],
  },
  NM: {
    single: [
      { rate: 0.015, min: 0 },
      { rate: 0.032, min: 5_500 },
      { rate: 0.043, min: 16_500 },
      { rate: 0.047, min: 33_500 },
      { rate: 0.049, min: 66_500 },
      { rate: 0.059, min: 210_000 },
    ],
    married: [
      { rate: 0.015, min: 0 },
      { rate: 0.032, min: 8_000 },
      { rate: 0.043, min: 25_000 },
      { rate: 0.047, min: 50_000 },
      { rate: 0.049, min: 100_000 },
      { rate: 0.059, min: 315_000 },
    ],
  },
  NY: {
    single: [
      { rate: 0.039, min: 0 },
      { rate: 0.044, min: 8_500 },
      { rate: 0.0515, min: 11_700 },
      { rate: 0.054, min: 13_900 },
      { rate: 0.059, min: 80_650 },
      { rate: 0.0685, min: 215_400 },
      { rate: 0.0965, min: 1_077_550 },
      { rate: 0.103, min: 5_000_000 },
      { rate: 0.109, min: 25_000_000 },
    ],
    married: [
      { rate: 0.039, min: 0 },
      { rate: 0.044, min: 17_150 },
      { rate: 0.0515, min: 23_600 },
      { rate: 0.054, min: 27_900 },
      { rate: 0.059, min: 161_550 },
      { rate: 0.0685, min: 323_200 },
      { rate: 0.0965, min: 2_155_350 },
      { rate: 0.103, min: 5_000_000 },
      { rate: 0.109, min: 25_000_000 },
    ],
  },
  ND: {
    single: [
      { rate: 0, min: 0 },
      { rate: 0.0195, min: 49_575 },
      { rate: 0.025, min: 250_400 },
    ],
    married: [
      { rate: 0, min: 0 },
      { rate: 0.0195, min: 82_800 },
      { rate: 0.025, min: 304_850 },
    ],
  },
  OK: doubled([
    { rate: 0, min: 0 },
    { rate: 0.025, min: 3_750 },
    { rate: 0.035, min: 4_900 },
    { rate: 0.045, min: 7_200 },
  ]),
  OR: doubled([
    { rate: 0.0475, min: 0 },
    { rate: 0.0675, min: 4_550 },
    { rate: 0.0875, min: 11_400 },
    { rate: 0.099, min: 125_000 },
  ]),
  RI: both([
    { rate: 0.0375, min: 0 },
    { rate: 0.0475, min: 82_050 },
    { rate: 0.0599, min: 186_450 },
  ]),
  SC: both([
    { rate: 0.0199, min: 0 },
    { rate: 0.0521, min: 30_000 },
  ]),
  VT: {
    single: [
      { rate: 0.0335, min: 0 },
      { rate: 0.066, min: 50_750 },
      { rate: 0.076, min: 122_850 },
      { rate: 0.0875, min: 256_300 },
    ],
    married: [
      { rate: 0.0335, min: 0 },
      { rate: 0.066, min: 84_700 },
      { rate: 0.076, min: 204_750 },
      { rate: 0.0875, min: 312_050 },
    ],
  },
  VA: both([
    { rate: 0.02, min: 0 },
    { rate: 0.03, min: 3_000 },
    { rate: 0.05, min: 5_000 },
    { rate: 0.0575, min: 17_000 },
  ]),
  WV: both([
    { rate: 0.0211, min: 0 },
    { rate: 0.0281, min: 10_000 },
    { rate: 0.0316, min: 25_000 },
    { rate: 0.0422, min: 40_000 },
    { rate: 0.0458, min: 60_000 },
  ]),
  WI: {
    single: [
      { rate: 0.035, min: 0 },
      { rate: 0.044, min: 15_110 },
      { rate: 0.053, min: 51_950 },
      { rate: 0.0765, min: 332_720 },
    ],
    married: [
      { rate: 0.035, min: 0 },
      { rate: 0.044, min: 20_150 },
      { rate: 0.053, min: 69_260 },
      { rate: 0.0765, min: 443_630 },
    ],
  },
};
