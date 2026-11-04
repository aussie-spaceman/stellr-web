# Runbook: database and storage backups

Status: written 3 Nov 2026 (multi-tenancy plan S1). Not yet installed: every step in §2 is an owner action.

Supabase Free keeps **no database backups**. Until this runbook is installed, the only off-site copy is the e-sign replica (signed PDFs and the agreement tables, nightly, to Google Drive; `lib/esign/replicate.ts`). Everything else (members, registrations, payments, credentials) has no copy at all.

## 1. What runs, and the targets

| Job | When (UTC) | What | Recovery point |
|---|---|---|---|
| `hourly` | :07 every hour | Critical tables, schema and data (`ops/backups/critical-tables.txt`: agreements and e-sign audit, privacy and deletion requests, registrations, participants, members, money tables, credentials, background checks) | **1 hour** |
| `nightly` | 09:23 | Roles (no passwords), full `public`, `entitlements` and `supabase_migrations` schemas with data, and the `storage.buckets` / `storage.objects` metadata | **24 hours** |
| `storage` | 09:53 | Every file in every Supabase Storage bucket, with a path / size / SHA-256 manifest | **24 hours** |

**Recovery time target: under 4 hours** from the decision to restore to the site serving restored data (§6).

How each job works (`ops/backups/backup.sh`):

1. Refuses to run unless it is connected to the production project as the read-only `backup_reader` role.
2. Dumps with `pg_dump` 17 (PGTZ=UTC), and writes `manifest.tsv`: every table, its row count and a SHA-256 of its sorted rows (`ops/backups/fingerprint.sh`).
3. Tars the dump, manifest and `meta.json`, and encrypts the tar with `age` to the owner's public key. **The private key is never in GitHub**, so a compromised Action or repo can write backups but cannot read one.
4. Uploads to Cloudflare R2 as `<kind>/YYYY/MM/DD/stellr-<kind>-<timestamp>.tar.age` plus a `.sha256` sidecar, then reads the object's size back. There is no monthly copy (below).
5. Pings its own Better Stack heartbeat; on failure, pings the heartbeat's `/fail` URL. A run that never happens misses its ping, and the heartbeat alerts. That is how a **skipped** backup is caught, not only a failed one.

R2 **bucket lock rules** make every object undeletable and unchangeable until it ages out, even by the job's own key. Lifecycle rules then delete it.

| Prefix | Locked for | Deleted after |
|---|---|---|
| `hourly/` | 8 days | 8 days |
| `nightly/`, `storage/` | 35 days | 35 days |

**No longer tier, for now.** An earlier draft kept the first nightly of each month for 400 days. That would hold a pending-consent under-13 account, and the parent email collected only to ask for consent, for more than a year after the 30-day purge promised in the retention schedule (row 30), under a lock nobody can shorten. COPPA §312.5(c)(1) requires that email to be deleted if consent is not obtained, and §312.10 allows keeping a child's data only as long as reasonably necessary. With open sign-up (decision 24) there will be more such accounts. So nothing outlives the 35-day nightly. A longer tier (90 days at most) needs counsel's written approval first; record it in the retention schedule, row 29, before adding a lock rule for it.

So the longest any deleted record survives in a backup is 35 days after the last nightly that held it: for a pending-consent account purged at day 30, about 65 days from sign-up.

**Not covered here:** Clerk logins (held by Clerk), Stripe records (held by Stripe), DocuSign's own copies, Vercel Blob media, HubSpot, Google Sheets rosters. The `auth` schema is not dumped: sign-in is Clerk, so it holds nothing (to confirm on production). The e-sign Drive replica keeps running as a second, independent copy of signed records.

## 2. Install (owner, once, about 2 hours)

### 2.1 The age key

On the owner's own machine:

```sh
brew install age
age-keygen -o stellr-backup.agekey      # prints "Public key: age1…"
```

