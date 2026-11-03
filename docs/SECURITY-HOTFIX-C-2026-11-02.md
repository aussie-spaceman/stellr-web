# Security hotfix C — 2 Nov 2026

Closes deep-review item **DB-N3**: SECURITY DEFINER functions that anyone holding
the public anon key could call through `/rest/v1/rpc`. This is item **S0-1** of
the multi-tenancy plan (Stage 0, live fixes first). It is a labelled security
hotfix, so it is exempt from the Nevada event freeze (6 Nov 2026).

Target: `dev`, as one commit (drafted on `fix/s0-revoke-definer-exec`).

## The hole

Three migrations revoked EXECUTE `FROM PUBLIC` only:
`20261002180802_esign_native_engine`, `20261002235036_post_event_survey` and
`20261003002925_post_event_survey_member_link`. On this project the default
privileges also grant EXECUTE to `anon` and `authenticated` directly, so these
stayed callable by anyone. The lint grandfathered all three files.

On production (checked 2 Nov 2026 with `has_function_privilege`), anon and
authenticated could execute these functions:

| Function | What an anonymous caller could do |
|---|---|
| `survey_purge_person` | Delete survey responses and invitations for an email or id, reset privacy preferences, and write an audit row with a chosen actor |
| `survey_redact_answer`, `survey_submit_response` | Tamper with or finalise survey answers (needs a response id) |
| `esign_purge_audit` | Erase a consent form's audit trail (needs an agreement id) |
| `esign_append_audit` | Forge audit-trail entries (needs an agreement id) |
| `esign_claim_email`, `survey_claim_email` | Use up the day's send budget so consent and survey mail stalls |
| `survey_current_member_id` | Harmless for anon (returns NULL); RLS helper |
| `survey_responses_audit_delete`, `survey_follow_participant_member`, `tg_ensure_tier_space` | Trigger functions; `/rpc` cannot invoke them |

Dev had already been sealed by hand except `tg_ensure_tier_space`, so dev and
production had drifted. The migration makes both match.

## Evidence before the fix (production, read-only, 2 Nov 2026)

- **E-sign audit chains:** all 6 native agreements have a trail, and
  `esign_verify_audit` finds 0 broken chains. No sign of a purged or forged trail.
- **Survey purges:** `audit_log` holds 2 `survey_purge` rows (20 and 29 Oct). Both
  actors are staff members, and each falls on a day with a matching
  `deletion_archive` row, so both were legitimate admin deletions.
- **Budgets:** the e-sign and survey daily counters show no abnormal spikes
  (largest is 27 survey sends on 7 Oct, matching a real distribution).
- **API logs, last 24 hours** (the most Supabase Free keeps): every `/rpc` call
  used the service-role key from Vercel's AWS egress. There were no anon or
  authenticated calls to any of these functions. **Older activity cannot be
  checked**, because Free keeps one day of logs. The intact audit chains and the
  explained purge rows are the evidence for the earlier period.

No breach is indicated, and no notification is triggered.

## The fix

`supabase/migrations/20261102220634_seal_definer_functions_db_n3.sql`:
- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on the 7 RPCs, the 3
  trigger functions and the 3 chain helpers (`esign_verify_audit`,
  `esign_audit_heads`, `esign_audit_digest`), with `service_role` grants restated.
- `survey_current_member_id` keeps `authenticated` (the survey self-read RLS
  policies call it) and loses PUBLIC and anon.

Every app caller passes the service-role client (`lib/esign/outbox.ts`,
`lib/esign/retention.ts`, `lib/esign/native/audit.ts`, `lib/esign/integrity.ts`,
`lib/esign/replicate.ts`, `lib/survey/*`, `scripts/survey-seed-dev.ts`,
`scripts/esign-restore-drill.ts`), so app behaviour does not change.

**Lint.** `scripts/check-migration-security.mjs` no longer grandfathers any
timestamped migration. The one helper that must keep `authenticated` is named
in `FROZEN_RLS_HELPERS` and must still lose PUBLIC and anon. A test proves that
the 7 functions are flagged if the sealing migration is removed.

**Checks.**
- `supabase/tests/security_checks.sql` is a read-only SELECT; zero rows means
  pass. Before the fix it returned 11 rows on production and 1 on dev. Dev
  returns 0 after the fix.
- `scripts/verify-db-grants.ts` is a read-only anon probe. It calls only
  `survey_current_member_id`, the one sealed function that is harmless to call
  if the revoke failed. It reports a pass only on a permission error (42501).
  Before the fix it reported FAIL on production and PASS on dev.

Not in this hotfix (Stage 0, item S0-3): revoking table grants from
anon/authenticated, changing the default privileges so future functions start
sealed, and revoking `space_unread_counts` from `authenticated` (S0-9).

## Applying to production

1. Apply the migration file to production, then realign the ledger row to
   `20261102220634` if the apply path records its own timestamp.
2. Run `supabase/tests/security_checks.sql` on production. Expect zero rows.
3. Run the probe against production. Expect `✅ … anon refused`:
   ```bash
   SUPABASE_URL=https://<prod-ref>.supabase.co SUPABASE_ANON_KEY=<prod publishable key> npx tsx scripts/verify-db-grants.ts
   ```
4. Smoke test: a survey link opens and submits, and an e-sign invite sends.

## Applied to production — 3 Nov 2026

The owner approved the apply. It ran on 3 Nov 2026 at about 20:00 UTC through
the Supabase MCP (`apply_migration`, name `seal_definer_functions_db_n3`). It is
a labelled security hotfix, so it is exempt from the Nevada freeze.

- **Before:** `security_checks.sql` returned 11 rows: the 10 other functions in
  the table above, plus `survey_current_member_id` because anon could still
  execute it.
- **Ledger:** the MCP recorded the apply as `20261103200039`. It was realigned
  to `20261102220634`, then re-read separately: 209 rows, the sealed row present
  once, no stray row, latest `20261102220634`. Dev's ledger already records
  `20261102220634`.
- **After:** `security_checks.sql` returns 0 rows. `has_function_privilege` on
  all 14 functions: `service_role` true everywhere, `anon` false everywhere,
  `authenticated` true only for `survey_current_member_id`.
- **Probe:** `scripts/verify-db-grants.ts` against production passed with both
  the legacy anon key and the publishable key
  (`✅ … anon refused on survey_current_member_id (401)`).
- **Smoke test** (read-only, as `service_role`): `survey_current_member_id()`
  returned NULL and `esign_audit_heads()` returned 6 heads, matching the 6
  native agreements. No real survey or e-sign send was made.
- **Security Advisor:** no anon-executable SECURITY DEFINER function remains.
  Four authenticated ones remain by design: `can_read_space`,
  `can_read_chat_channel` and `survey_current_member_id` (RLS helpers), and
  `space_unread_counts` (S0-9, open). Unrelated existing advisories are left for
  S0-3: 10 functions with a mutable search_path, and 21 tables with RLS on and
  no policy.

## Rollback

This only restores the earlier exposure, so use it only if a service-role path
breaks, which is not expected:

```sql
GRANT EXECUTE ON FUNCTION public.esign_append_audit(uuid, uuid, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_purge_audit(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_claim_email(date, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survey_redact_answer(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survey_purge_person(uuid, uuid[], text[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survey_claim_email(date, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survey_current_member_id() TO anon;
```

A service-role failure would show as `permission denied for function` in the
cron or route logs. Fix that by granting `service_role`, not by rolling back.
