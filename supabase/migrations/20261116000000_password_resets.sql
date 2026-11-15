-- Single-use password reset tokens. Only a SHA-256 hash of the token is stored.
-- RLS is enabled with no policies, like every other table (only the backend connects).

create table public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_password_resets_user on public.password_resets (user_id, created_at);

alter table public.password_resets enable row level security;
