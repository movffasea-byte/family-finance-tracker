create type public.split_method      as enum ('fixed', 'percent');
create type public.allocation_status as enum ('proposed', 'approved', 'discarded');

create table public.split_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pocket_id    uuid not null references public.pockets(id) on delete cascade,
  method       public.split_method not null,
  value        numeric not null check (value > 0),
  priority     integer not null,
  unique (household_id, pocket_id),
  check (method = 'fixed' or value <= 100)
);

create table public.allocations (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  income_transaction_id uuid references public.transactions(id) on delete set null,
  status                public.allocation_status not null default 'proposed',
  created_by            uuid not null references public.users(id),
  decided_by            uuid references public.users(id),
  decided_at            timestamptz,
  created_at            timestamptz not null default now()
);
create index idx_allocations_household_status on public.allocations (household_id, status);

create table public.allocation_lines (
  id            uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.allocations(id) on delete cascade,
  pocket_id     uuid not null references public.pockets(id) on delete restrict,
  amount        numeric not null check (amount > 0),
  unique (allocation_id, pocket_id)
);

alter table public.pocket_moves
  add column allocation_id uuid references public.allocations(id) on delete restrict;

alter table public.split_rules      enable row level security;
alter table public.allocations      enable row level security;
alter table public.allocation_lines enable row level security;
