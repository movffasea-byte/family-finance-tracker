-- Every savings goal becomes a goal pocket that keeps the goal's own id, with an opening move
-- for the amount saved so far. Opening moves do not touch Ready to assign.
-- Names are made unique per household first, because pocket names must be.
insert into public.pockets (id, household_id, name, kind, target_amount, deadline, locked, created_at)
select g.id, g.household_id,
       case when g.rn > 1 or exists (
              select 1 from public.pockets p
               where p.household_id = g.household_id and lower(p.name) = lower(g.name) and p.archived_at is null
            )
            then left(g.name, 45) || ' (goal ' || g.rn || ')'
            else left(g.name, 60) end,
       'goal', g.target_amount, g.deadline, true, g.created_at
  from (
    select sg.*, row_number() over (partition by sg.household_id, lower(sg.name) order by sg.created_at, sg.id) as rn
      from public.savings_goals sg
  ) g;

insert into public.pocket_moves (household_id, from_pocket_id, to_pocket_id, amount, kind, note, created_by)
select g.household_id, null, g.id, g.current_amount, 'opening', 'Moved from savings goals',
       coalesce(
         (select m.user_id from public.memberships m
           where m.household_id = g.household_id and m.role = 'admin' order by m.joined_at limit 1),
         (select m.user_id from public.memberships m
           where m.household_id = g.household_id order by m.joined_at limit 1))
  from public.savings_goals g
 where g.current_amount > 0;

-- Check: every goal's saved amount must equal its pocket's opening balance. Fails the migration if not.
do $$
declare bad integer;
begin
  select count(*) into bad
    from public.savings_goals g
    left join (
      select to_pocket_id, sum(amount) as amt from public.pocket_moves where kind = 'opening' group by to_pocket_id
    ) m on m.to_pocket_id = g.id
   where coalesce(m.amt, 0) <> g.current_amount;
  if bad > 0 then
    raise exception 'Goals migration check failed: % goal(s) do not match their pocket balance', bad;
  end if;
end $$;

-- Kept, not dropped. Dropping it is a separate, later decision.
alter table public.savings_goals rename to savings_goals_legacy;
