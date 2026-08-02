-- Unipad object ledger (replaces Vercel Blob JSON paths).
-- Run in the Supabase SQL editor once per project.

create table if not exists public.unipad_objects (
  pathname text primary key,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists unipad_objects_pathname_prefix_idx
  on public.unipad_objects (pathname text_pattern_ops);

alter table public.unipad_objects enable row level security;

-- Server uses the service role key (bypasses RLS). No anon policies needed for the ledger.

-- Public media bucket for drop covers (create via dashboard or API if missing).
-- Storage → New bucket → name: unipad-media → Public: ON
insert into storage.buckets (id, name, public)
values ('unipad-media', 'unipad-media', true)
on conflict (id) do update set public = excluded.public;
