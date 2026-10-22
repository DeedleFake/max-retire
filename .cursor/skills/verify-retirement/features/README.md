# Maximize My Retirement verification map

Read this index, then use one feature file as the recipe. The helper is `node scripts/verify-retirement.mjs`.

## Baseline preconditions

- The page is `http://127.0.0.1:8080/`.
- `node scripts/verify-retirement.mjs doctor` has printed `"ok": true`.
- The browser is a new Playwright context. Do not drive the live preview iframe.
- Maximize ending money starts off. Leave it off unless the feature is maximize.
- Do not stop port 8080 unless this run created `artifacts/verify-retirement/run/server.pid`.

## Driving conventions

- Start from a fresh page load unless the feature says otherwise.
- Use `data-testid` values named in the feature file.
- Quote the helper commands as written.
- One feature per command. Do not claim a second feature because the same page showed it.

## Proof and skip reporting

- Record the action and the resulting state in `artifacts/verify-retirement/<feature>/action.json`.
- Keep the screenshot next to that file.
- A skipped entry point is not verified by a different control.
- If a precondition is missing, stop and write the failed command. Do not change the journey so it passes.

## Features

- [Taxable balance](./balance.md) changes Current Balance and checks the summary spendable cell.
- [Adjusted gross income](./agi.md) sets AGI and checks Only the first year against two summary years.
- [Save and load](./save-load.md) downloads the plan file and loads that same file back.
- [Guide](./guide.md) downloads the user guide PDF from the header.
- [Maximize ending money](./maximize.md) turns the maximizer on and waits for a finished status. No helper command. The solver can take about 60 seconds.
