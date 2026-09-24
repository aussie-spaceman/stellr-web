# Handover — email-signature logo (24 Sept 2026)

TRACKER: Session 14. PR #179 (`749ccf6`), promoted in #183 (`e2a99e3`).

## What happened

A recipient at UNLV (Rachel De Vera) replied to David's 24 Sept "UNLV + Stellr //
In-Curriculum Campaigns" email that his signature "looks broken". The email was
written in Outlook for Mac and scheduled from Gmail web, because Outlook for Mac
cannot schedule.

The sent copy (read via the Gmail connector) showed the cause. The HTML body
referenced two images as `cid:` parts: the signature logo and a member-portal
screenshot. But the message carried only the two PDF attachments. Gmail keeps
Outlook's `<img src="cid:…">` references when it opens an Outlook draft, but it
drops the inline MIME parts they point to. The recipient saw an empty 1px-bordered
box for the logo and an "image.png" placeholder for the screenshot.

## What was done

- **Logo hosted on the site:** `public/email/signature-logo.png`, served at
  `https://www.stellreducation.org/email/signature-logo.png`. It is 350×400, shown
  at 175×200, opaque white so it survives dark mode, and 47,770 bytes, SHA-1
  `9b26c0ac…`. The proxy matcher excludes `.png`, so it is served on every host.
  Checked live after promotion: `200 image/png`, byte-identical.
- **Signature HTML:** loads the logo by URL instead of `cid:`. The master copy is on
  the shared drive: `Shared drives/Stellr/8 Media + Collateral/Stellr email
  signature.html`. It is installed in Outlook for Mac and Gmail web, and the
  maintainer confirmed both routes work, including Outlook draft → Gmail
  schedule.

## ⚠ This file is load-bearing and nothing in the code references it

`public/email/signature-logo.png` is referenced **only by emails already sent**.
No code, page or test points at it, so a grep-based cleanup will call it unused.
Deleting it, renaming it or moving it breaks the logo in **every email David has
already sent** with this signature, as well as future ones.

- **Do not** delete, rename or move it. This handover and TRACKER 14.1 are its
  references.
- **To change the logo:** replacing the file at the same path changes it in
  every past email too, because mail clients fetch it when the email is opened.
  If the old emails should keep the old logo, add a new filename and update the
  signature instead.

## Still open

See TRACKER Session 14. None of these items is code.
