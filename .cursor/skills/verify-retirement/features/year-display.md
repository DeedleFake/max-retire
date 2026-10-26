# Year display

The summary names the year you select. The Age column puts parentheses on a person's age in every year after that person's longevity year. The year of death stays a joint return. The next year is a single return.

## Sub-features

- `year-labels` shows 2026 on the spendable box and the bracket box, and says the first year is Married Filing Jointly.
- `age-after-death` shows `80/75` in 2035 and `(81)/76` in 2036 after Longevity (Primary) is 80.
- `filing-after-death` says 2036 is a Single filing, on the bracket box and on the 401(k) table's IRMAA panel.

## How to get to it (user POV)

- Open the page. The Summary tab of Year-by-Year Projection is already selected.
- Read the year under How the spendable amount was calculated, and the year under Federal tax paid in each bracket.
- Set Longevity (Primary) to 80.
- Read the Age cell for 2035 and for 2036.
- Choose 2036 in the summary.
- Open the 401(k) table and choose 2036 there too.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.
- Maximize ending money is off.
- Longevity (Primary) starts at 100. Spouse longevity stays 100.

- **Read the first year.** `text-spendable-year` and `text-bracket-year` are `2026`. `text-bracket-filing` is `These taxes are calculated for Married Filing Jointly.` The Age cell in `row-summary-2026` is `71/66`.
- **Set longevity.** Choose `input-longevity-age`. Select the current number, delete it, type `80`, pause, then leave the field. The field shows `80`.
- **Read the ages.** The Age cell in `row-summary-2035` is `80/75`. The Age cell in `row-summary-2036` is `(81)/76`. The same `(81)/76` is the Age cell in `row-rothIra-2036`, `row-hsa-2036`, `row-fourOhOneK-2036`, and `row-taxable-2036`. Open each table with `tab-summary`, `tab-table-rothIra`, `tab-table-hsa`, `tab-table-401k`, or `tab-table-taxable` before reading that row.
- **Read the single filing.** Choose `row-summary-2036`. `text-bracket-year` is `2036`. `text-bracket-filing` is `These taxes are calculated for a Single filing.`
- **Read the IRMAA line.** Open `tab-table-401k` and choose `row-fourOhOneK-2036`. The panel says `Filing status for 2036 is Single.`
- **Proof.** Run `node scripts/verify-retirement.mjs drive year-display`. `artifacts/verify-retirement/year-display/action.json` records those strings. `page.png` is the page after the IRMAA line.

## Gotchas

- Longevity (Primary) commits when the field loses focus. One-shot replacement of the field can leave 100 in place. Type the digits, pause, then leave the field, and read the field back.
- The longevity year has no parentheses. The next year does. Spouse longevity is still 100, so 76 has no parentheses.
- The IRMAA filing sentence is on the 401(k) table tab. Choosing a year on Summary does not change that sentence.
- Do not turn Maximize ending money on. That search is a different journey.
