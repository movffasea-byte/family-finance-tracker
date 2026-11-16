create type public.bill_frequency as enum ('monthly', 'yearly');
create type public.move_status    as enum ('done', 'pending', 'cancelled');

-- Locked pockets: money leaving them waits 24 hours before it can be confirmed.
alter table public.pockets add column locked boolean not null default false;
alter table public.pockets add column deadline date;
update public.pockets set locked = true where kind in ('savings', 'emergency', 'goal');

-- Pending and cancelled moves do not count toward any balance.
alter table public.pocket_moves add column status public.move_status not null default 'done';
alter table public.pocket_moves add column available_at timestamptz;
alter table public.pocket_moves
  add constraint pocket_moves_pending_has_time check (status <> 'pending' or available_at is not null);
create index idx_pocket_moves_status on public.pocket_moves (household_id, status);

create table public.bills (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pocket_id    uuid not null references public.pockets(id) on delete restrict,
  name         text not null check (length(name) between 1 and 100),
  amount       numeric not null check (amount > 0),
  frequency    public.bill_frequency not null,
  due_day      integer not null check (due_day between 1 and 31),
  due_month    integer check (due_month between 1 and 12),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (frequency = 'monthly' or due_month is not null)
);
create index idx_bills_household on public.bills (household_id);
create index idx_bills_pocket on public.bills (pocket_id);

alter table public.bills enable row level security;
