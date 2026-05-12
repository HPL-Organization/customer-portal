-- ============================================================
-- Migration: communication_preferences
-- Description: Stores per-customer communication preference
--              selections. Supabase is the source of truth;
--              HubSpot is an async sync destination.
--
-- Scale target: 5,000 DAU
-- Primary lookup: customer_id (NetSuite NS id)
-- Secondary:      user_id (Supabase auth UID, for pre-NS users)
-- ============================================================

-- ── 1. Custom ENUM types ────────────────────────────────────
-- Using ENUMs keeps values strongly validated at the DB layer
-- and makes them fast to compare (stored as int internally).

create type comm_frequency as enum (
  'all',
  'weekly',
  'monthly',
  'none'
);

create type comm_reminder as enum (
  'none',
  'hour',
  'day'
);

-- ── 2. Table ────────────────────────────────────────────────

create table if not exists communication_preferences (
  id              bigint generated always as identity primary key,

  -- Identity — exactly one must be non-null
  customer_id     bigint          null,   -- NetSuite customer internal ID
  user_id         uuid            null references auth.users (id) on delete cascade,

  -- ── Live Events ──────────────────────────────────────────
  live_events_general         comm_frequency  not null default 'none',
  live_events_reminders       comm_reminder   not null default 'none',
  live_events_channel_email   boolean         not null default false,
  live_events_channel_sms     boolean         not null default false,

  -- ── Educational Newsletters & Guides ─────────────────────
  newsletters_frequency       comm_frequency  not null default 'none',

  -- ── Promotions & Announcements ───────────────────────────
  promotions_general          comm_frequency  not null default 'none',
  promotions_discounts        comm_frequency  not null default 'none',
  promotions_new_products     comm_frequency  not null default 'none',

  -- ── Customer Support (order updates are always-on; omitted) ─
  support_tickets_email       boolean         not null default true,
  support_tickets_sms         boolean         not null default false,

  -- ── Audit ─────────────────────────────────────────────────
  updated_at      timestamptz     not null default now(),
  hs_synced_at    timestamptz     null,       -- set after successful HubSpot push

  -- ── Constraints ───────────────────────────────────────────
  constraint comm_prefs_customer_or_user check (
    (customer_id is not null) or (user_id is not null)
  ),
  constraint comm_prefs_unique_customer unique (customer_id),
  constraint comm_prefs_unique_user     unique (user_id)
);

-- ── 3. Indexes ──────────────────────────────────────────────
-- Primary lookup by customer_id (the hot path for logged-in users)
create index if not exists idx_comm_prefs_customer_id
  on communication_preferences (customer_id)
  where customer_id is not null;

-- Secondary lookup by user_id (pre-NS or new-signup users)
create index if not exists idx_comm_prefs_user_id
  on communication_preferences (user_id)
  where user_id is not null;

-- HubSpot sync job: find rows that haven't been synced yet
-- or have been updated after their last sync
create index if not exists idx_comm_prefs_hs_sync_pending
  on communication_preferences (updated_at, hs_synced_at)
  where hs_synced_at is null or hs_synced_at < updated_at;

-- ── 4. updated_at trigger ───────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_comm_prefs_updated_at on communication_preferences;
create trigger trg_comm_prefs_updated_at
  before update on communication_preferences
  for each row execute function set_updated_at();

-- ── 5. Row-Level Security ────────────────────────────────────
alter table communication_preferences enable row level security;

-- Users can only read/write their own row
create policy "comm_prefs_select_own"
  on communication_preferences for select
  using (user_id = auth.uid());

create policy "comm_prefs_insert_own"
  on communication_preferences for insert
  with check (user_id = auth.uid());

create policy "comm_prefs_update_own"
  on communication_preferences for update
  using (user_id = auth.uid());

-- Service role bypasses RLS automatically (used by API routes
-- that authenticate server-side with the service key).

-- ── 6. Comments ─────────────────────────────────────────────
comment on table communication_preferences is
  'One row per customer. Stores their email/SMS notification preferences. Source of truth; HubSpot is synced asynchronously.';

comment on column communication_preferences.customer_id is
  'NetSuite internal customer ID (custentity). Populated once the NS account is linked.';

comment on column communication_preferences.user_id is
  'Supabase auth UID. Used as the primary key for new users before a NS id is assigned.';

comment on column communication_preferences.hs_synced_at is
  'Timestamp of the last successful sync to HubSpot. NULL means pending sync. Used by the sync job index.';
