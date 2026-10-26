# Guide

Guide in the header downloads the user guide PDF.

## Sub-features

- `guide-download` saves a PDF from the Guide link.

## How to get to it (user POV)

- Choose Guide in the header, to the left of Copy.

## Driving it with verify-retirement

Preconditions:

- Doctor is ok.

- **Download.** Choose the link `link-user-guide`. The browser downloads a file.
- **Check the file.** The saved name is `Maximize My Retirement User's Guide.pdf`. The bytes start with `%PDF`, the file is longer than 1000 bytes, and the bytes include the title `Maximize My Retirement User's Guide`.
- **Proof.** Run `node scripts/verify-retirement.mjs drive guide`. It writes `artifacts/verify-retirement/guide/guide.pdf`, `action.json`, and `page.png`. `action.json` fields `bytes`, `filename`, and `title` are the PDF size, the saved name, and that title.

## Gotchas

- The control is a link, not a button. Its accessible name is Guide.
- A click that only navigates the preview iframe is not this proof. The proof is the downloaded file.
