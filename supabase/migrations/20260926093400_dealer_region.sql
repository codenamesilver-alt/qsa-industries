-- Dealer region, for the sales reporting the PRD asks for by region.
--
-- Section 9.4 lists sales trends "by dealer, rep, manager, region/period", but a
-- dealer had no region attribute at all -- only a free-text state. State is not
-- a sales territory (it is a GST place-of-supply input and is used for the tax
-- split), so region is added as its own field rather than being inferred from it.
--
-- The column stays nullable on purpose: guessing a territory for a real dealer is
-- a commercial decision, not a schema one, and the reporting view falls back to
-- state and then to 'Unassigned' so nothing silently disappears from a rollup.
--
-- The six seeded demo dealers are the exception. They are fixture data, and a
-- region report where every dealer is unassigned cannot be evaluated at all, so
-- they are grouped geographically below. Real dealers are left for the sales
-- team to classify.

alter table public.dealers
  add column if not exists region text;

comment on column public.dealers.region is
  'Sales territory, e.g. North West. Independent of state, which is used for GST place of supply.';

update public.dealers
   set region = v.region
  from (values
    ('20000000-0000-4000-8000-000000000001'::uuid, 'West'),    -- Nashik, Maharashtra
    ('20000000-0000-4000-8000-000000000002'::uuid, 'West'),    -- Pune, Maharashtra
    ('20000000-0000-4000-8000-000000000006'::uuid, 'West'),    -- Pune, Maharashtra
    ('20000000-0000-4000-8000-000000000005'::uuid, 'South'),   -- Kozhikode, Kerala
    ('20000000-0000-4000-8000-000000000003'::uuid, 'East'),    -- Rajahmundry, Andhra Pradesh
    ('20000000-0000-4000-8000-000000000004'::uuid, 'North East') -- Shillong, Meghalaya
  ) as v(dealer_id, region)
 where dealers.id = v.dealer_id
   and (dealers.region is null or btrim(dealers.region) = '');

-- Admin and finance own dealer master data. Everyone who can already see the
-- dealer keeps seeing it; the write is limited to the two roles that set credit
-- terms, because a territory mistake is a commercial decision.
drop policy if exists dealers_update_internal on public.dealers;

create policy dealers_update_internal
  on public.dealers
  for update
  to authenticated
  using (
    private.current_user_role() = any (array['admin'::public.user_role, 'finance'::public.user_role])
  )
  with check (
    private.current_user_role() = any (array['admin'::public.user_role, 'finance'::public.user_role])
  );

grant update (region, credit_limit, credit_limit_override, status)
  on table public.dealers to authenticated;

-- Sales performance rolled up by region. Falls back through region -> state so a
-- dealer nobody has classified yet still appears somewhere rather than vanishing.
drop view if exists public.sales_by_region;

create view public.sales_by_region
with (security_invoker = true)
as
select
  coalesce(nullif(d.region, ''), nullif(d.state, ''), 'Unassigned') as region,
  count(distinct d.id) as dealer_count,
  count(distinct o.id) as order_count,
  coalesce(sum(o.total_amount), 0) as order_value,
  coalesce(
    sum(
      case
        when o.status = 'invoiced' then o.total_amount
        else 0
      end
    ),
    0
  ) as invoiced_value
from public.dealers d
left join public.orders o
  on o.dealer_id = d.id
 and private.can_view_dealer(d.id)
group by coalesce(nullif(d.region, ''), nullif(d.state, ''), 'Unassigned');

grant select on public.sales_by_region to authenticated;
