-- Family finance tracker: initial schema, recovered from the live "Finance DB" project.
-- Row-level security is enabled on every table with no policies (API access is denied by default).

create type public.membership_role as enum ('admin', 'member');
create type public.transaction_type as enum ('income', 'expense');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  role public.membership_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (user_id, household_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  created_by uuid not null references public.users(id),
  type public.transaction_type not null,
  amount numeric not null check (amount > 0),
  description text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month smallint not null check (month >= 1 and month <= 12),
  year smallint not null,
  amount numeric not null check (amount > 0),
  unique (household_id, category_id, month, year)
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  target_amount numeric not null check (target_amount > 0),
  current_amount numeric not null default 0,
  deadline date,
  created_at timestamptz not null default now()
);

create index idx_memberships_household on public.memberships (household_id);
create index idx_memberships_user on public.memberships (user_id);
create index idx_transactions_household on public.transactions (household_id);

alter table public.users enable row level security;
alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
