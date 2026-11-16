create type public.pocket_kind as enum ('bill', 'savings', 'goal', 'emergency', 'spending');
create type public.move_kind   as enum ('allocation', 'transfer', 'cover', 'opening');

create table public.pockets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  kind          public.pocket_kind not null,
  target_amount numeric check (target_amount is null or target_amount > 0),
  sort_order    integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- Pocket names are unique among a household's active pockets.
create unique index uq_pockets_household_name_active
  on public.pockets (household_id, lower(name)) where archived_at is null;
create index idx_pockets_household on public.pockets (household_id);

-- A null from_pocket_id means the money came from "Ready to assign".
-- A null to_pocket_id means the money went back to "Ready to assign".
create table public.pocket_moves (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  from_pocket_id  uuid references public.pockets(id) on delete restrict,
  to_pocket_id    uuid references public.pockets(id) on delete restrict,
  amount          numeric not null check (amount > 0),
  kind            public.move_kind not null,
  note            text check (note is null or length(note) <= 200),
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  check (from_pocket_id is not null or to_pocket_id is not null),
  check (from_pocket_id is distinct from to_pocket_id)
);
create index idx_pocket_moves_household on public.pocket_moves (household_id, created_at desc);
create index idx_pocket_moves_from on public.pocket_moves (from_pocket_id);
create index idx_pocket_moves_to   on public.pocket_moves (to_pocket_id);

-- Expenses may be paid from a pocket. Income always lands in Ready to assign.
alter table public.transactions
  add column pocket_id uuid references public.pockets(id) on delete restrict;
alter table public.transactions
  add constraint transactions_income_has_no_pocket check (type = 'expense' or pocket_id is null);
create index idx_transactions_pocket on public.transactions (pocket_id);

alter table public.pockets      enable row level security;
alter table public.pocket_moves enable row level security;
