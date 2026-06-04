-- Stellr Competition Registration Schema
-- Run this in the Supabase SQL editor for your project

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Registrations table (one per registration attempt)
create table if not exists public.registrations (
  id                      uuid primary key default uuid_generate_v4(),
  event_slug              text not null,
  event_title             text not null,
  type                    text not null check (type in ('individual', 'group')),
  status                  text not null default 'pending' check (status in ('pending', 'confirmed', 'withdrawn')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  withdrawn_at            timestamptz,
  -- Group-only fields (teacher/coach details)
  teacher_first_name      text,
  teacher_last_name       text,
  teacher_email           text,
  school_name             text,
  school_address_street   text,
  school_address_city     text,
  school_address_state    text,
  school_address_zip      text,
  invoice_requested       boolean not null default false
);

-- Participants table (one per person per registration)
create table if not exists public.participants (
  id                              uuid primary key default uuid_generate_v4(),
  registration_id                 uuid not null references public.registrations(id) on delete cascade,
  first_name                      text not null,
  last_name                       text not null,
  nickname                        text,
  email                           text not null,
  phone                           text not null,
  date_of_birth                   date not null,
  grade                           text not null,
  gender                          text not null,
  ethnicity                       text[] not null default '{}',
  t_shirt_size                    text not null,
  school_name                     text not null,
  age_bracket                     text not null,
  event_role                      text not null,
  dietary_requirements            text[] not null default '{}',
  health_conditions               text,
  emergency_contact_first_name    text not null,
  emergency_contact_last_name     text not null,
  emergency_contact_email         text not null,
  emergency_contact_phone         text not null,
  company_name                    text,  -- assigned by admin pre-event
  award                           text,  -- set post-event
  created_at                      timestamptz not null default now()
);

-- Duplicate prevention: same email cannot register for the same event twice
create unique index if not exists participants_event_email_unique
  on public.participants (registration_id, email);

-- Prevent same email appearing in two different registrations for the same event
-- (handled at API level via query before insert)

-- Auto-update updated_at on registrations
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger registrations_updated_at
  before update on public.registrations
  for each row execute procedure public.set_updated_at();

-- Indexes
create index if not exists registrations_event_slug_idx on public.registrations(event_slug);
create index if not exists participants_registration_id_idx on public.participants(registration_id);
create index if not exists participants_email_idx on public.participants(email);

-- Row Level Security (enable but allow service role full access)
alter table public.registrations enable row level security;
alter table public.participants enable row level security;

-- Service role can do everything (used by server-side API routes)
create policy "service role full access registrations"
  on public.registrations for all
  using (true)
  with check (true);

create policy "service role full access participants"
  on public.participants for all
  using (true)
  with check (true);
