-- Fix public.dealer_rep_coverage.dealer_count, which counted orders rather than
-- dealers.
--
-- 20260928101000 builds the figure with:
--
--   from public.dealers as dl
--   left join public.orders as o on o.dealer_id = dl.id
--   where dl.sales_rep_id = u.id
--   ...
--   count(*) as dealer_count
--
-- count(*) over that join counts joined rows, so a dealer contributes one row per
-- order it has. On the demo project Ravi Menon holds two dealers and the view
-- reported nine; Vikram Desai holds one and it reported thirty-six. The sales team
-- screen prints this column as "N dealers" and draws a coverage bar from it, so the
-- screen showed a rep with more accounts than exist in the book and a bar that
-- could not be compared with anything.
--
-- The amounts in the same lateral were already correct, because sum() over orders
-- is what they were after. Only the count was wrong, and it was wrong in the one
-- direction that looks like a plausible number: a coverage report that overstates
-- it is not obviously broken, it is just useless for spotting the rep who holds
-- nothing, which is the question the view exists to answer.
--
-- count(distinct dl.id) is the dealer count. It stays one row per dealer with no
-- orders, because the left join keeps it, which is the case the view exists for.
--
-- create or replace view, not a new name: the web client selects * from this view
-- and the column is already part of its contract. The fix is in place before
-- anyone reads the view rather than behind a migration window.
--
-- A rep holding no dealer at all must still read zero rather than be dropped, so
-- the coalesce and the lateral are left as they are. The seeded project has reps
-- with no dealers only if one is created by hand, and the assertion in stage17
-- covers the shape rather than the seeded data.

create or replace view public.dealer_rep_coverage
with (security_invoker = true)
as
select
  u.id as rep_id,
  u.full_name as rep_name,
  u.is_active,
  coalesce(mgr.full_name, 'Unassigned manager') as manager_name,
  coalesce(d.dealer_count, 0) as dealer_count,
  coalesce(d.realized_amount, 0) as realized_amount,
  coalesce(d.pipeline_amount, 0) as pipeline_amount,
  coalesce(ua.unassigned_dealers, 0) as unassigned_dealers
from public.users as u
left join public.user_hierarchy as h on h.user_id = u.id
left join public.users as mgr on mgr.id = h.manager_id
left join lateral (
  select
    count(distinct dl.id) as dealer_count,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ),
      0
    ) as realized_amount,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('pending', 'pending_director_approval')
      ),
      0
    ) as pipeline_amount
  from public.dealers as dl
  left join public.orders as o on o.dealer_id = dl.id
  where dl.sales_rep_id = u.id
) as d on true
-- Unassigned dealers are counted once per rep, which is a lie as a total but is the
-- only shape that answers the per-rep question without a second endpoint. It is
-- named as a count and never summed across rows: the caller shows it as a reminder,
-- not as a figure. A single scalar view would be honest and would not answer
-- "which of my reps is free to take one on".
left join lateral (
  select count(*) as unassigned_dealers
  from public.dealers as free
  where free.sales_rep_id is null
    and free.status = 'active'
    and private.can_manage_rep(u.id)
) as ua on true
where u.role = 'sales_rep';

comment on view public.dealer_rep_coverage is
  'One row per sales rep, including reps holding nothing. dealer_count counts distinct dealers, not joined order rows, so a rep with one busy dealer is not reported as holding dozens of accounts.';
