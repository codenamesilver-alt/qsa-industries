-- The settlement order booked by 20260925092300 used default timestamps, so the
-- order reads as created 06 Sep, dispatched and invoiced 26 Sep, but paid 17 Sep.
-- Re-anchor the dispatch, invoice, payment and their audit rows to the order's own
-- creation date so the Green Valley timeline is chronological.

do $$
declare
  v_invoice_number constant text := 'QSA-2026-000012';
  v_order record;
  v_created date;
  v_dispatch date;
  v_invoice_date date;
  v_payment_date date;
begin
  select o.id, o.created_at::date as created
  into v_order
  from public.invoices as i
  join public.orders as o on o.id = i.order_id
  where i.invoice_number = v_invoice_number;

  if v_order is null then
    raise exception 'invoice % not found', v_invoice_number;
  end if;

  v_created := v_order.created;
  v_dispatch := v_created + 5;
  v_invoice_date := v_created + 7;
  v_payment_date := v_created + 8;

  if v_payment_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'refusing to backdate % into the future', v_payment_date;
  end if;

  update public.orders
  set dispatched_at = v_dispatch::timestamptz
  where id = v_order.id;

  update public.invoices
  set invoice_date = v_invoice_date,
      created_at = v_invoice_date::timestamptz
  where invoice_number = v_invoice_number;

  update public.payment_allocations
  set created_at = v_payment_date::timestamptz
  where invoice_id = (select id from public.invoices where invoice_number = v_invoice_number);

  update public.payments
  set payment_date = v_payment_date,
      created_at = v_payment_date::timestamptz
  where id in (
    select payment_id
    from public.payment_allocations
    where invoice_id = (select id from public.invoices where invoice_number = v_invoice_number)
  );

  update public.stock_movements
  set created_at = v_dispatch::timestamptz
  where source = 'sales' and reference_id = v_order.id;

  update public.order_events
  set created_at = case status
    when 'dispatched' then v_dispatch::timestamptz
    else v_invoice_date::timestamptz
  end
  where order_id = v_order.id
    and status in ('dispatched', 'invoiced');

  -- keep the rolling invoice sequence aligned with the renumbered dataset
  perform setval(
    'public.invoice_number_seq',
    (select count(*) from public.invoices),
    true
  );
end
$$;
