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
- **Check the file.** The bytes start with `%PDF` and the file is longer than 1000 bytes.
- **Proof.** Run `node scripts/verify-retirement.mjs drive guide`. It writes `artifacts/verify-retirement/guide/guide.pdf`, `action.json`, and `page.png`. `action.json` field `bytes` is the PDF size.

## Gotchas

- The control is a link, not a button. Its accessible name is Guide.
- A click that only navigates the preview iframe is not this proof. The proof is the downloaded file.
