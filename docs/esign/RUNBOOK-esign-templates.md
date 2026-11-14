# Runbook: Stellr signing templates

How documents are prepared, published and approved for Stellr signing, the
in-app e-signature engine. Plan: `docs/PLAN-esign-2026-10-02.md`.

The everyday steps (convert a DocuSign export or a PDF with a hand-written
field map, publish a new unapproved version, check it, approve it) are in the
header of `scripts/esign-template.ts`, beside the code they describe. This
runbook holds what does not belong there. Its first section was moved out of
that header on 14 Nov 2026 (review id `DOCS-OWED-W7`, owed by
`docs/TENANCY-S5.md`, "Docs owed after wave 7").

Code wins over this file. If they disagree, fix this file.

## Placeholder script usage

**Dev only.** A placeholder stands in for a document whose real wording does
not exist yet. Today that is the tenant guardian-consent document (S5 wave 7,
K5; owner decision `W7-6`, 11 Nov 2026). The real consent wording is a legal
item for production and is not in this repo.

The placeholder is titled `DEV PLACEHOLDER – NOT A CONSENT FORM` and carries
that title on every page, so a copy that strays can never be mistaken for a
consent form. The rules live in `lib/esign/native/dev-placeholder.ts`.

### Where it may go

- Every hosted step refuses unless `.env.local` points at the dev Supabase
  project, or at a stack on this machine, and `NEXT_PUBLIC_APP_ENV` is not
  `prod` (`devPlaceholderTargetRefusal`). It is an allowlist: production is
  refused because it is not on the list, and again by `NEXT_PUBLIC_APP_ENV=prod`
  whatever the URL says. **There is no override.**
- Admin → Agreement documents refuses a placeholder outside dev too
  (`lib/esign/native/template-admin.ts`).
- Each hosted step run with `--apply` needs the owner's yes at the time.
- Nothing is approved unless step 4 below runs with `--apply`.

### Steps

1. **Build it locally.** Writes `esign-out/tenant_guardian_consent.pdf`,
   `.fields.json` (from
   `lib/esign/native/templates/tenant-guardian-consent-v1.fields.json`) and
   `.html`. Writes no database.

   ```bash
   npx tsx scripts/esign-template.ts dev-placeholder tenant_guardian_consent
   ```

2. **Check it, then upload it** as a new, unapproved, inactive version under
   the placeholder title. Read-only unless `--apply`.

   ```bash
   npx tsx scripts/esign-template.ts check tenant_guardian_consent
   npx tsx scripts/esign-template.ts publish tenant_guardian_consent --dev-placeholder [--apply]
   ```

3. **K0: sign that version end to end on dev.** It needs the publish, not the
   approval: the envelope names the version, and signing reads it by id. The
   envelope names no tenant and no participant, so its signature settles no
   registration, and its email goes wherever `DEV_EMAIL_SAFELIST` routes dev
   mail.

   ```bash
   npx tsx scripts/esign-dev-issue.ts tenant_guardian_consent --version <version>
   ```

4. **K7b: approve it on dev.** It becomes the one consent envelopes use there.
   `--by` names the role of the person who checked it, never a personal name.

   ```bash
   npx tsx scripts/esign-template.ts approve tenant_guardian_consent <version> --dev-placeholder --by "<who checked it>" [--apply]
   ```

### What the flag guards

- A placeholder can be published or approved only with `--dev-placeholder`,
  and `--dev-placeholder` is accepted only on the whole placeholder: at least
  one page, every page carrying the exact title.
- A PDF with the mark on any page, in any spelling or spacing
  (`Dev-Placeholder`, `DEV  PLACEHOLDER`), counts as a placeholder for every
  key, so it cannot be published as a real document.
- `publish --dev-placeholder` refuses a `--title` other than the placeholder
  title.
- Only the keys in `DEV_PLACEHOLDER_MAPS` have a placeholder:
  `tenant_guardian_consent` and `staff`. Steps 1, 2 and 4 take `staff` the
  same way, with its own field map; step 3's script signs the consent
  document only.

Output lands in `esign-out/`, which is gitignored. Field maps and overrides are
reviewed in the repo; PDFs live in the private agreement-templates bucket.
