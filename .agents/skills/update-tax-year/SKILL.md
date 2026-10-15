---
name: update-tax-year
description: >
  Synchronize this retirement planner with the tax law actually in effect,
  usually once or twice a year. Use when asked to refresh tax brackets, the
  standard deduction, IRMAA, 401(k)/IRA/HSA limits, catch-up amounts, Georgia,
  or any state's income-tax table. Triggers on "update taxes", "new tax year",
  "2027 brackets", "IRMAA update", "contribution limits", "COLA", "check the
  state tax rates".
---

# Synchronize the planner with the tax year in effect

The calculator does not fetch tax law. This skill is the occasional check,
about once or twice a year, that every number the planner uses is the number
actually in effect for `TAX_YEAR`. Compare every figure, including the ones
that look unchanged. A match is a result. Leaving a state or a constant
unchecked is not.

Replace only the base-year constants below. Leave the projection rules alone.
Future years still inflate contribution limits by `INFLATION`. Brackets,
deductions, IRMAA, and state rates stay in base-year dollars for every
projected year. Do not invent an inflation path for them.

Do not change formulas, the solver, the spendable-total definition, or the
IRMAA two-year lookback as part of this update. If a figure is not in a
primary source, leave the old number and name the figure as not verified.

## Sources

Use the primary document only. Record its name and date in the comment you
update. Do not copy a blog, a tax-software screenshot, or last year's number
plus 3%.

| What | Where it is published |
|---|---|
| Federal brackets, standard deduction, extra standard deduction for age 65 | IRS newsroom, "tax inflation adjustments for tax year YYYY", and the Revenue Procedure it cites |
| Extra $6,000 senior deduction (OBBBA) and its phaseout | That same Revenue Procedure, or the statute if the provision changed |
| 401(k), IRA, HSA limits and catch-up amounts | IRS newsroom COLA release for retirement plans, same season |
| IRMAA brackets and monthly Part B / Part D surcharges | CMS fact sheet, "YYYY Medicare Part B premiums and deductibles" |
| Georgia rate, standard deduction, retirement exclusion | O.C.G.A. § 48-7-27 and the Georgia Department of Revenue rate notice |
| Any state, including states with no wage tax | That state's department of revenue or statute for the tax year. Check every state. A rate you expect is unchanged still has to be compared |
| RMD table and starting ages | Do not touch unless Treasury changed Treas. Reg. § 1.401(a)(9)-9 or Congress changed the SECURE ages |
| Social Security taxability thresholds | Do not touch. IRC § 86 is not indexed |

## What moves together

Annual figures have one copy each.

Edit `src/lib/retirement/tax-year.ts` only, except state rate schedules:

- `TAX_YEAR`
- `STANDARD_DEDUCTION`, `AGE_65_DEDUCTION`, `SENIOR_DEDUCTION`
- `CONTRIBUTION_LIMITS`, `CATCH_UP`
- `IRMAA_TIERS` and `IRMAA_TIER5`. Change tier 5 only in `IRMAA_TIER5`. Tier 4's `singleMax` / `jointMax` is that start minus one cent. Leave that expression. Set tier 4's `singleCap` / `jointCap` to the published whole-dollar ceiling inside the tier. `IRMAA_SINGLE`, `IRMAA_MARRIED`, and `IRMAA_CAP_TIERS` are derived. Do not write them out again.
- `GEORGIA`. The calculation uses this object, not the `GA` entry in the state table.
- `SINGLE_BRACKETS` and `MARRIED_BRACKETS`

`INFLATION` stays. It is the projection assumption, not the COLA.

State wage-tax schedules are `STATE_BRACKETS` in `src/lib/retirement/state-schedules.ts`. The States section below is the check. Do not treat a joint bracket as double the single one unless that state's own table is exactly double.

