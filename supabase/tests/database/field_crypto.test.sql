-- pgTAP: S4 field-encryption shadow schema (20261104400000_field_crypto_shadow.sql).
--
-- Runs in the CI `db` job with the other files in this directory. Checks the
-- tenant_data_keys table (RLS, no public access, no DELETE for the service
-- role, one active key per tenant, wrapped-key format) and that every shadow
-- column from lib/field-crypto-fields.ts exists, nullable, beside an
-- unchanged plaintext column. lib/field-crypto-fields.test.ts checks that
-- this file names every shadow column in that catalogue.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(94);

SELECT has_table('public', 'tenant_data_keys', 'tenant_data_keys exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_data_keys'::regclass), 'tenant_data_keys has RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.tenant_data_keys', 'SELECT'), 'anon has no SELECT on tenant_data_keys');
SELECT ok(NOT has_table_privilege('anon', 'public.tenant_data_keys', 'INSERT'), 'anon has no INSERT on tenant_data_keys');
SELECT ok(NOT has_table_privilege('anon', 'public.tenant_data_keys', 'UPDATE'), 'anon has no UPDATE on tenant_data_keys');
SELECT ok(NOT has_table_privilege('anon', 'public.tenant_data_keys', 'DELETE'), 'anon has no DELETE on tenant_data_keys');
SELECT ok(NOT has_table_privilege('authenticated', 'public.tenant_data_keys', 'SELECT'), 'authenticated has no SELECT on tenant_data_keys');
SELECT ok(NOT has_table_privilege('authenticated', 'public.tenant_data_keys', 'INSERT'), 'authenticated has no INSERT on tenant_data_keys');
SELECT ok(NOT has_table_privilege('authenticated', 'public.tenant_data_keys', 'UPDATE'), 'authenticated has no UPDATE on tenant_data_keys');
SELECT ok(NOT has_table_privilege('authenticated', 'public.tenant_data_keys', 'DELETE'), 'authenticated has no DELETE on tenant_data_keys');
SELECT ok(has_table_privilege('service_role', 'public.tenant_data_keys', 'SELECT'), 'service_role has SELECT on tenant_data_keys');
SELECT ok(has_table_privilege('service_role', 'public.tenant_data_keys', 'INSERT'), 'service_role has INSERT on tenant_data_keys');
SELECT ok(has_table_privilege('service_role', 'public.tenant_data_keys', 'UPDATE'), 'service_role has UPDATE on tenant_data_keys');
SELECT ok(NOT has_table_privilege('service_role', 'public.tenant_data_keys', 'DELETE'), 'service_role cannot DELETE a data key (crypto-shred is an owner action)');
SELECT ok(NOT has_table_privilege('service_role', 'public.tenant_data_keys', 'TRUNCATE'), 'service_role cannot TRUNCATE tenant_data_keys (default ACL revoked)');
SELECT ok(NOT has_table_privilege('service_role', 'public.tenant_data_keys', 'REFERENCES') AND NOT has_table_privilege('service_role', 'public.tenant_data_keys', 'TRIGGER'), 'service_role holds only SELECT, INSERT, UPDATE on tenant_data_keys');
SELECT has_column('public', 'participants', 'health_conditions_enc', 'participants.health_conditions_enc exists');
SELECT col_is_null('public', 'participants', 'health_conditions_enc', 'participants.health_conditions_enc is nullable');
SELECT col_type_is('public', 'participants', 'health_conditions_enc', 'text', 'participants.health_conditions_enc is text');
SELECT has_column('public', 'participants', 'dietary_requirements_enc', 'participants.dietary_requirements_enc exists');
SELECT col_is_null('public', 'participants', 'dietary_requirements_enc', 'participants.dietary_requirements_enc is nullable');
SELECT col_type_is('public', 'participants', 'dietary_requirements_enc', 'text', 'participants.dietary_requirements_enc is text');
SELECT has_column('public', 'participants', 'emergency_contact_first_name_enc', 'participants.emergency_contact_first_name_enc exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_first_name_enc', 'participants.emergency_contact_first_name_enc is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_first_name_enc', 'text', 'participants.emergency_contact_first_name_enc is text');
SELECT has_column('public', 'participants', 'emergency_contact_last_name_enc', 'participants.emergency_contact_last_name_enc exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_last_name_enc', 'participants.emergency_contact_last_name_enc is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_last_name_enc', 'text', 'participants.emergency_contact_last_name_enc is text');
SELECT has_column('public', 'participants', 'emergency_contact_email_enc', 'participants.emergency_contact_email_enc exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_email_enc', 'participants.emergency_contact_email_enc is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_email_enc', 'text', 'participants.emergency_contact_email_enc is text');
SELECT has_column('public', 'participants', 'emergency_contact_email_bidx', 'participants.emergency_contact_email_bidx exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_email_bidx', 'participants.emergency_contact_email_bidx is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_email_bidx', 'text', 'participants.emergency_contact_email_bidx is text');
SELECT has_column('public', 'participants', 'emergency_contact_phone_enc', 'participants.emergency_contact_phone_enc exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_phone_enc', 'participants.emergency_contact_phone_enc is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_phone_enc', 'text', 'participants.emergency_contact_phone_enc is text');
SELECT has_column('public', 'participants', 'emergency_contact_phone_bidx', 'participants.emergency_contact_phone_bidx exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_phone_bidx', 'participants.emergency_contact_phone_bidx is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_phone_bidx', 'text', 'participants.emergency_contact_phone_bidx is text');
SELECT has_column('public', 'participants', 'emergency_contact_relationship_enc', 'participants.emergency_contact_relationship_enc exists');
SELECT col_is_null('public', 'participants', 'emergency_contact_relationship_enc', 'participants.emergency_contact_relationship_enc is nullable');
SELECT col_type_is('public', 'participants', 'emergency_contact_relationship_enc', 'text', 'participants.emergency_contact_relationship_enc is text');
SELECT has_column('public', 'members', 'health_conditions_enc', 'members.health_conditions_enc exists');
SELECT col_is_null('public', 'members', 'health_conditions_enc', 'members.health_conditions_enc is nullable');
SELECT col_type_is('public', 'members', 'health_conditions_enc', 'text', 'members.health_conditions_enc is text');
SELECT has_column('public', 'members', 'ec_first_name_enc', 'members.ec_first_name_enc exists');
SELECT col_is_null('public', 'members', 'ec_first_name_enc', 'members.ec_first_name_enc is nullable');
SELECT col_type_is('public', 'members', 'ec_first_name_enc', 'text', 'members.ec_first_name_enc is text');
SELECT has_column('public', 'members', 'ec_last_name_enc', 'members.ec_last_name_enc exists');
SELECT col_is_null('public', 'members', 'ec_last_name_enc', 'members.ec_last_name_enc is nullable');
SELECT col_type_is('public', 'members', 'ec_last_name_enc', 'text', 'members.ec_last_name_enc is text');
SELECT has_column('public', 'members', 'ec_email_enc', 'members.ec_email_enc exists');
SELECT col_is_null('public', 'members', 'ec_email_enc', 'members.ec_email_enc is nullable');
SELECT col_type_is('public', 'members', 'ec_email_enc', 'text', 'members.ec_email_enc is text');
SELECT has_column('public', 'members', 'ec_email_bidx', 'members.ec_email_bidx exists');
SELECT col_is_null('public', 'members', 'ec_email_bidx', 'members.ec_email_bidx is nullable');
SELECT col_type_is('public', 'members', 'ec_email_bidx', 'text', 'members.ec_email_bidx is text');
SELECT has_column('public', 'members', 'ec_phone_enc', 'members.ec_phone_enc exists');
SELECT col_is_null('public', 'members', 'ec_phone_enc', 'members.ec_phone_enc is nullable');
SELECT col_type_is('public', 'members', 'ec_phone_enc', 'text', 'members.ec_phone_enc is text');
SELECT has_column('public', 'members', 'ec_phone_bidx', 'members.ec_phone_bidx exists');
SELECT col_is_null('public', 'members', 'ec_phone_bidx', 'members.ec_phone_bidx is nullable');
SELECT col_type_is('public', 'members', 'ec_phone_bidx', 'text', 'members.ec_phone_bidx is text');
SELECT has_column('public', 'members', 'ec_relationship_enc', 'members.ec_relationship_enc exists');
SELECT col_is_null('public', 'members', 'ec_relationship_enc', 'members.ec_relationship_enc is nullable');
SELECT col_type_is('public', 'members', 'ec_relationship_enc', 'text', 'members.ec_relationship_enc is text');
SELECT has_column('public', 'member_pending_consent', 'guardian_name_enc', 'member_pending_consent.guardian_name_enc exists');
SELECT col_is_null('public', 'member_pending_consent', 'guardian_name_enc', 'member_pending_consent.guardian_name_enc is nullable');
SELECT col_type_is('public', 'member_pending_consent', 'guardian_name_enc', 'text', 'member_pending_consent.guardian_name_enc is text');
SELECT has_column('public', 'member_pending_consent', 'guardian_email_enc', 'member_pending_consent.guardian_email_enc exists');
SELECT col_is_null('public', 'member_pending_consent', 'guardian_email_enc', 'member_pending_consent.guardian_email_enc is nullable');
SELECT col_type_is('public', 'member_pending_consent', 'guardian_email_enc', 'text', 'member_pending_consent.guardian_email_enc is text');
SELECT has_column('public', 'member_pending_consent', 'guardian_email_bidx', 'member_pending_consent.guardian_email_bidx exists');
SELECT col_is_null('public', 'member_pending_consent', 'guardian_email_bidx', 'member_pending_consent.guardian_email_bidx is nullable');
SELECT col_type_is('public', 'member_pending_consent', 'guardian_email_bidx', 'text', 'member_pending_consent.guardian_email_bidx is text');
SELECT has_index('public', 'participants', 'participants_emergency_contact_email_bidx_idx', 'participants_emergency_contact_email_bidx_idx exists');
SELECT has_index('public', 'participants', 'participants_emergency_contact_phone_bidx_idx', 'participants_emergency_contact_phone_bidx_idx exists');
SELECT has_index('public', 'members', 'members_ec_email_bidx_idx', 'members_ec_email_bidx_idx exists');
SELECT has_index('public', 'members', 'members_ec_phone_bidx_idx', 'members_ec_phone_bidx_idx exists');
SELECT has_index('public', 'member_pending_consent', 'member_pending_consent_guardian_email_bidx_idx', 'member_pending_consent_guardian_email_bidx_idx exists');
SELECT col_type_is('public', 'participants', 'health_conditions', 'text', 'participants.health_conditions is still plaintext text');
SELECT col_type_is('public', 'participants', 'dietary_requirements', 'text[]', 'participants.dietary_requirements is still text[]');
SELECT col_type_is('public', 'members', 'ec_email', 'text', 'members.ec_email is still plaintext text');
SELECT col_type_is('public', 'member_pending_consent', 'guardian_email', 'text', 'member_pending_consent.guardian_email is still plaintext text');
SELECT lives_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k1', 'm1', 'wk1.m1.' || repeat('A', 80))$$,
  'an active data key can be stored for Stellr');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k2', 'm1', 'wk1.m1.' || repeat('B', 80))$$,
  '23505', NULL, 'a second active data key for the same tenant is refused');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k3', 'm2', 'wk1.m1.' || repeat('C', 80))$$,
  '23514', NULL, 'master_key_id must match the id inside wrapped_dek');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k4', 'm1', 'not-a-wrapped-key')$$,
  '23514', NULL, 'wrapped_dek must be in the wk1 format');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'bad key id', 'm1', 'wk1.m1.' || repeat('D', 80))$$,
  '23514', NULL, 'key_id must match the key-id pattern');
SELECT lives_ok(
  $$UPDATE public.tenant_data_keys SET retired_at = now() WHERE key_id = 'pgtap-k1'$$,
  'the active key can be retired');
SELECT lives_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k5', 'm1', 'wk1.m1.' || repeat('E', 80))$$,
  'after retiring the active key a new active key can be stored (DEK rotation)');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-000000000001', 'pgtap-k5', 'm1', 'wk1.m1.' || repeat('F', 80))$$,
  '23505', NULL, 'a key id is unique within a tenant');
SELECT throws_ok(
  $$INSERT INTO public.tenant_data_keys (tenant_id, key_id, master_key_id, wrapped_dek)
    VALUES ('00000000-0000-4000-8000-0000000000ff', 'pgtap-k6', 'm1', 'wk1.m1.' || repeat('G', 80))$$,
  '23503', NULL, 'a data key must belong to a real tenant');

SELECT * FROM finish();
ROLLBACK;
