-- Migration 117: Member-initiated coaching requests (Academy "Request a coaching
-- session" self-serve intake — handover Workstream C / Option A).
--
-- Coaching stays coach-led at the point of delivery, but this adds the missing
-- inbound direction: a member submits a request, an admin matches a coach and
-- resolves eligibility, then the member schedules a slot (paying only when their
-- eligibility is `paid`). The actual session still lives in `sessions`
-- (session_type='coaching') via bookCoaching(), and entitlement is the ledger —
-- this table is only the lightweight request/queue record that ties them together.
--
-- Lifecycle: pending (awaiting admin) → matched (coach + eligibility set) →
-- scheduled (member booked a session). declined is a terminal admin outcome.

create table if not exists public.coaching_requests (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  -- Intake payload (from the public /academy/coaching/request form).
  topic           text not null,                    -- what they want coaching on
  stage           text,                             -- 'high-school' | 'college' | 'other'
  focus_area      text,                             -- portfolio / stem-skills / networking / interview / other
  availability    text[] not null default '{}',     -- e.g. {weekday-eves, weekends}
  note            text,
  -- Matching outcome (set by admin at match time).
  status          text not null default 'pending'
                    check (status in ('pending', 'matched', 'scheduled', 'declined')),
  coach_id        uuid references public.members(id) on delete set null,
  eligibility     text check (eligibility in ('included', 'award', 'paid')),
  -- Convergence links: the coaching container + the scheduled session.
  workshop_id     uuid references public.mentoring_cohorts(id) on delete set null,
  session_id      uuid references public.sessions(id) on delete set null,
  -- Decline + audit.
  decline_reason  text,
  declined_at     timestamptz,
  matched_at      timestamptz,
  scheduled_at    timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.coaching_requests enable row level security;

-- House convention: server code uses the service role; scope the blanket policy
-- to service_role (not public) so the anon key can't read/write requests.
do $$ begin
  create policy "service role full access coaching_requests"
    on public.coaching_requests for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

create index if not exists idx_coaching_requests_member on public.coaching_requests(member_id);
create index if not exists idx_coaching_requests_status on public.coaching_requests(status);
-- One live (non-terminal) request per member, so the intake can't stack duplicates
-- and the member hub has a single active request to surface.
create unique index if not exists uniq_coaching_requests_member_live
  on public.coaching_requests(member_id)
  where status in ('pending', 'matched', 'scheduled');
