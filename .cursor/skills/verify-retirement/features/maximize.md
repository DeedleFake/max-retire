# Maximize ending money

Maximize ending money searches for Roth conversions and then shows the projection of the plan it kept. The status box under the title tells whether that search is still running.

## Sub-features

- `maximize-on` shows the status box after the switch is turned on.
- `maximize-done` replaces that running text with a finished status and leaves summary rows on the page.

## How to get to it (user POV)

- Open the primary 401(k) tab.
- Turn on Maximize ending money.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.
- This journey has its own browser. Do not share it with another drive.
- There is no `drive maximize` helper. Run the steps below with Playwright. Do not invent a shorter path through `solveOptimalPlan`.

- **Open 401(k).** Choose `tab-fourOhOneK`.
- **Turn the switch on.** Choose `switch-optimize-distributions`.
- **See it running.** `text-optimize-status` appears. Its text includes `Maximizing` while the search runs.
- **Wait for the finish.** The same status leaves the Maximizing text. The wait can be 60 seconds. Do not stop at the first table update. Progress rows are not the finished plan.
- **Read the table.** At least one `row-summary-<year>` is still present.
- **Proof.** Write `artifacts/verify-retirement/maximize/action.json` with the running text, the finished text, and the year of the first summary row. Save `page.png` after the finished text. Cleanup must leave those files.

## Gotchas

- The switch lives on the primary 401(k) panel, not in the header.
- A progress message can post several tables before the finished status. The finished status is the proof.
- If the status says the exact search did not finish, record that text and stop. Do not flip the switch off to force a green result.
- Do not kill the preview server because this search is slow.