- Put `stellr-backup.agekey` in the password manager **and** on an offline copy (USB key or paper in a safe). Without it, no backup can be read. Delete the loose file once it is stored.
- The public key (`age1…`) is the `AGE_RECIPIENT` secret. To let a second person restore if the owner is unavailable, generate a second key the same way, give it to them, and set `AGE_RECIPIENT` to both public keys separated by a space.

### 2.2 Cloudflare R2

1. Create a bucket, for example `stellr-backups`, with a North America location hint.
2. **Bucket lock rules** (Settings → Bucket lock): the three prefixes and ages in §1, and nothing else. **Treat a lock period as permanent for every object written under it**: plan as if an object written under a 35-day rule stays 35 days whatever the rule later says (to confirm against Cloudflare's bucket lock documentation on the day; if a rule turns out to be removable, that is a weakness of the ransomware protection, not a way to shorten retention). Check each number before saving. Do not add a `monthly/` rule (§1).
3. **Lifecycle rules**: delete objects under the same prefixes after the same ages. Never shorter than the lock.
4. API token for the Action: **Object Read & Write**, this bucket only. Its key ID and secret are `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; the account ID is `R2_ACCOUNT_ID`; the bucket name is `R2_BUCKET`.
5. A second token, **Object Read only**, for restore drills on the owner's machine. Never put it in GitHub.

Free tier: 10 GB storage. Expected use is well under 2 GB (to confirm after the first month: about 24 × 8 hourly + 35 nightly + 35 storage archives).

### 2.3 The read-only database role

In the production SQL editor (Supabase → SQL), as `postgres`:

```sql
-- Login role for backups only. BYPASSRLS so pg_dump sees every row of every
-- table (pg_dump refuses to dump a table whose rows RLS would filter).
-- Read-only by default; cannot write even if the URL leaks.
CREATE ROLE backup_reader WITH LOGIN BYPASSRLS CONNECTION LIMIT 2;
GRANT pg_read_all_data TO backup_reader;
ALTER ROLE backup_reader SET default_transaction_read_only = on;
ALTER ROLE backup_reader SET statement_timeout = '30min';
ALTER ROLE backup_reader SET idle_in_transaction_session_timeout = '5min';
```

Then set its password where the agent cannot see it: in `psql` on the owner's machine run `\password backup_reader`, or in the dashboard SQL editor run `ALTER ROLE backup_reader PASSWORD '…'` with a password generated in the password manager, and clear the editor afterwards.

If `GRANT pg_read_all_data` or `BYPASSRLS` is refused (Supabase limits what `postgres` can grant: **to confirm on the first run**), use explicit grants instead:

```sql
GRANT USAGE ON SCHEMA public, entitlements, supabase_migrations, storage TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, entitlements, supabase_migrations, storage TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, entitlements TO backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, entitlements
  GRANT SELECT ON TABLES TO backup_reader;
```

and, if BYPASSRLS itself is refused, ask Supabase support or fall back to a `postgres` URL held only in the private repo. Record which one was used here.

`PROD_DATABASE_URL` = the **session pooler** URI (Supabase → Connect → Session pooler, port 5432) with the user `backup_reader.<project ref>` and that password. GitHub runners have no IPv6, so the direct connection does not work.

### 2.4 Supabase Storage S3 keys

Supabase → Storage → S3 Connection: note the endpoint and region, create an access key. These are `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`. These keys can read and write every bucket and cannot be narrowed (to confirm), so they live only in the private repo's secrets.

### 2.5 Better Stack heartbeats

Create three heartbeats and alert the owner by email and phone:

| Heartbeat | Period | Grace | Secret |
|---|---|---|---|
| Stellr backup hourly | 1 hour | 30 min | `HEARTBEAT_URL_HOURLY` |
| Stellr backup nightly | 24 hours | 3 hours | `HEARTBEAT_URL_NIGHTLY` |
| Stellr backup storage | 24 hours | 3 hours | `HEARTBEAT_URL_STORAGE` |

GitHub delays scheduled runs at busy times, sometimes by tens of minutes; the grace periods allow for that.

### 2.6 The private repository

1. Create a **private** repository, for example `stellr-backups`, owned by the owner's account. Only the owner has access. The agent's machine account is **not** added.
2. Copy from `stellr-web`: `ops/backups/` → `ops/backups/` (all files), and `ops/backups/workflow.yml` → `.github/workflows/backups.yml`.
3. Add the secrets listed at the top of `workflow.yml` as repository secrets.
4. Actions → Backups → Run workflow, once for each of `hourly`, `nightly`, `storage`. Each should finish green, put an object in R2 and turn its heartbeat green.
5. **Prove the skip alarm** (plan S1 gate): disable the workflow (Actions → Backups → ⋯ → Disable) for 2 hours and confirm the hourly heartbeat alerts. Re-enable it. Record the date in §7.
6. Run the first restore drill (§4) on that night's backups.

When `ops/backups/` changes in `stellr-web` (owner review via CODEOWNERS), copy the change to the private repo the same day.

### 2.7 Actions minutes

GitHub Free gives a private repo 2,000 minutes a month, rounded up per job. Expected: hourly about 2 minutes × 720 runs = 1,440; nightly about 4 × 30 = 120; storage about 3 × 30 = 90. **About 1,650: tight.** Check Settings → Billing after the first week. If it runs over, the options are the GitHub Pro plan (3,000 minutes), or making the repo public (its scripts are already public in `stellr-web`, the archives are encrypted and in R2, and secrets stay secret; but anyone can then see run times and failures). Owner decision; do not drop the hourly schedule, which is what holds the 1-hour RPO.

## 3. When a heartbeat alerts

1. Open the private repo → Actions → the failed or missing run.
2. Missing run: check Actions is enabled and that GitHub has no incident; run it by hand (Run workflow).
3. Failed run: read the step log. Usual causes: the `backup_reader` password changed or the pooler URI changed; a table in `critical-tables.txt` was renamed or dropped (`--strict-names` stops the job; fix the list in `stellr-web` first, then copy it); R2 token expired; Supabase S3 key revoked.
4. Over two missed nightlies, or any doubt about the data, treat it as an incident under `docs/compliance/incident-response-plan.md` (availability, Low, unless data is at risk).

## 4. Restore drill (monthly; owner witnesses one each quarter)

On the owner's machine, which needs Docker, PostgreSQL 17 client tools (`brew install postgresql@17`), `age` and the AWS CLI:

```sh
export R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…   # read-only token
ops/backups/restore-drill.sh --identity /path/to/stellr-backup.agekey \
  --nightly latest --hourly latest --storage latest \
  --report drill-$(date +%Y-%m-%d).txt
```

It decrypts each archive into a temp directory (deleted on exit), starts a throwaway `postgres:17` container on 127.0.0.1, restores, and checks:

- the hourly the way a real recovery uses it: `--hourly` needs `--nightly`, because the hourly holds only the critical tables and not the types, schemas and other tables they depend on. The drill copies the restored nightly and runs `ops/backups/overlay-critical.sh` on the copy, which is §6 step 3 itself, so every drill exercises the recovery step;
- every table's row count **and** content hash against the manifest taken at backup time (a fresh dump of the scratch database, fingerprinted the same way);
- `count(*)` per table against the manifest;
- every e-sign audit chain (`esign_verify_audit`), and prints the audit anchor, the same value `exportTables` writes into the daily e-sign Drive export;
- every stored file's size and SHA-256, and every signed agreement's file against `agreements.signed_pdf_sha256`, the check `scripts/esign-restore-drill.ts` makes against the Drive copies.

`RESULT: PASS` is the gate. The report holds table names, counts and hashes only, so it can be filed. Some objects are refused during restore (Supabase-only extensions, `auth` functions, grants to roles the scratch server lacks); the drill counts them and judges by the data. Record each drill in §7 and in the information security program §10. Run `scripts/esign-restore-drill.ts` in the same session: together they cover both copies of the signed records.

## 5. Recovery: which archive

| Situation | Restore from |
|---|---|
| A few rows deleted or damaged by mistake | Latest hourly (critical tables) or nightly: restore into a scratch database with the drill (`--keep` leaves the container running), copy the rows back by hand with the owner |
| Whole database lost or corrupted | Latest nightly, then the hourly taken after it for the critical tables (§6) |
| Storage files lost | Latest storage archive; signed PDFs also from the Drive replica (`scripts/esign-restore-drill.ts --restore <id>`) |
| Ransomware or a compromised account deleted things | Any archive inside its lock period: R2 lock means none could be removed |

## 6. Full recovery (target under 4 hours)

| Step | Time |
|---|---|
| Decide to restore; announce maintenance; pause crons (Vercel → Settings → Cron Jobs) | 15 min |
| Fetch and decrypt the latest nightly and the newest hourly | 15 min |
| Restore the nightly into the production project (or a new Supabase project if the old one is unusable) | 45 min |
| Overlay the hourly for the critical tables | 30 min |
| Restore storage files | 30 min |
| Re-apply deletions made after the backup (see below); verify; reopen | 60 min |

1. **Decrypt:** `age -d -i stellr-backup.agekey stellr-nightly-….tar.age | tar -xf -` in an empty directory on an encrypted disk.
2. **Restore the nightly** as `postgres` (owner's own URI, session pooler):
   `pg_restore --clean --if-exists --no-owner --role=postgres --dbname="$OWNER_DB_URL" app.dump`
   Expect refusals on Supabase-managed objects; compare the result with the drill's. For `storage-meta.dump`, load rows only, into the storage tables Supabase already has: `pg_restore --data-only --no-owner --dbname="$OWNER_DB_URL" storage-meta.dump` (into a new project, whose storage tables are empty; in the old project, only if its storage rows are damaged, after deleting them with the owner).
3. **Overlay the hourly** for the critical tables:
   `ops/backups/overlay-critical.sh --dbname "$OWNER_DB_URL" --dump critical.dump --tables manifest.tsv` (both from the hourly archive). In one transaction it deletes every critical table's rows with triggers off (`session_replication_role = replica`), loads the hourly's rows, and reports foreign-key orphans by constraint and count. **Not `TRUNCATE`**: other tables (chat messages, community posts, cohort members, coaching requests, offerings…) reference members, participants and registrations, so `TRUNCATE` is refused, and `TRUNCATE … CASCADE` would empty those tables. Add `--dry-run` first to see the orphan report without changing anything. Orphans are rows changed between the nightly and the hourly; normally delete the orphaned child rows (what the cascade would have done), with the owner. Every restore drill runs this script, but against a scratch Postgres as superuser. Whether `postgres` may set `session_replication_role` on Supabase is **to confirm** once, against a scratch Supabase project, before it is needed.
4. **Storage files:** `aws s3 sync files/<bucket> s3://<bucket> --endpoint-url "$SUPABASE_S3_ENDPOINT"` for each bucket.
5. **Re-apply deletions.** Anyone erased after the backup was taken comes back with the restore. Compare `deletion_requests` and `member_activity_log` in the restored copy with the newest hourly and with the incident timeline, and re-run each deletion through the admin deletion tool before reopening.
6. **Verify:** `npm run db:status -- --prod`, `supabase/tests/security_checks.sql` (no rows), `scripts/esign-restore-drill.ts` (audit anchor), a signed-in smoke test. Then resume crons.

## 7. Record

| Date | What | Who | Result |
|---|---|---|---|
| (to do) | Install (§2) | Owner | |
| (to do) | Skip alarm proven (§2.6 step 5) | Owner | |
| (to do) | First restore drill | Owner | |
| (to do) | `overlay-critical.sh --dry-run` against a scratch Supabase project (is `session_replication_role` allowed?) | Owner | |
