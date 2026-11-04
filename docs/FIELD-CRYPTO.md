# Field encryption (S4): shadow phase

Stage 4 of the multi-tenancy plan encrypts sensitive fields in the application
before they reach Postgres: health conditions, dietary and allergy notes,
emergency contacts and guardian contacts. This change is the **shadow phase**.
It adds the machinery and the columns. With the defaults it does nothing at
all, and no read changes even when it is switched on.

| Piece | Where |
|---|---|
| Cipher primitive (AES-256-GCM with associated data) | `lib/esign/backup-crypto.ts`: `sealGcm` / `openGcm`, beside the existing backup format, which is unchanged |
| Envelope encryption, blind indexes, key service | `lib/field-crypto.ts` |
| Sensitive-column catalogue | `lib/field-crypto-fields.ts` |
| Patch builder (shared by app and backfill) | `lib/field-crypto-patch.ts` |
| One-line write-site hook | `lib/field-crypto-shadow.ts`: `shadowSyncFields(table, ids)` |
| Data-key store | `lib/field-crypto-store.ts` over `public.tenant_data_keys` |
| Migration | `supabase/migrations/20261104400000_field_crypto_shadow.sql` |
| pgTAP | `supabase/tests/database/field_crypto.test.sql` |
| Backfill and rotation | `scripts/backfill-field-crypto.ts` |
| Plaintext scanner (the S4 gate) | `scripts/scan-plaintext-sensitive.ts`, pure half in `lib/field-crypto-scan.ts` |

## Modes

`FIELD_CRYPTO_MODE`:

- **`off`** (the default, and the value of anything unrecognised). Nothing runs.
  `shadowSyncFields` returns before it touches the database.
- **`shadow`**. Write sites dual-write: after the app's own write succeeds, the
  hook re-reads those rows and writes `*_enc` and `*_bidx` beside the
  plaintext, after the response. Every read still uses the plaintext.
- **`read`**. Reserved for the cut-over. It dual-writes like `shadow`, but no
  read path uses it yet.

With `FIELD_CRYPTO_MASTER_KEY` unset or malformed, every mode is inert.

The hook cannot fail or delay a live write. It is synchronous and wrapped in
`try`/`catch`, and the work runs through `runAfterResponse`. Errors are
logged as `[field-crypto] shadow write skipped for <table> (<code>)`, with
no value, ciphertext or key in the message.

## Design

**Keys.** There are three layers:

1. **Master key.** `FIELD_CRYPTO_MASTER_KEY` holds 32 random bytes in base64,
   with `FIELD_CRYPTO_KEY_ID` as its label (`[A-Za-z0-9_-]{1,32}`). It lives in a
   Vercel secret and in the owner's offline escrow, and nowhere else. It only
   wraps data keys. During a rotation, `FIELD_CRYPTO_PREVIOUS_MASTER_KEY` and
   `FIELD_CRYPTO_PREVIOUS_KEY_ID` keep the outgoing key readable.
2. **Data key (DEK).** Each tenant gets 32 random bytes, created on first use.
   It is stored in `tenant_data_keys` wrapped by the master key:
   `wk1.<master id>.<base64url(IV|tag|ct)>`. The wrap's AAD binds the tenant id
   and the DEK id, so a wrapped key copied onto another tenant's row will not
   open. A partial unique index allows one active DEK per tenant. A retired DEK
   still decrypts.
3. **Field.** AES-256-GCM under the tenant's DEK:
   `sf1.<DEK id>.<base64url(IV|tag|ct)>`. The AAD is
   `["sf1", tenant, table, column, row id, DEK id]`. A ciphertext moved to
   another row, column, table or tenant, relabelled with another key id, or
   altered in any byte fails authentication instead of decrypting.

**Blind indexes.** Each is an HMAC-SHA256 of the normalised value under a key
that HKDF derives from the DEK, bound to tenant, table and column. That is a
separate key from the DEK, and a different one for every column, so the same
address gets unlinkable indexes in two columns. The format is
`bi1.<DEK id>.<base64url(mac)>`. Normalisation:

