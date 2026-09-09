# DocuSign Connect setup

How to configure DocuSign Connect (DocuSign's webhook system) so envelope status
and **per-signer progress** flow back into Stellr. This is what drives the
DocuSign status pills on the Event Management roster and the member portal.

> Connect config lives in the DocuSign admin console, **per environment** — the
> demo (sandbox) and production accounts each need their own configuration.
> Endpoint and HMAC key are the only Stellr-side dependencies.

---

## Data flow

```
DocuSign  ──(event POST)──▶  /api/webhooks/docusign  ──▶  docusign_envelopes  ──▶  status pills
```

Handler: [`app/api/webhooks/docusign/route.ts`](../app/api/webhooks/docusign/route.ts). It:

1. Verifies the `x-docusign-signature-1` HMAC header against `DOCUSIGN_CONNECT_HMAC_KEY` (rejects with **401** on mismatch).
2. On **envelope** events (`envelope-sent`, `envelope-completed`, `envelope-declined`, `envelope-voided`, …) → updates the row's `status`; on `envelope-completed` sets `signers_completed = signers_total`.
3. On the **recipient** event `recipient-completed` → re-counts signers via the DocuSign recipients API ([`getEnvelopeSignerProgress`](../lib/docusign.ts)) and writes `signers_total` / `signers_completed`. Idempotent — it recounts rather than increments, so duplicate deliveries are safe.

The pill arithmetic ([`lib/event-admin.ts`](../lib/event-admin.ts), and the portal's `DocusignsSection`):

| `signers_completed` | Pill |
|---|---|
| `0` of N | 🔴 Issued |
| `>0` and `< N` | 🟠 Partially complete |
| `= N` | 🟢 Complete |

---

## Required configuration

- **Endpoint URL:** `https://www.stellreducation.org/api/webhooks/docusign`
  (both subdomains serve the same deployment; `www` is what the live configs use)
- **Format:** JSON / REST (**"Aggregate"**) — the handler parses `payload.event` and `payload.data.envelopeId` from JSON. The legacy XML/SOAP format will **not** parse.
- **HMAC:** enable HMAC signing on the config; the key must equal Vercel's `DOCUSIGN_CONNECT_HMAC_KEY`.
- **Trigger events:**
  - Envelope: **Completed**, **Declined**, **Voided** (and Sent/Delivered if you want those statuses).
  - Recipient: **Recipient Signed/Completed** ← sends `recipient-completed`. **This one is required for the 🟠 "partially complete" pill.** Without it the count never moves off `0` until the whole envelope completes, so a 2-signer minor consent jumps 🔴 → 🟢 and never shows 🟠.
  - Recipient: **Delivered** ← `recipient-delivered`. Distinguishes "has never opened the signing link" from "opened it and hasn't signed". Drives the "never opened" wording in the roster and the chase emails.
  - Recipient: **AutoResponded** ← `recipient-autoresponded`. This is DocuSign reporting a **bounced address**. Without it a dead guardian email is indistinguishable from a slow one and gets chased forever; with it the roster shows 🔴 Email Bounced and admins are alerted once.

> Live configurations (9 Sept 2026): production `21769859`, sandbox `22193922`.
> Both point at the `www` endpoint. Delete the sandbox one once remediation is finished —
> until then it is a demo account posting into the production webhook.

No recipient data needs to be included in the payload — the handler re-fetches recipients from the API, so the minimal envelope payload is enough.

---

## Enable it (DocuSign admin console)

1. **Settings → Connect.** Open the custom configuration pointing at the endpoint above, or create one (Add configuration → Custom).
2. Set the **URL to publish to** = the endpoint URL; set **data format = JSON**.
3. Under **Trigger Events**, tick the envelope events and — crucially — the **recipient "Signed/Completed"** event.
4. Enable **Include HMAC Signature** and set the key to match `DOCUSIGN_CONNECT_HMAC_KEY`.
5. Save.

---

## Verify

- **Settings → Connect → Logs** shows each delivery and your endpoint's HTTP response — look for `recipient-completed` posts returning **200**.
- End-to-end: register a test minor, have **only** the parent sign → the Event roster and the member portal should both flip to 🟠 within seconds; after the minor signs too, 🟢.
- `GET /api/webhooks/docusign` returns `{ ok: true }` (handy liveness check; the real events are POSTs).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No status updates at all | Wrong endpoint URL, XML format instead of JSON, or HMAC mismatch (check Connect logs for 401s). |
| Status updates work, but pill never goes 🟠 | The **recipient** "Signed/Completed" event isn't subscribed (only envelope events are). |
| `signers_completed` stuck at `0` on an old envelope | It was in flight before the recipient event was enabled. The count recomputes on its **next** signing event — it won't backfill retroactively. |
| `signers_total` looks wrong | Set at creation ([`lib/docusign.ts`](../lib/docusign.ts) `signerCount`); coverage/on-file rows are `1`. Requires migration `032`. |

---

## Related

- Env vars + the broader DocuSign go-live promotion: [GO-LIVE-CHECKLIST.md](./GO-LIVE-CHECKLIST.md) §4.
- Signer-progress columns: migration `032_docusign_signer_progress.sql`.
