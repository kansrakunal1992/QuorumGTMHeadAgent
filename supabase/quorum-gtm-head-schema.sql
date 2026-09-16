-- ─────────────────────────────────────────────────────────────────────────
-- QUORUM GTM HEAD — Supabase Schema
-- Run this in the SAME Supabase project as the main Quorum app:
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Everything here is prefixed gtm_ and additive-only. It does not touch,
-- rename, or alter any existing Quorum table (sessions, mirror_access,
-- decision_session_payments, referrals, auth.users, etc). The GTM Head
-- reads those existing tables for analytics but never writes to them.
-- Safe to re-run (all IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- ── GTM Memory ──────────────────────────────────────────────────────────
-- Structured, persisted GTM learnings only — never a raw dump of every LLM
-- output. category + status let stale/rejected learnings be superseded
-- rather than deleted (keeps an audit trail of what the agent used to
-- believe and why it changed its mind).
create table if not exists gtm_memory (
  id                uuid primary key default uuid_generate_v4(),
  category          text not null check (category in (
                      'product','positioning','icp','customer','objection',
                      'channel','messaging','experiment','competitor',
                      'founder_preference','operational_rule','learning'
                    )),
  content           text not null,
  source            text not null,
  confidence        numeric not null default 0.5 check (confidence between 0 and 1),
  evidence          jsonb not null default '[]'::jsonb,
  status            text not null default 'active' check (status in ('active','superseded','rejected')),
  created_at        timestamptz not null default now(),
  last_validated_at timestamptz not null default now()
);
create index if not exists idx_gtm_memory_category on gtm_memory(category, status);

-- ── ICP Hypotheses ──────────────────────────────────────────────────────
create table if not exists gtm_icp_hypotheses (
  id                     uuid primary key default uuid_generate_v4(),
  description            text not null,
  pain                   text,
  trigger                text,
  likely_decision_types  jsonb not null default '[]'::jsonb,
  value_proposition      text,
  channels               jsonb not null default '[]'::jsonb,
  confidence             numeric not null default 0.3 check (confidence between 0 and 1),
  evidence               jsonb not null default '[]'::jsonb,
  objections             jsonb not null default '[]'::jsonb,
  status                 text not null default 'testing' check (status in ('testing','promising','weak','rejected')),
  source                 text not null default 'agent_generated' check (source in ('site','agent_generated','founder_stated')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── Prospects ───────────────────────────────────────────────────────────
create table if not exists gtm_prospects (
  id                 uuid primary key default uuid_generate_v4(),
  name               text not null,
  company            text,
  role               text,
  geography          text,
  email              text,
  phone              text,
  linkedin_url       text,
  linkedin_handle    text,
  instagram_handle   text,
  whatsapp           text,
  source             text not null,
  icp_hypothesis_id  uuid references gtm_icp_hypotheses(id) on delete set null,
  fit_score          numeric,
  trigger            text,
  pain_signal        text,
  status             text not null default 'new' check (status in
                       ('new','queued','contacted','replied','no_response','not_relevant','blocked')),
  last_contacted_at  timestamptz,
  next_action        text,
  response            text,
  objection           text,
  notes               text,
  provenance          text not null,
  confidence          numeric not null default 0.5 check (confidence between 0 and 1),
  created_at          timestamptz not null default now()
);
create index if not exists idx_gtm_prospects_status on gtm_prospects(status);
-- Prevent accidental duplicate prospect rows for the same person.
create unique index if not exists idx_gtm_prospects_dedup
  on gtm_prospects (coalesce(email, ''), coalesce(linkedin_url, ''), coalesce(whatsapp, ''))
  where email is not null or linkedin_url is not null or whatsapp is not null;

-- ── Experiments ─────────────────────────────────────────────────────────
create table if not exists gtm_experiments (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  hypothesis   text not null,
  problem      text,
  audience     text,
  channel      text not null,
  variant      text,
  action       text,
  metric       text not null,
  baseline     numeric,
  target       numeric,
  result       numeric,
  confidence   numeric,
  conclusion   text,
  status       text not null default 'proposed' check (status in
                 ('proposed','running','successful','inconclusive','failed','retired','scaled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Activity Log (the audit trail behind the Founder Dashboard) ─────────
create table if not exists gtm_activity_log (
  id              uuid primary key default uuid_generate_v4(),
  timestamp       timestamptz not null default now(),
  action_type     text not null,
  channel         text not null,
  autonomy_level  text not null,
  target          text,
  reason          text not null,
  hypothesis      text,
  content         text,
  status          text not null check (status in ('done','failed','skipped','queued_for_founder')),
  result          text,
  metric          text,
  cost            numeric not null default 0,
  confidence      numeric,
  follow_up       text,
  experiment_id   uuid references gtm_experiments(id) on delete set null
);
create index if not exists idx_gtm_activity_log_time on gtm_activity_log(timestamp desc);

-- ── Founder Action Queue ────────────────────────────────────────────────
create table if not exists gtm_founder_actions (
  id                    uuid primary key default uuid_generate_v4(),
  created_at            timestamptz not null default now(),
  channel               text not null check (channel in ('linkedin','whatsapp','email','instagram')),
  target_name           text not null,
  target_destination    text not null,
  exact_message         text not null,
  why_this_person       text not null,
  why_this_message      text not null,
  recommended_timing    text,
  expected_objective    text,
  state                 text not null default 'pending' check (state in
                          ('pending','sent','rejected','snoozed','edited',
                           'wrong_target','not_relevant','blocked_type','done')),
  prospect_id           uuid references gtm_prospects(id) on delete set null,
  experiment_id         uuid references gtm_experiments(id) on delete set null
);
create index if not exists idx_gtm_founder_actions_state on gtm_founder_actions(state);

-- ── Content Queue (broadcast content — LinkedIn/Instagram posts, WhatsApp
--    Status — as distinct from gtm_founder_actions, which is targeted 1:1
--    outreach to a specific named prospect) ────────────────────────────
create table if not exists gtm_content_queue (
  id                uuid primary key default uuid_generate_v4(),
  created_at        timestamptz not null default now(),
  date              date not null default current_date,
  channel           text not null check (channel in ('linkedin_post','instagram_post','whatsapp_status')),
  category          text not null,
  hook              text,
  body              text not null,
  cta               text,
  uses_proof_point  boolean not null default false,
  source_evidence   text,
  state             text not null default 'pending' check (state in ('pending','posted','rejected','skipped')),
  bottleneck        text
);
create index if not exists idx_gtm_content_queue_date on gtm_content_queue(date, state);

-- ── Daily Plans ─────────────────────────────────────────────────────────
create table if not exists gtm_daily_plans (
  id                 uuid primary key default uuid_generate_v4(),
  date               date not null unique,
  objective          text not null,
  bottleneck         text not null check (bottleneck in
                       ('traffic','activation','second_decision','conversion','retention')),
  candidate_actions  jsonb not null default '[]'::jsonb,
  chosen_actions     jsonb not null default '[]'::jsonb,
  reasoning_summary  text,
  created_at         timestamptz not null default now()
);

-- ── End-of-day reports ──────────────────────────────────────────────────
create table if not exists gtm_daily_reports (
  id           uuid primary key default uuid_generate_v4(),
  date         date not null unique,
  report_json  jsonb not null,
  created_at   timestamptz not null default now()
);

-- ── Daily usage counters (atomic — safe under parallel workers) ─────────
create table if not exists gtm_daily_usage (
  date         date not null,
  action_key   text not null,
  used_count   int not null default 0,
  primary key (date, action_key)
);

-- Atomically increments a counter and returns the new value in one
-- round trip, so two parallel workers can never both slip past a cap.
create or replace function gtm_increment_usage(p_date date, p_action_key text, p_amount int default 1)
returns int
language plpgsql
as $$
declare
  new_count int;
begin
  insert into gtm_daily_usage (date, action_key, used_count)
  values (p_date, p_action_key, p_amount)
  on conflict (date, action_key)
  do update set used_count = gtm_daily_usage.used_count + excluded.used_count
  returning used_count into new_count;

  return new_count;
end;
$$;

-- Row Level Security: service-role only (no anon/browser access to any
-- gtm_* table — this whole system is founder-facing, admin-authenticated
-- at the application layer, same pattern as the main app's /api/admin/*).
alter table gtm_memory          enable row level security;
alter table gtm_icp_hypotheses  enable row level security;
alter table gtm_prospects       enable row level security;
alter table gtm_experiments     enable row level security;
alter table gtm_activity_log    enable row level security;
alter table gtm_founder_actions enable row level security;
alter table gtm_content_queue   enable row level security;
alter table gtm_daily_plans     enable row level security;
alter table gtm_daily_reports   enable row level security;
alter table gtm_daily_usage     enable row level security;
-- No policies are created — with RLS enabled and zero policies, only the
-- service-role key (which bypasses RLS entirely) can touch these tables.
