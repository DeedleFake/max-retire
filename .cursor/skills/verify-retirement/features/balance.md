# Taxable balance

Current Balance on the Taxable account changes the summary spendable amount for the first projection year.

## Sub-features

- `balance-open` shows the Taxable account fields.
- `balance-edit` sets Current Balance to 500000.
- `balance-summary` shows a different spendable amount for the first summary year.

## How to get to it (user POV)

- Open the page. The primary person is already selected.
- Choose the Taxable tab in the account list.
- Edit Current Balance.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.
- Maximize ending money is off.

- **Read the summary.** Load the page. The first row test id is `row-summary-<year>`. The spendable cell is `text-spendable-<year>`. Record its text.
- **Open Taxable.** Choose the Taxable tab. Its test id is `tab-taxable`.
- **Enter the balance.** Choose Current Balance, test id `input-taxable-balance`. Type `500000` and leave the field. The projection updates on the typed value, not on blur. Blur is still required so the field shows the committed number.
- **Read the summary again.** `text-spendable-<year>` for the same year must differ from the first read.
- **Proof.** Run `node scripts/verify-retirement.mjs drive balance`. It writes `artifacts/verify-retirement/balance/before.txt`, `after.txt`, `action.json`, and `page.png`. `action.json` fields `before` and `after` must differ, and `entered` must be the field value after the edit.

## Gotchas

- Taxable exists only on the primary person. The spouse tabs have no Taxable tab.
- The default first-year spendable cell can read `$0`. The proof is that the two reads differ. Do not require a specific dollar amount.
- The summary year is 2026 while `TAX_YEAR` is 2026. Read the row test id. Do not hardcode a year in a new assertion if the row id disagrees.
