---
name: verify-retirement
description: Drive Maximize My Retirement in a browser and prove a user-facing change. Use after a change to the planner page, the projection table, plan save and load, the AGI control, or the Guide download.
---

# Verify Maximize My Retirement

The surface is the web page. There is no CLI. Plan state lives in the page, not on the server. A private browser does not change the live preview. Do not stop port 8080 unless `launch` wrote `artifacts/verify-retirement/run/server.pid`.

Auth is off. The projection does not read a database. An empty browser profile is a usable plan. The defaults are married filing, birth year 1955, spouse birth year 1960, Georgia, and Maximize ending money off.

## Launch

From `/workspace`:

```
node scripts/verify-retirement.mjs doctor
```

If the doctor report has `"ok": false` because nothing is listening, start the server and doctor again:

```
node scripts/verify-retirement.mjs launch
```

Wait until `doctor` prints `"ok": true` and `"title": "Maximize My Retirement"`. Ready means the heading, a `row-summary-<year>` row, and the Save button's client handler are all present. The heading and the row are in the server HTML before a click does anything. A TCP accept is not ready.

`launch` runs `npm run dev` in `/workspace`, which is Vite on `0.0.0.0:8080`. It records the child pid in `artifacts/verify-retirement/run/server.pid`. If that file already exists, `launch` does not start a second server.

If doctor is already ok, do not launch. The preview already owns 8080.

## Doctor

Run `node scripts/verify-retirement.mjs doctor` before any drive when the page looks wrong. It writes `artifacts/verify-retirement/doctor.json` and exits 0 only when a private browser can read the heading `Maximize My Retirement`, the first summary row, and the Save button's client handler. The server HTML shows the heading and the row before that handler exists. The handler check looks for a `__reactProps` field on `button-save-plan`. Vite dev adds that field. A production bundle does not, so this doctor is for `npm run dev`. `ownedByThisRun` is true only when this verification run started the server.

## Drive

Run one feature from `features/`. The helper is Playwright, headless, viewport 1440 by 1000, against `http://127.0.0.1:8080/`.

```
node scripts/verify-retirement.mjs drive balance
node scripts/verify-retirement.mjs drive agi
node scripts/verify-retirement.mjs drive save-load
node scripts/verify-retirement.mjs drive guide
node scripts/verify-retirement.mjs drive year-display
```

Use the test ids in the feature file. Do not click by pixel. Do not call `setInputs` or post a plan into the worker. The path is the controls on the page.

A drive that passes prints `{"ok": true, ...}` and writes `artifacts/verify-retirement/<feature>/`. A drive that fails exits non-zero. Do not mark the feature verified.

Maximize ending money is not a helper command. It starts a solver that can run for about 60 seconds and can replace the table more than once. Drive it only from `features/maximize.md`, in its own browser, and do not treat a progress table as the final table.

## Evidence

Each drive writes under `artifacts/verify-retirement/<feature>/`.

- `action.json` records the action and the state that followed.
- `page.png` is the page after that state.
- `balance` also writes `before.txt` and `after.txt`, the spendable cell text.
- `save-load` also writes `retirement-plan.json`, the file the Save button downloaded.
- `guide` also writes `guide.pdf`, the file the Guide link downloaded.

Proof is the action plus the resulting state. A screenshot with no `action.json` is not proof. A status string with no re-read of the changed value is not proof. Do not mock HiGHS or the tax functions.

## Cleanup

```
node scripts/verify-retirement.mjs cleanup
```

If `server.pid` exists, cleanup sends `SIGTERM` to that pid only. It then deletes `artifacts/verify-retirement/run/`. It does not delete `doctor.json`, feature directories, or screenshots. It does not kill a server it did not start.

## Helpers

`scripts/verify-retirement.mjs` is the only helper. Invoke it as shown above. `doctor`, `launch`, and `cleanup` take no feature argument. `drive` requires `balance`, `agi`, `save-load`, `guide`, or `year-display`.
