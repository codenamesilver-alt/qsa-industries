-- Corrective follow-up to 20260925092200_dev_demo_dataset.
--
-- The first cut of the development dataset overloaded dealer
-- 20000000-0000-4000-8000-000000000001 (Green Valley) past its 250000 credit limit
-- and left QSA-LAYER-01 far above the balance the pgTAP dispatch suites expect.
-- Both broke stage5_order_dispatch_test.sql and stage8_payment_allocation_test.sql,
-- which drive their workflow through that dealer and product.
--
-- This settles the dealer with the same RPCs the application uses and draws the
-- surplus layer feed down, so the dataset matches the corrected seed file without
-- hand editing rows or bypassing the business rules.

do $$
declare
  v_green_valley constant uuid := '20000000-0000-4000-8000-000000000001';
  v_layer_feed constant uuid := '30000000-0000-4000-8000-000000000001';
  v_finance constant uuid := '22145f21-ebba-4e23-8bc5-b9650307a4ea';
  v_logistics constant uuid := '890e8dd2-9940-4be8-b79c-a43c9de3ce0c';
  v_inventory constant uuid := '6a251aaf-5609-4b83-a04c-282929b6197b';

  v_invoice record;
  v_order_id uuid;
  v_surplus numeric;
begin
  ------------------------------------------------------------ clear invoice debt

  perform set_config('request.jwt.claim.sub', v_finance::text, true);

  for v_invoice in
    select i.id,
           i.invoice_number,
           i.total_amount - coalesce(sum(pa.amount), 0) as outstanding
    from public.invoices as i
    left join public.payment_allocations as pa on pa.invoice_id = i.id
    where i.dealer_id = v_green_valley
    group by i.id, i.invoice_number, i.total_amount
    having i.total_amount - coalesce(sum(pa.amount), 0) > 0
  loop
    perform public.record_invoice_payment(
      v_invoice.id,
      v_invoice.outstanding,
      (now() at time zone 'Asia/Kolkata')::date - 3,
      'bank_transfer',
      'NEFT/HDFC/settlement-' || right(v_invoice.invoice_number, 6)
    );
  end loop;

  --------------------------------------------- ship and settle stranded order

  -- The first cut of the seed left exactly one Green Valley order sitting in
  -- 'approved' while the dealer's open exposure breached the credit limit: the
  -- 1800 unit QSA-LAYER-01 order worth 57150.00. Target that order by its line
  -- composition rather than by "oldest approved order", because the corrected
  -- 20260925092200 file already dispatches, invoices and settles it and leaves
  -- the dealer's other approved order (1500 unit QSA-BROILER-01, 55350.00) in
  -- place for the workflow suites and the UI. Selecting by status alone would
  -- ship that second order on a fresh install, adding a thirteenth invoice and
  -- lowering QSA-BROILER-01 stock by 1500.
  select o.id into v_order_id
  from public.orders as o
  join public.order_items as oi on oi.order_id = o.id
  join public.products as p on p.id = oi.product_id
  where o.dealer_id = v_green_valley
    and p.sku = 'QSA-LAYER-01'
    and oi.quantity = 1800
  order by o.created_at
  limit 1;

  -- Only act while the order is still waiting. On a fresh install driven by the
  -- corrected seed file this block is a no-op and the settlement below is
  -- already on the books, so the whole corrective step becomes idempotent.
  if v_order_id is not null and exists (
    select 1 from public.orders as o where o.id = v_order_id and o.status = 'approved'
  ) then
    perform set_config('request.jwt.claim.sub', v_logistics::text, true);
    perform public.dispatch_order(
      v_order_id,
      (now() at time zone 'Asia/Kolkata')::date - 12,
      'Settlement dispatch'
    );

    perform set_config('request.jwt.claim.sub', v_finance::text, true);
    perform public.generate_invoice(v_order_id);

    select i.id, i.total_amount into v_invoice
    from public.invoices as i
    where i.order_id = v_order_id;

    perform public.record_invoice_payment(
      v_invoice.id,
      v_invoice.total_amount,
      (now() at time zone 'Asia/Kolkata')::date - 9,
      'bank_transfer',
      'NEFT/HDFC/6643550'
    );
  end if;

  ------------------------------------------------ clear surplus layer feed

  select sl.current_quantity - 1100 into v_surplus
  from public.stock_levels as sl
  where sl.product_id = v_layer_feed;

  if v_surplus > 0 then
    perform set_config('request.jwt.claim.sub', v_inventory::text, true);
    perform public.create_stock_adjustment(
      v_layer_feed,
      v_surplus,
      'out',
      'Batch write-off: LAYER-01 held past shelf life, godown 1 clearance'
    );
  end if;

  --------------------------------------------------------------- verify result

  if private.order_exposure(v_green_valley) >= (
    select coalesce(credit_limit_override, credit_limit) from public.dealers where id = v_green_valley
  ) then
    raise exception 'dealer 20000000-...-0001 still has no credit headroom: %',
      private.order_exposure(v_green_valley);
  end if;

  if exists (
    select 1
    from public.stock_levels as sl
    where sl.product_id = v_layer_feed
      and (sl.current_quantity < 1010 or sl.current_quantity >= 1210)
  ) then
    raise exception 'LAYER-01 stock % is outside the band the dispatch suites need',
      (select current_quantity from public.stock_levels where product_id = v_layer_feed);
  end if;
end
$$;
