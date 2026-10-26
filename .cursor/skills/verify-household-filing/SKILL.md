---
name: verify-household-filing
description: "Check householdYear against the filing rule for every household in a fixed bound. Use after a change to householdYear, livingTaxpayer, the projection filing status, or the solver census tax ages."
---

# Verify household filing

A year files jointly only while the filing menu is married, the marriage has started, and both people are living. The longevity year still counts as living. The next year is single. The survivor is the taxpayer only when that marriage has started, the primary is dead, and the spouse is living. A wrong year uses the wrong tax for every later row.

## When a change needs this check

Run the check when a change edits any of these.

- `livingTaxpayer` or `householdYear` in `src/lib/retirement/engine.ts`
- the filing status `runProjection` copies from `householdYear`
- `filing`, `taxAge`, or `taxSpouseAge` that `optimizerCensus` copies from `householdYear`

Skip the check when the change touches none of those.

## Run

From `/workspace`, run this command.

```
node scripts/check-household-filing.mjs
```

The command loads `householdYear` from `src/lib/retirement/engine.ts` with jiti. It does not start the page. A pass prints one JSON line with `"ok": true` and exits 0. A miss prints the household and the year, then exits 1.

## Bound

The command checks every combination below, and every calendar year from one year before the earliest birth or marriage through one year after the later death.

- Primary birth year 1955 through 1960.
- Filing menu married, and filing menu single.
- Spouse birth year omitted, or 0, 5, or 10 years after the primary birth.
- Primary longevity age 70 through 100.
- Spouse longevity age 70 through 100 when a spouse birth year is set. When the spouse birth year is omitted, spouse longevity stays 100 and does not change the result.
- Marriage year omitted, or every year from the primary birth year through 30 years after it.

The last passing run checked 1118976 households and 107624448 years.

## How to read a miss

The printed sentences are the counterexample. They name the births, the longevity ages, the menu, the marriage year, and the calendar year. They name the filing, the taxpayer age, and who is alive under the rule, then those same fields from `householdYear`.

Do not edit the rule so the command passes. If the rule disagrees with the tax law this planner uses, fix the rule and say what you changed. If the function disagrees with the rule, report the miss. Do not change product code unless the user asks.

## What a pass does not cover

The check does not run the projection, the solver, or the page. It does not prove dollar tax, the standard deduction, IRMAA, or the Georgia exclusion. It does not prove the 20 dollar gap between the solver score and `simulatePlan`. Qualifying surviving spouse and head of household are out of scope. This planner has no child, and those statuses need one.

The bound leaves out a primary birth before 1955 or after 1960, a spouse born before the primary or more than 10 years later, a longevity under 70 or over 100, and a marriage more than 30 years after the primary birth.

Spouse account balances stay active after death when the marriage has started. This check does not compare `spouseAccountsActive`.

## Kept in step with the code

The check covers `livingTaxpayer` and `householdYear` in `src/lib/retirement/engine.ts`. `runProjection` and `optimizerCensus` in that file are the callers that must keep using the result.

Last confirmed at commit `374a3833b3f55f672756e6811c01174f89ddfee8`. That commit contains the functions this check describes. Move the commit forward only after you read those functions at the new commit and confirm the check still describes them. If the working tree differs from that commit in those functions, the recorded commit is stale.

## See it fail

Change `livingTaxpayer` so the longevity year is already dead, using `year < birthYear + longevityAge`. The check must exit 1. The first miss is primary birth 1955, longevity 70, no spouse birth year, no marriage year, calendar year 2025. The rule says the primary is alive. `householdYear` says the primary is dead.

On that same broken comparison, default inputs with primary longevity 80 file 2035 as single and treat the primary as dead. Restore `year <= birthYear + longevityAge`. The check must pass again. Do not leave the broken comparison in the file.
