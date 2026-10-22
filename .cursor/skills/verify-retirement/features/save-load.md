# Save and load

Save downloads the current plan as JSON. Load reads a JSON file back onto the page and shows who it came from.

## Sub-features

- `plan-save` downloads `retirement-plan.json` from the Save button.
- `plan-load` loads that file through the hidden file input and shows a Loaded from status.

## How to get to it (user POV)

- Choose Save in the header.
- Choose Load in the header and pick a JSON file.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.
- The page is a fresh load, so Load does not open the replace confirmation.

- **Save.** Choose Save, test id `button-save-plan`, accessible name Save plan. The browser downloads a file.
- **Keep the file.** The download body contains `birthYear`.
- **Load.** Set that file on `input-load-plan`. Do not click Load in a way that opens a native dialog the helper cannot see. The file input is the user path the button uses.
- **Read the status.** `text-plan-transfer-status` must start with `Loaded from`.
- **Proof.** Run `node scripts/verify-retirement.mjs drive save-load`. It writes `artifacts/verify-retirement/save-load/retirement-plan.json`, `action.json`, and `page.png`. `action.json` field `status` must start with `Loaded from`.

## Gotchas

- If the page was edited and the loaded JSON differs, the page calls `window.confirm` before replacing the plan. A fresh load does not. Do not dismiss a confirm by weakening the file.
- Copy and Paste use the clipboard. They are not this feature.
- The status text alone is not enough. The saved file has to be the file that was loaded.
