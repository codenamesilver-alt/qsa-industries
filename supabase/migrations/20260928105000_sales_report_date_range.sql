-- Date-bounded sales reporting, for the /sales/reports export.
--
-- The four reporting views from 20260928100000 and 20260928103000 are all time
-- aggregates. None of them takes a parameter, because a view cannot, and a date
-- range cannot be pushed into one afterwards either: sales_by_region_period_totals,
-- sales_by_rep and sales_by_dealer have already summed the orders into one row per
-- group, so a month range cannot be recovered from them by the client. The one
-- date-bearing view, sales_by_region_period, buckets by month, which is enough to
-- post-filter its rows but not enough to make the other three answer the question.
--
-- The reporting export needs the screen and the file to agree, so the range has to
-- be applied where the rows are still order level. These four functions do that.
--
-- The views are deliberately left in place and untouched. The dashboard reads
-- sales_by_rep and sales_by_dealer for its own charts, and stage16 and stage17
-- assert the view definitions directly. Replacing the views would have put the
-- dashboard and 68 test assertions behind a behaviour change that a date range
-- export does not require. The functions are the additive path; the views remain
-- the all-time path.
--
-- Each function is security invoker, which is what keeps can_view_dealer
-- effective. The money rules of this report -- which order statuses count as
-- realized, which as pipeline, and which dealers the caller may see at all -- stay
-- in the database, exactly as they are for the views. Nothing here widens access:
-- these functions are granted to authenticated, and a caller outside
-- can_view_dealer still receives no rows, because the filter is in the query the
-- caller's own rights apply to rather than in a definer's context.
--
-- On the date column. The views bucket by
--
--   (o.created_at at time zone 'Asia/Kolkata')::date
--
-- and so do these functions, using the identical expression. This has to match
-- exactly. If a range were filtered on created_at::date in UTC instead, a report
-- covering 1 to 31 March would silently drop orders placed late on 31 March IST,
-- and the month buckets in sales_report_region_period would not reconcile against
-- the totals returned by the other three. p_to is inclusive of that whole day.
--
-- On nulls. A null bound means unbounded, so calling these with (null, null)
-- returns the same rows as the views do today. That keeps the unfiltered report
-- available rather than forcing a default window onto a screen that has always
-- shown all time.
--
-- On how the range is validated. The four functions are plpgsql and open with a
-- perform of private.assert_ordered_date_range, which is not a stylistic choice.
-- The first draft of this migration validated the range in a language sql body, as
-- a guard CTE cross joined to the report query. That version does not work: when
-- the visible order set is empty, the cross join produces no rows, the guard is
-- never evaluated, and the function returns zero rows instead of rejecting an
-- inverted range. An inverted range is precisely the input most likely to produce
-- an empty set, and it would have reported "no sales in that period" for a typo.
-- perform is unconditional, so the check cannot be skipped by the data.
--
-- On the dealer book and the ledger. open_invoices and outstanding_amount are
-- deliberately NOT bounded by the range, while realized, pipeline and invoiced
-- columns are. An invoice balance is a point-in-time fact about money still owed,
-- not a flow that happened inside a window; dating it to a period end would mean
-- reconstructing each invoice's balance as at that date from the payment
-- allocation history, which is a different question from the one this report asks
-- and is not what the /sales/reports screen or the Tally export claim to show.
-- The screen and the spreadsheet both label these two columns as a current
-- balance so no reader assumes all five money columns share one window.

