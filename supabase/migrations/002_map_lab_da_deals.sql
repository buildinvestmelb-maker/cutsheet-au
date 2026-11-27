-- Map Lab. DA — Commercial Cloud Deals Schema with Strict Row-Level Security
-- Run once in your Supabase SQL Editor when enabling multi-device cloud sync.

create table if not exists public.map_lab_deals (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 180),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  address text not null default '',
  parcel_id text not null default '',
  gross_area_sqm numeric not null check (gross_area_sqm > 0 and gross_area_sqm <= 5000000),
  earthworks_cost_aud numeric not null default 0,
  rlv_aud numeric not null default 0,
  developability_score integer not null default 0 check (developability_score between 0 and 100),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists map_lab_deals_user_updated_idx
  on public.map_lab_deals (user_id, updated_at desc);

create index if not exists map_lab_deals_user_state_idx
  on public.map_lab_deals (user_id, state);

alter table public.map_lab_deals enable row level security;

-- Strict Private Data Wall: User A can NEVER read, insert, update, or delete User B's rows
drop policy if exists "map_lab_deals_select_own" on public.map_lab_deals;
create policy "map_lab_deals_select_own"
  on public.map_lab_deals
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "map_lab_deals_insert_own" on public.map_lab_deals;
create policy "map_lab_deals_insert_own"
  on public.map_lab_deals
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "map_lab_deals_update_own" on public.map_lab_deals;
create policy "map_lab_deals_update_own"
  on public.map_lab_deals
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "map_lab_deals_delete_own" on public.map_lab_deals;
create policy "map_lab_deals_delete_own"
  on public.map_lab_deals
  for delete
  to authenticated
  using (auth.uid() = user_id);
