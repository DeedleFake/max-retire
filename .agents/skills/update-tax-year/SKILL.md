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

Change every copy of a number. A census constant that still has last year's
value will make the maximizer disagree with the table.

In `src/lib/retirement/engine.ts`:

- `CURRENT_YEAR`
- `STD_SINGLE`, `STD_MARRIED`
- `additionalStdDeduction` (age-65 extra deduction: single, and one or both spouses)
- `seniorBonus` and the matching census fields `seniorLow`, `seniorHigh`, `seniorFull`, `seniorSlope`. The slope is `full / (high - low)` for one person and for both.
- `BASE_LIMIT`, `HSA_FAMILY`, `catchUp`
- `createAccounts`: the Roth, HSA, and 401(k) `annualContribution` expressions must stay equal to those limits. HSA is `HSA_FAMILY / 2` per spouse. The taxable `24000` is sample data, not a limit. Leave it.
- `defaultInputs`: `retirementYear` and `marriageYear` stay equal to `CURRENT_YEAR`
- `IRMAA_TIERS`, `IRMAA_SINGLE`, `IRMAA_MARRIED`. Tier 0's `singleMax` / `jointMax` are those two constants. The tier-5 test in `irmaaTierFor` (`500_000` / `750_000`) must stay equal to the income where tier 5 starts.
- `georgiaRetirementCap`, the deduction inside `georgiaTaxable`, `gaDeduction`, and `gaRate`

In `src/lib/retirement/tax-tables.ts`:

- `SINGLE_BRACKETS` and `MARRIED_BRACKETS`
- `STATE_BRACKETS`, including `GA`, whose single rate must equal `gaRate`
- The file's year comment

Comments that name the old year get the new year. Do not rename `INFLATION`.

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
Tier 0 is `0`. `singleMax` / `jointMax` are inclusive. Tier 4's max stays a
fraction below the tier-5 threshold so a MAGI of exactly that threshold is
tier 5, matching `irmaaTierFor`. `singleCap` / `jointCap` are the whole-dollar
conversion ceilings and stay inside the tier.

## States

`STATE_BRACKETS` stores one width. For a state with more than one bracket,
`stateTax` doubles those widths for a joint return. Flat rates are not
doubled. Georgia does not use that path: its taxable income is
`georgiaTaxable`, then `gaRate`.

An empty bracket list means no wage tax. Leave those empty.

## Leave these alone

- `taxableSocialSecurity` thresholds (`25000 / 32000 / 34000 / 44000`, and the `4500 / 6000` caps)
- `rmdStartAge` and `RMD_FACTORS`
- `INFLATION`
- The 10% extra tax before 60 and the 20% HSA penalty before 65 in `spendableTotal`
- Medicare eligibility at 65, the age-60 Roth conversion gate, and the two-year IRMAA lookback
- Solver tolerance, piece size, and anything under `optimize.ts` except where a changed constant flows in through `engine.ts`

## Finish

1. Run `npx tsc --noEmit`.
2. Run the bracket continuity check above.
3. Quote one official federal-tax or IRMAA example and show the function returns that amount.
4. In the summary, list each constant you changed, its old value, its new value, and the document it came from. List anything you deliberately did not change because the source was missing or the statute did not move.