-- ---------------------------------------------------------------------------
-- private.assert_ordered_date_range -- reject a backwards range once, centrally.
--
-- Without this the three order aggregates would each return zero rows for an
-- inverted range, which reads as "no sales in that period" rather than as the
-- mistake it is.
-- ---------------------------------------------------------------------------
create or replace function private.assert_ordered_date_range(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'date range start % is after end %', p_from, p_to
      using errcode = '22023';
  end if;
end;
$$;

comment on function private.assert_ordered_date_range(date, date) is
  'Raises invalid_parameter_value when a report range is inverted. A null bound is unbounded, so (null, null) is the all-time report and is never an error.';

-- ---------------------------------------------------------------------------
-- public.sales_report_region_period -- the monthly trend, bounded.
--
-- Mirrors public.sales_by_region_period, which sales_report_region_totals sums.
-- ---------------------------------------------------------------------------
create or replace function public.sales_report_region_period(p_from date, p_to date)
returns table (
  region text,
  period date,
  dealers_selling bigint,
  realized_orders bigint,
  realized_amount numeric,
  pipeline_orders bigint,
  pipeline_amount numeric,
  rejected_orders bigint,
  rejected_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.assert_ordered_date_range(p_from, p_to);

  return query
    with visible as (
      select
        o.id,
        o.status,
        o.total_amount,
        (o.created_at at time zone 'Asia/Kolkata')::date as order_date,
        private.region_of(o.dealer_id) as region,
        o.dealer_id
      from public.orders as o
      where private.can_view_dealer(o.dealer_id)
        and (
          p_from is null
          or (o.created_at at time zone 'Asia/Kolkata')::date >= p_from
        )
        and (
          p_to is null
          or (o.created_at at time zone 'Asia/Kolkata')::date <= p_to
        )
    )
    select
      v.region,
      date_trunc('month', v.order_date)::date as period,
      count(distinct v.dealer_id) filter (
        where v.status in ('approved', 'dispatched', 'invoiced')
      ) as dealers_selling,
      count(*) filter (
        where v.status in ('approved', 'dispatched', 'invoiced')
      ) as realized_orders,
      coalesce(
        sum(v.total_amount) filter (
          where v.status in ('approved', 'dispatched', 'invoiced')
        ),
        0
      ) as realized_amount,
      count(*) filter (
        where v.status in ('pending', 'pending_director_approval')
      ) as pipeline_orders,
      coalesce(
        sum(v.total_amount) filter (
          where v.status in ('pending', 'pending_director_approval')
        ),
        0
      ) as pipeline_amount,
      count(*) filter (where v.status = 'rejected') as rejected_orders,
      coalesce(
        sum(v.total_amount) filter (where v.status = 'rejected'),
        0
      ) as rejected_amount
    from visible as v
    group by v.region, date_trunc('month', v.order_date)::date;
end;
$$;

comment on function public.sales_report_region_period(date, date) is
  'Monthly regional trend for an optional inclusive order-date range, using the same Asia/Kolkata order date and the same realized/pipeline status rules as public.sales_by_region_period. A null bound is unbounded. Rows are scoped to dealers the caller may see.';

-- ---------------------------------------------------------------------------
-- public.sales_report_region_totals -- regional totals for the range.
--
-- Still keyed on region rather than region plus month, so it stays comparable
-- against sales_report_by_rep and against the region column of
-- sales_report_by_dealer. A region with no orders in the range is absent, the
-- same as the view.
-- ---------------------------------------------------------------------------
create or replace function public.sales_report_region_totals(p_from date, p_to date)
returns table (
  region text,
  dealer_count bigint,
  realized_orders bigint,
  realized_amount numeric,
  pipeline_orders bigint,
  pipeline_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.assert_ordered_date_range(p_from, p_to);

  return query
    select
      private.region_of(o.dealer_id) as region,
      count(distinct o.dealer_id) as dealer_count,
      count(*) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ) as realized_orders,
      coalesce(
        sum(o.total_amount) filter (
          where o.status in ('approved', 'dispatched', 'invoiced')
        ),
        0
      ) as realized_amount,
      count(*) filter (
        where o.status in ('pending', 'pending_director_approval')
      ) as pipeline_orders,
      coalesce(
        sum(o.total_amount) filter (
          where o.status in ('pending', 'pending_director_approval')
        ),
        0
      ) as pipeline_amount
    from public.orders as o
    where private.can_view_dealer(o.dealer_id)
      and (
        p_from is null
        or (o.created_at at time zone 'Asia/Kolkata')::date >= p_from
      )
      and (
        p_to is null
        or (o.created_at at time zone 'Asia/Kolkata')::date <= p_to
      )
    group by private.region_of(o.dealer_id);
end;
$$;

comment on function public.sales_report_region_totals(date, date) is
  'Regional realized and pipeline totals for an optional inclusive order-date range. dealer_count is a count of distinct dealers with orders in the range, so it narrows with the range and is not a headcount. A null bound is unbounded.';

-- ---------------------------------------------------------------------------
-- public.sales_report_by_rep -- rep and manager rollup for the range.
--
-- Names come from the same security definer helpers the view uses, so finance
-- still sees real names rather than the Unassigned placeholder. The 20260928103000
-- comment explains why the join to public.users is not an option here.
-- ---------------------------------------------------------------------------
create or replace function public.sales_report_by_rep(p_from date, p_to date)
returns table (
  rep_id uuid,
  rep_name text,
  manager_id uuid,
  manager_name text,
  region text,
  dealer_count bigint,
  realized_orders bigint,
  realized_amount numeric,
  pipeline_orders bigint,
  pipeline_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.assert_ordered_date_range(p_from, p_to);

  return query
    select
      o.sales_rep_id as rep_id,
      coalesce(private.sales_display_name(o.sales_rep_id), 'Unassigned rep') as rep_name,
      private.sales_manager_id(o.sales_rep_id) as manager_id,
      coalesce(private.sales_manager_name(o.sales_rep_id), 'Unassigned manager') as manager_name,
      private.region_of(o.dealer_id) as region,
      count(distinct o.dealer_id) as dealer_count,
      count(*) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ) as realized_orders,
      coalesce(
        sum(o.total_amount) filter (
          where o.status in ('approved', 'dispatched', 'invoiced')
        ),
        0
      ) as realized_amount,
      count(*) filter (
        where o.status in ('pending', 'pending_director_approval')
      ) as pipeline_orders,
      coalesce(
        sum(o.total_amount) filter (
          where o.status in ('pending', 'pending_director_approval')
        ),
        0
      ) as pipeline_amount
    from public.orders as o
    where private.can_view_dealer(o.dealer_id)
      and (
        p_from is null
        or (o.created_at at time zone 'Asia/Kolkata')::date >= p_from
      )
      and (
        p_to is null
        or (o.created_at at time zone 'Asia/Kolkata')::date <= p_to
      )
    group by
      o.sales_rep_id,
      coalesce(private.sales_display_name(o.sales_rep_id), 'Unassigned rep'),
      private.sales_manager_id(o.sales_rep_id),
      coalesce(private.sales_manager_name(o.sales_rep_id), 'Unassigned manager'),
      private.region_of(o.dealer_id);
end;
$$;

comment on function public.sales_report_by_rep(date, date) is
  'One row per rep per region for an optional inclusive order-date range, with the same realized and pipeline split and the same definer-resolved rep and manager names as public.sales_by_rep. A rep with orders in range and no hierarchy row is reported under Unassigned rather than dropped. A null bound is unbounded.';

-- ---------------------------------------------------------------------------
-- public.sales_report_by_dealer -- the dealer book for the range.
--
-- The order columns are bounded; open_invoices and outstanding_amount are a
-- current ledger balance and are not, as the header comment explains. Every
-- dealer the caller may see is present, including those with no orders in range,
-- so that a region dealer_count reconciles against this book.
-- ---------------------------------------------------------------------------
create or replace function public.sales_report_by_dealer(p_from date, p_to date)
returns table (
  dealer_id uuid,
  dealer_name text,
  region text,
  state text,
  status public.dealer_status,
  credit_limit numeric,
  realized_orders bigint,
  realized_amount numeric,
  pipeline_orders bigint,
  pipeline_amount numeric,
  invoiced_amount numeric,
  open_invoices bigint,
  outstanding_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.assert_ordered_date_range(p_from, p_to);

  return query
    select
      d.id as dealer_id,
      d.name as dealer_name,
      private.region_of(d.id) as region,
      d.state,
      d.status,
      d.credit_limit,
      coalesce(o.realized_orders, 0) as realized_orders,
      coalesce(o.realized_amount, 0) as realized_amount,
      coalesce(o.pipeline_orders, 0) as pipeline_orders,
      coalesce(o.pipeline_amount, 0) as pipeline_amount,
      coalesce(o.invoiced_amount, 0) as invoiced_amount,
      coalesce(inv.open_invoices, 0) as open_invoices,
      coalesce(inv.outstanding_amount, 0) as outstanding_amount
    from public.dealers as d
    left join (
      select
        o.dealer_id,
        count(*) filter (
          where o.status in ('approved', 'dispatched', 'invoiced')
        ) as realized_orders,
        coalesce(
          sum(o.total_amount) filter (
            where o.status in ('approved', 'dispatched', 'invoiced')
          ),
          0
        ) as realized_amount,
        count(*) filter (
          where o.status in ('pending', 'pending_director_approval')
        ) as pipeline_orders,
        coalesce(
          sum(o.total_amount) filter (
            where o.status in ('pending', 'pending_director_approval')
          ),
          0
        ) as pipeline_amount,
        coalesce(
          sum(o.total_amount) filter (where o.status = 'invoiced'),
          0
        ) as invoiced_amount
      from public.orders as o
      where private.can_view_dealer(o.dealer_id)
        and (
          p_from is null
          or (o.created_at at time zone 'Asia/Kolkata')::date >= p_from
        )
        and (
          p_to is null
          or (o.created_at at time zone 'Asia/Kolkata')::date <= p_to
        )
      group by o.dealer_id
    ) as o on o.dealer_id = d.id
    left join lateral (
      select
        count(*) filter (where l.outstanding_amount > 0) as open_invoices,
        coalesce(sum(l.outstanding_amount), 0) as outstanding_amount
      from public.dealer_ledger as l
      where l.dealer_id = d.id
    ) as inv on true
    where private.can_view_dealer(d.id);
end;
$$;

comment on function public.sales_report_by_dealer(date, date) is
  'One row per dealer visible to the caller for an optional inclusive order-date range. realized, pipeline and invoiced columns are bounded by the range; open_invoices and outstanding_amount are a current balance from dealer_ledger and are not, because a balance is owed right now rather than a flow inside a window. Dealers with no orders in range are present at zero. A null bound is unbounded.';

grant execute on function public.sales_report_region_period(date, date) to authenticated;
grant execute on function public.sales_report_region_totals(date, date) to authenticated;
grant execute on function public.sales_report_by_rep(date, date) to authenticated;
grant execute on function public.sales_report_by_dealer(date, date) to authenticated;
