-- 102_harden_function_search_path.sql
-- Security hardening (advisor lint function_search_path_mutable). Pins an explicit,
-- non-mutable search_path on the public functions that lacked one. All ten are
-- NON-SECURITY-DEFINER (so the practical risk was low — no privilege escalation), but a
-- fixed search_path is best practice and clears the advisor. 'public' keeps their
-- unqualified table references resolving exactly as before.

alter function public.audit_members() set search_path = public;
alter function public.consume_session_credit(uuid, text, uuid) set search_path = public;
alter function public.decrement_post_comment_count(uuid) set search_path = public;
alter function public.flag_manual_grade_edit() set search_path = public;
alter function public.increment_post_comment_count(uuid) set search_path = public;
alter function public.increment_resource_download(uuid) set search_path = public;
alter function public.participants_inherit_member_membership_id() set search_path = public;
alter function public.promote_grades() set search_path = public;
alter function public.set_training_progress(uuid, uuid, text) set search_path = public;
alter function public.set_updated_at() set search_path = public;
