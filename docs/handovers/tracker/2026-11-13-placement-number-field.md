# Editable numbers on the artwork position sliders — 2026-11-13

Slug: `placement-number-field`. Handover: `HANDOVER-placement-number-field-2026-11-13.md`. Doc snapshot: `1-MF39ZjndKVtrzC_SI3ekYhxAFWajKCOD6csvnH50yg`.
PR #685 → `dev` as `04d21fce`; not promoted (owner promoting from another session). Migration: none.

Every name-position slider on event certificates, name badges and PD certificates now has a typed number beside it (%, or pt for size); out-of-range numbers snap to the slider's ends.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| placement-number-field.1 | Promote #685 to production | On `dev` as `04d21fce`; not in `main`. Owner said it will be promoted in another session. | Include in the next promotion; after it, type a value on `/admin/competitions/artwork` in prod. | ☐ |
| placement-number-field.2 | See the name move on the rendered preview | Controls verified by Playwright locally; the PDF preview iframe is blank headless, so the artwork was not seen to change. | On the `dev` site, open a badge "Position the name", type a new height, and watch the preview move. | ☐ |
| placement-number-field.3 | Phone-width layout of the slider field | Not looked at; the number box adds width to the label row. | Check the artwork page at 375px; wrap or shorten if the label row overflows. | ☐ |
