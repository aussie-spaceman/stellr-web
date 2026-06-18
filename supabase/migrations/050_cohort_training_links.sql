-- Migration 050: referenced training material for mentoring cohorts (PRD §11).
--
-- A Mentoring Cohort is "a private Space" that includes referenced training
-- material. This table links a cohort to training modules, each marked mandatory
-- or optional with an optional per-cohort due date. Surfaced in the cohort space
-- (M1) and editable by admins (M1) and the mentor (M3).

create table if not exists public.cohort_training_links (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.mentoring_cohorts(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade,
  is_mandatory boolean not null default false,
  due_at timestamptz,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (cohort_id, module_id)
);

create index if not exists cohort_training_links_cohort_idx
  on public.cohort_training_links (cohort_id);

-- Service-role only: the server gates access in lib/sessions, consistent with the
-- other community tables and the corrected RLS posture (migration 049).
alter table public.cohort_training_links enable row level security;

do $$ begin
  create policy "service_role all cohort_training_links" on public.cohort_training_links
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;