- email: trimmed, NFKC and lower-case;
- phone: digits only, keeping a leading `+`;
- text: lower-case, with whitespace collapsed.

Compare indexes with `blindIndexEquals`, which runs in constant time. After a DEK
rotation, look up with `blindIndexCandidates`, which returns one index per DEK,
until the backfill has re-indexed every row.

**Tenancy.** `participants` take their tenant from `registrations.tenant_id`
(derived by the S3 trigger). A participant whose registration has no tenant is
skipped and counted, never bound to a guessed tenant. `members` and
`member_pending_consent` are `identity` tables, not tenant data. Until S7 moves
them into identities, they are encrypted under the platform owner's
(Stellr's) DEK.

**Errors.** Every failure is a `FieldCryptoError`, with a fixed message per code:
`config`, `format`, `auth`, `no_key`, `store` or `input`. No key material,
plaintext, ciphertext or library message is ever included. The tests check
that a malformed key never appears in the error text.

**Empty values.** A null or empty string, or an empty array, has no ciphertext.
`*_enc` is null whenever the plaintext is empty, so clearing the plaintext
clears the ciphertext on the next sync. `dietary_requirements` (`text[]`) is
encrypted as a JSON array.

## Sensitive columns

Evidence: the schema is `supabase/baseline.sql` plus the timestamped migrations.
The writers are the files that save each column.

| Column | Kind | Index | Defined | Written by |
|---|---|---|---|---|
| `participants.health_conditions` | health | — | baseline.sql:3151 | `app/api/register/{individual,group,group-join}`, `app/api/members/teams/[id]/participants`, `lib/sheet-participant-sync.ts` |
| `participants.dietary_requirements` | dietary / allergy (`text[]`) | — | baseline.sql:3150 | same |
| `participants.emergency_contact_first_name` | emergency contact | — | baseline.sql:3152 | same |
| `participants.emergency_contact_last_name` | emergency contact | — | baseline.sql:3153 | same |
| `participants.emergency_contact_email` | emergency contact, and the guardian address for a minor's consent form | email | baseline.sql:3154 | same, plus `app/api/admin/events/[slug]/participants/[pid]/guardian`, `lib/agreement-correction.ts` |
| `participants.emergency_contact_phone` | emergency contact | phone | baseline.sql:3155 | same as above |
| `participants.emergency_contact_relationship` | emergency contact | — | baseline.sql:3163 (migration 014) | same as above |
| `members.health_conditions` | health | — | baseline.sql:3001 | `lib/member-sync.ts`, `app/api/members/{me,onboarding}`, `app/api/admin/members`, `app/api/register/{individual,group}` |
| `members.ec_first_name` | emergency contact | — | baseline.sql:2997 | same |
| `members.ec_last_name` | emergency contact | — | baseline.sql:2998 | same |
| `members.ec_email` | emergency contact, and the guardian address (`lib/volunteer.ts`, `app/api/consent/request`) | email | baseline.sql:2999 | same, plus `app/api/consent/request`, the guardian route |
| `members.ec_phone` | emergency contact | phone | baseline.sql:3000 | same |
| `members.ec_relationship` | emergency contact | — | baseline.sql:3008 | same |
| `member_pending_consent.guardian_name` | guardian contact | — | 20261103234607_member_pending_consent.sql:27 | `lib/pending-consent.ts` (`openPendingConsent`) |
| `member_pending_consent.guardian_email` | guardian contact | email | 20261103234607_member_pending_consent.sql:28 | same |

**Plaintext copies.** These are where the scanner looks:

- `audit_log`: the `trg_audit_members` trigger (baseline.sql:6340) copies the
  whole `members` row on every write, including the S4 `*_enc` columns.
- `deletion_archive`: `lib/deletion/archive.ts` snapshots the deleted rows with
  `select('*')`, nested as `{ table: [rows] }`.
- Exporters: the event roster CSV, the members CSV, the registration
  spreadsheet and the Google Sheets sync (`lib/google-sheets.ts`). Run
  `npx tsx scripts/scan-plaintext-sensitive.ts --code-only` for the current
  list.

**Not in scope here.** Each item needs a decision before the plaintext gate:

- `member_allergies` and `allergy_options`. A member's allergies are join rows
  to a fixed option list, not free text. Encrypting them means moving them to an
  encrypted array on `members`, which is a data-model change.
- `agreement_recipients.name` / `.email`. For a minor, the signer is the
  guardian. These are operational addresses for e-sign delivery, so they stay
  plaintext while e-sign sends from them.
- `agreements.prefill` (jsonb) and `agreement_recipients.signer_values`
  (jsonb). The native engine pre-fills `GuardianName`, `GuardianEmail`,
  `GuardianPhone`, `EmergencyContactName` and `EmergencyContactPhone`
  (`lib/esign/native/plan.ts`, stored by `lib/esign/providers/native.ts`; the
  fields are in `lib/esign/native/templates/minor-v2-3.fields.json` and
  `mentor-v2-3.fields.json`), and a signer's corrections land in
  `signer_values`. The signed PDFs in the `signed-agreements` bucket hold the
  same values. A signed agreement is a legal record, so these are not encrypted
  here. The scanner reports both columns (by those key names) and
  `--gate plaintext` fails while any hold a value; the owner decides whether to
  encrypt, minimise or exempt them before the cut-over.
- Google Sheets already written. Those copies live outside Postgres. Tenants
  are fenced from Sheets in S11.

## Behaviour in shadow mode

These effects exist only when shadow mode is on. They are all off by default.

- Each sync is one extra `UPDATE` on the row, and only when a sensitive value
  changed. A ciphertext that already opens to the current value under the
  active DEK is left alone.
- That `UPDATE` is a compare-and-set: it carries an equality (or `IS NULL`)
  filter on every sensitive plaintext column it read. If the plaintext changed
  after the read (a member clearing a value, the retention job, the under-13
  erase, another write), no row matches, nothing is written, and the row is
  re-read and rebuilt, up to three attempts. A stale sync can therefore never
  land the ciphertext of a value that was since changed or erased. The backfill
  uses the same guarded write and reports such rows as "changed during the run".
- Every write path that sets or clears a sensitive column calls
  `shadowSyncFields`, including the under-13 onboarding path that erases a
  linked member's emergency contact (`childPendingSignup`), so the ciphertext
  is cleared with the plaintext.
- On `members`, that `UPDATE` fires `trg_audit_members` (one more `audit_log`
  row, which still holds the plaintext until the S0 trigger scrub) and
  `trg_members_updated_at`.
- Routes that `select('*')` from `members` or `participants` return the new
  columns: `/api/members/me`, the account page, `participants(*)` on the teams
  route, and the admin member `PATCH` response. The values are opaque without
  the key, but S4's read path must project columns explicitly before `read` mode.
- The medical retention SQL (`scripts/medical-retention-sql.ts`) now also clears
  `health_conditions_enc` wherever the plaintext is null. It strips the `_enc`
  key from `audit_log` and `deletion_archive` the same way.

## Gates

`scripts/scan-plaintext-sensitive.ts` only reads, and prints counts only.

- `--gate coverage`: every plaintext value has a current ciphertext and, for
  indexed columns, a blind index. No orphan ciphertext is left, and no
  ciphertext or blind index is still under a retired DEK (the "retired key"
  column, read from the key id prefix, so it needs no master key). With
  `--verify`, every ciphertext opens to the current plaintext. This must pass
  before `read` mode.
- `--gate plaintext`: no sensitive plaintext in any table, `audit_log`,
  `deletion_archive`, `agreements.prefill` or
  `agreement_recipients.signer_values`, and no exporter reading a plaintext
  column. This is the
  S4 cut-over gate from the plan. It fails today by design.

## Owner actions

1. **Generate the master key on a trusted machine, offline.** Never paste it
   into chat, a PR, an issue or a log.
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Choose a key id such as `fc2026a`.
2. **Escrow** the key and its id offline (password manager plus a sealed paper
   copy) before setting it anywhere. Losing it makes every ciphertext
   unrecoverable, and the plaintext columns are the only fallback while they
   exist.
3. **Apply the migration** to dev, then production, through the Production
   migration Action. Not on 6 Nov. The partial indexes read each table once.
4. **Dev first.** Set `FIELD_CRYPTO_MASTER_KEY` and `FIELD_CRYPTO_KEY_ID` on the
   dev Vercel project with a dev-only key, never the production key. Set
   `FIELD_CRYPTO_MODE=shadow`, redeploy, and register a test participant. Run
   the backfill, then `scan --gate coverage --verify`.
5. **Production.** Set the production key in the Production scope only, run the
   backfill dry run, then `--apply --production`. Switch
   `FIELD_CRYPTO_MODE=shadow`. Re-run `scan --gate coverage --verify` after a
   day of traffic.

## Runbooks

**Master-key rotation.** No field is re-encrypted, only the DEK wraps:

1. Generate and escrow the new key.
2. In Vercel, move the current pair to `FIELD_CRYPTO_PREVIOUS_MASTER_KEY` /
   `FIELD_CRYPTO_PREVIOUS_KEY_ID`, and set the new pair as current. Redeploy.
   Both keys now unwrap.
3. Run `npx tsx scripts/backfill-field-crypto.ts --rewrap`, then again with
   `--apply` (`--production` for production).
4. Run `scan --verify`. Then remove the previous pair and redeploy. Keep the old
   key in escrow until the next backup cycle has aged out.

**DEK rotation** (one tenant, for example after a suspected exposure):

1. `npx tsx scripts/backfill-field-crypto.ts --rotate-dek <tenant-uuid>` (dry
   run), then add `--apply`. This retires the active DEK, creates a new one and
   re-encrypts and re-indexes every row it finds.
2. **Wait at least one minute.** A warm app instance re-checks which DEK is
   active at most every 30 seconds (`ACTIVE_CHECK_MS` in `lib/field-crypto.ts`)
   before it encrypts, so for up to 30 seconds after step 1 it can still write
   under the retired key. To be certain, redeploy instead of waiting.
3. Re-run `npx tsx scripts/backfill-field-crypto.ts --apply` (without
   `--rotate-dek`). It rewrites anything written under the old key in the
   meantime.
4. `scan --gate coverage --verify` must pass, which includes "retired key" = 0
   on every column. Until it does, some values are still under the retired
   (possibly exposed) DEK. Retired DEKs stay in the table: backups and old
   ciphertexts may still need them.

**Crypto-shredding** a tenant's data (offboarding, after the retention period):
delete the tenant's rows from `tenant_data_keys` in the SQL editor. The service
role has no DELETE or TRUNCATE on that table: the migration revokes Supabase's
default `GRANT ALL ON TABLES TO service_role` (supabase/baseline.sql) before
granting SELECT, INSERT and UPDATE, and `field_crypto.test.sql` asserts it. Every value under those keys becomes
unrecoverable, including in backups that still hold the wrapped key once the
master key no longer exists. This is irreversible: take a dump first if there is
any doubt.

**Rollback.** Set `FIELD_CRYPTO_MODE=off` (or unset it) and redeploy. Nothing
reads the shadow columns, so no other step is needed. The columns and
`tenant_data_keys` can stay.

## What this phase does not do

- It switches no read and drops no plaintext column.
- It does not encrypt what is already in `audit_log`, `deletion_archive` or
  Sheets (those are the S0 scrub and S11 items).
- It has no role-gated decrypt path for exporters. The exporters must become
  encrypted-aware before the plaintext gate.
- It does not re-key the identity tables per tenant (S7).
