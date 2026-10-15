---
name: update-tax-year
description: >
  Update this retirement planner from one tax year to the next. Use when asked
  to refresh tax brackets, the standard deduction, IRMAA, 401(k)/IRA/HSA
  limits, catch-up amounts, Georgia retirement exclusions, or any other
  state's income-tax table. Triggers on "update taxes", "new tax year",
  "2027 brackets", "IRMAA update", "contribution limits", "COLA".
---

# Update the planner to a new tax year

The calculator does not fetch tax law. A year update replaces the base-year
constants below and leaves the projection rules alone. Future years still
inflate contribution limits by `INFLATION`. Brackets, deductions, IRMAA, and
state rates stay in base-year dollars for every projected year. Do not invent
an inflation path for them.

Do not change formulas, the solver, the spendable-total definition, or the
IRMAA two-year lookback as part of this update. If a figure is not in a
primary source, leave the old number and say which source was missing.

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
| Any other state | That state's department of revenue for the tax year. Skip a state you cannot source |
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

State rate schedules are `STATE_BRACKETS` in `src/lib/retirement/tax-tables.ts`. Update a state only when that state's law changed. An empty list means no wage tax. For a state with more than one bracket, `stateTax` doubles those widths for a joint return. Flat rates are not doubled.

Do not edit `engine.ts` or `optimize.ts` to change a dollar amount. Both import this file. `engine.ts` re-exports `TAX_YEAR` as `CURRENT_YEAR`. The census reads `SENIOR_DEDUCTION` and divides `amount` by the width of the phaseout, so there is no slope constant to update. Default Roth, HSA, and 401(k) contributions read `CONTRIBUTION_LIMITS` and `CATCH_UP`. The HSA default per spouse is `hsaFamily / 2`. Catch-up amounts are not inflated. The taxable account's $24,000 contribution is sample data. Leave it.

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

`STATE_BRACKETS` stores one width. For a state with more than one bracket,
`stateTax` doubles those widths for a joint return. Flat rates are not
doubled. Georgia does not use that path: its taxable income is
`georgiaTaxable`, then `GEORGIA.rate`.

An empty bracket list means no wage tax. Leave those empty.

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
4. In the summary, list each constant you changed, its old value, its new value, and the document it came from. List anything you deliberately did not change because the source was missing or the statute did not move.