Do not edit `engine.ts` or `optimize.ts` to change a dollar amount. Both import these files. `engine.ts` re-exports `TAX_YEAR` as `CURRENT_YEAR`. The census reads `SENIOR_DEDUCTION` and divides `amount` by the width of the phaseout, so there is no slope constant to update. Default Roth, HSA, and 401(k) contributions read `CONTRIBUTION_LIMITS` and `CATCH_UP`. The HSA default per spouse is `hsaFamily / 2`. Catch-up amounts are not inflated. The taxable account's $24,000 contribution is sample data. Leave it.

When the year changes, update the year and the source citation in the comments on `IRMAA_TIERS` and `GEORGIA`.

## Federal brackets

Keep the shape `{ rate, min, max, baseTax }`. Keep the tax formula in
`federalTax`. It taxes a bracket as `(taxable - min + 1) * rate`.

- The 10% bracket starts at `min: 0`.
- Every later `min` is the previous `max` plus 1.
- `max` is the last taxable dollar of that bracket. The top bracket's `max` is `Infinity`.
- `baseTax` is the tax this same formula charges on `min - 1` dollars. Recompute it. Do not paste a cumulative tax from a table that uses a different convention.

Check, for both filing statuses: each bracket's `baseTax` equals the tax on `min - 1`, and `min` equals the previous `max + 1`.

## IRMAA

Amounts are the monthly surcharge per person, not the base Part B premium.
Tier 0 is `0`. `singleMax` / `jointMax` are inclusive. A MAGI equal to
`IRMAA_TIER5` is tier 5. `singleCap` / `jointCap` are the whole-dollar
conversion ceilings and stay inside the tier.

## States

Walk every key in `STATE_BRACKETS`. Do not stop after the states that look wrong.

`STATE_BRACKETS` stores the single schedule and the joint schedule separately. Compare both with that state's own tables. Do not assume a joint bracket is double the single bracket. Store a separate joint schedule when it is not exactly double. A flat tax uses the same one-row schedule for both statuses. An empty schedule means no wage tax; confirm the state still does not tax wages, and leave it empty.

Enter the dollars in effect for `TAX_YEAR`, not the dollars in the newest bill.

- A law can pass now and first apply in a later year. Keep this year's numbers, and name the year the new ones start.
- A law already on the books can change this year's dollars without a new bill: a scheduled step-down, a delayed effective date, or a required inflation adjustment. Update those.
- If a bill passed and the dollars in effect for `TAX_YEAR` are unchanged, leave the numbers and say so.

Georgia does not use this table: its taxable income is `georgiaTaxable`, then `GEORGIA.rate`. Ohio's $332 bracket adjustment is applied in `stateTax`, not by the rows alone. If either of those formulas no longer matches the statute, say so. Do not quietly change `engine.ts` as part of a numbers update.

The schedules are marginal rates. They are not a full state return. Do not add a state's standard deduction, exemptions, or credits unless the tax function is changed to use them. The file header in `state-schedules.ts` lists the calculations that are deliberately left out. If a state's law only fits by changing that list, report it instead of inventing a formula.

## Leave these alone

- `taxableSocialSecurity` thresholds (`25000 / 32000 / 34000 / 44000`, and the `4500 / 6000` caps)
- `rmdStartAge` and `RMD_FACTORS`
- `INFLATION`
- The 10% extra tax before 60 and the 20% HSA penalty before 65 in `spendableTotal`
- Medicare eligibility at 65, the age-60 Roth conversion gate, and the two-year IRMAA lookback
- Solver tolerance, piece size, and `optimize.ts`. It imports the brackets. It has no copies of them.

## Finish

1. Run `npx tsc --noEmit`.
2. Run the bracket continuity check above.
3. Quote one official federal-tax or IRMAA example and show the function returns that amount.
4. In the summary, account for every constant in `tax-year.ts` and every state in `STATE_BRACKETS`:
   - Changed: old value, new value, and the document.
   - Unchanged: say that it matched the source. Group the matches. Do not omit them.
   - Not verified: the figure you left in place and the source you could not find.
   A summary that only lists edits is incomplete.
