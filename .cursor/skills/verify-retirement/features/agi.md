# Adjusted gross income

Adjusted Gross Income feeds the summary AGI column. Only the first year limits that amount to the first projection year.

## Sub-features

- `agi-every-year` puts the typed amount on the first year and the next year.
- `agi-first-only` leaves the first year in place and changes the next year after the box is checked.

## How to get to it (user POV)

- Open the page.
- Edit Adjusted Gross Income in Personal Information.
- Check Only the first year.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.
- Maximize ending money is off.
- Only the first year starts unchecked.

- **Enter AGI.** Choose the field `input-agi`. Type `300000` and leave the field.
- **Read two years.** Let `<year>` be the first `row-summary-<year>`. Read `text-agi-<year>` and `text-agi-<year+1>`.
- **Check the box.** Choose `checkbox-agi-first-year`.
- **Read two years again.** `text-agi-<year>` must match the first read. `text-agi-<year+1>` must differ from its first read.
- **Proof.** Run `node scripts/verify-retirement.mjs drive agi`. `artifacts/verify-retirement/agi/action.json` must show `firstAfter` equal to `firstBefore`, and `laterAfter` different from `laterBefore`. `page.png` is the page after the check.

## Gotchas

- The checkbox label is Only the first year. The test id is `checkbox-agi-first-year`.
- The amount commits while typing. A status line is not the proof. The AGI cells are the proof.
- Do not turn Maximize ending money on for this feature. The solver is a different journey.
