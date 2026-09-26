-- Development demo dataset for QSA Industries ERP.
--
-- Fills every business table with coherent, lifecycle-valid data so each screen in
-- the app has something real to render and every workflow can be clicked through
-- end to end.
--
-- Data is created through the real business RPCs (create_stock_adjustment,
-- create_production_run, create_dealer_order, approve_order, escalate_order,
-- director_approve_order, director_reject_order, dispatch_order,
-- generate_invoice, record_invoice_payment, record_dealer_payment,
-- record_tally_export) so every trigger, invariant, stock movement and role gate is
-- exercised exactly the way the application exercises it. Timestamps are then
-- backdated to lay down a realistic 60 day history for ageing and reporting.

create or replace function public.qsa_dev_ts(days_back integer)
returns timestamptz
language sql
stable
as $$
  select (
    (((now() at time zone 'Asia/Kolkata')::date - days_back)::timestamp
      + make_time(9 + (days_back % 8), (days_back * 13) % 60, 0::double precision))
  ) at time zone 'Asia/Kolkata'
$$;

-- Mirrors the price resolution inside public.create_dealer_order so that orders
-- seeded directly (dealers other than the one holding a dealer login) are priced
-- by exactly the same rule: dealer specific price first, then the standard dealer
-- tier, then the catalogue price, honouring the validity window.
create or replace function public.qsa_dev_price(target_product_id uuid, target_dealer_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(pl.price, p.price)
  from public.products as p
  left join lateral (
    select price
    from public.price_lists
    where product_id = p.id
      and (
        dealer_id = target_dealer_id
        or (dealer_id is null and price_tier = 'standard_dealer')
      )
      and (valid_from is null or valid_from <= (now() at time zone 'Asia/Kolkata')::date)
      and (valid_to is null or valid_to >= (now() at time zone 'Asia/Kolkata')::date)
    order by dealer_id is not null desc, valid_from desc nulls last, id desc
    limit 1
  ) as pl on true
  where p.id = target_product_id
$$;

do $$
declare
  v_director constant uuid := '10000000-0000-4000-8000-000000000002';
  v_imran constant uuid := '10000000-0000-4000-8000-000000000003';
  v_meera constant uuid := '10000000-0000-4000-8000-000000000004';
  v_ravi constant uuid := '10000000-0000-4000-8000-000000000005';
  v_sana constant uuid := '10000000-0000-4000-8000-000000000006';
  v_vikram constant uuid := '10000000-0000-4000-8000-000000000007';
  v_ananya constant uuid := '10000000-0000-4000-8000-000000000008';
  v_production constant uuid := 'bddaf4a6-c4c0-4637-8369-c3cb7338098d';
  v_inventory constant uuid := '6a251aaf-5609-4b83-a04c-282929b6197b';
  v_logistics constant uuid := '890e8dd2-9940-4be8-b79c-a43c9de3ce0c';
  v_finance constant uuid := '22145f21-ebba-4e23-8bc5-b9650307a4ea';
  v_dealer_user constant uuid := '4637f04f-aed6-44bc-82d8-774991079d1d';

  v_green_valley constant uuid := '20000000-0000-4000-8000-000000000001';
  v_sunrise constant uuid := '20000000-0000-4000-8000-000000000002';
  v_coastal constant uuid := '20000000-0000-4000-8000-000000000003';
  v_highland constant uuid := '20000000-0000-4000-8000-000000000004';
  v_sunset constant uuid := '20000000-0000-4000-8000-000000000005';
  v_legacy constant uuid := '20000000-0000-4000-8000-000000000006';

  v_spec record;
  v_line record;
  v_lines jsonb;
  v_order_id uuid;
  v_invoice record;
  v_payment_id uuid;
  v_product_id uuid;
  v_surplus numeric;
  v_maize constant uuid := '30000000-0000-4000-8000-000000000006';
  v_soy constant uuid := '30000000-0000-4000-8000-000000000007';
  v_premix constant uuid := '30000000-0000-4000-8000-000000000008';
  v_materials jsonb;
  v_created integer;
  v_dispatched integer;
  v_paid integer;
  v_amount numeric;
begin
  if exists (select 1 from public.orders)
     or exists (select 1 from public.production_runs) then
    raise exception 'qsa_dev_dataset: transactional data already exists, refusing to double seed';
  end if;

  ---------------------------------------------------------------- master data

  insert into public.products (id, sku, name, category, unit_of_measure, price, low_stock_threshold, active, is_sellable)
  values
    ('30000000-0000-4000-8000-000000000009', 'QSA-BROILER-03', 'Broiler Grower Feed', 'Poultry Feed', 'kg', 36.00, 1200, true, true),
    ('30000000-0000-4000-8000-000000000010', 'QSA-LAYER-MASH2', 'Layer Mash 2mm (Legacy)', 'Poultry Feed', 'kg', 33.00, 200, true, false),
    ('30000000-0000-4000-8000-000000000011', 'QSA-GROWER-02', 'Grower Feed Crumble', 'Poultry Feed', 'kg', 31.00, 350, false, true)
  on conflict (sku) do nothing;

  insert into public.dealers (
    id, name, contact_person, phone, email, address_line1, city, state, postal_code,
    credit_limit, credit_limit_override, sales_rep_id, status
  )
  values
    (v_highland, 'Highland Poultry Cooperative', 'Joseph Kire', '+91 98450 33118',
     'purchase@highlandpoultry.in', 'Plot 22, Veterinary Road', 'Shillong', 'Meghalaya', '793001',
     120000, null, v_ananya, 'active'),
    (v_sunset, 'Sunset Livestock Traders', 'Farida Qureshi', '+91 94470 90233',
     'orders@sunsetlivestock.in', 'Warehouse 4, Old Market Yard', 'Kozhikode', 'Kerala', '673001',
     60000, null, v_sana, 'suspended'),
    (v_legacy, 'Legacy Agro Supplies', null, '+91 90000 00000', null, null, 'Pune', 'Maharashtra', '411001',
     0, null, v_ravi, 'inactive')
  on conflict (id) do nothing;

  insert into public.price_lists (product_id, dealer_id, price, valid_from, valid_to)
  select p.id, r.dealer, r.price, current_date - 90,
    case when r.valid_to_offset is null then null else current_date + r.valid_to_offset end
  from jsonb_to_recordset($json$[
    {"dealer":"20000000-0000-4000-8000-000000000001","sku":"QSA-GROWER-01","price":28.75,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000001","sku":"QSA-BROILER-01","price":36.90,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000002","sku":"QSA-BROILER-02","price":38.90,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000002","sku":"QSA-LAYER-01","price":30.50,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000004","sku":"QSA-BROILER-01","price":37.00,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000004","sku":"QSA-LAYER-02","price":33.50,"valid_to_offset":null},
    {"dealer":"20000000-0000-4000-8000-000000000003","sku":"QSA-BROILER-01","price":39.00,"valid_to_offset":-1}
  ]$json$::jsonb) as r(dealer uuid, sku text, price numeric, valid_to_offset integer)
  join public.products as p on p.sku = r.sku
  where not exists (
    select 1 from public.price_lists as existing
    where existing.product_id = p.id and existing.dealer_id = r.dealer
  );

  ------------------------------------------------------- goods receipts (in)

  for v_spec in
    select * from jsonb_to_recordset($json$[
      {"sku":"QSA-RAW-MAIZE","qty":27000,"reason":"Goods receipt against PO 2026-0812 - Maize Meal, 27.0 MT"},
      {"sku":"QSA-RAW-SOY","qty":11000,"reason":"Goods receipt against PO 2026-0815 - Soybean Meal, 11.0 MT"},
      {"sku":"QSA-RAW-PREMIX","qty":100,"reason":"Goods receipt against PO 2026-0819 - Vitamin Mineral Premix, 100 kg"},
      {"sku":"QSA-LAYER-MASH2","qty":250,"reason":"Opening stock for legacy layer mash SKU"},
      {"sku":"QSA-GROWER-02","qty":150,"reason":"Opening stock, trial batch of grower crumble"}
    ]$json$::jsonb) as r(sku text, qty numeric, reason text)
  loop
    perform set_config('request.jwt.claim.sub', v_inventory::text, true);
    select p.id into v_product_id from public.products as p where p.sku = v_spec.sku;
    perform public.create_stock_adjustment(v_product_id, v_spec.qty, 'in', v_spec.reason);
  end loop;

  ------------------------------------------------------------------ production

  for v_spec in
    select * from jsonb_to_recordset($json$[
      {"d":60,"shift":"night","sku":"QSA-BROILER-01","qty":2700,"qc":"passed","notes":null},
      {"d":57,"shift":"morning","sku":"QSA-BROILER-02","qty":2900,"qc":"passed","notes":null},
      {"d":54,"shift":"evening","sku":"QSA-GROWER-01","qty":2800,"qc":"passed","notes":null},
      {"d":51,"shift":"morning","sku":"QSA-LAYER-01","qty":3050,"qc":"passed","notes":null},
      {"d":48,"shift":"night","sku":"QSA-LAYER-02","qty":2950,"qc":"passed","notes":null},
      {"d":45,"shift":"morning","sku":"QSA-BROILER-03","qty":750,"qc":"passed","notes":null},
      {"d":42,"shift":"evening","sku":"QSA-BROILER-01","qty":2700,"qc":"passed","notes":null},
      {"d":39,"shift":"morning","sku":"QSA-BROILER-02","qty":2950,"qc":"passed","notes":null},
      {"d":36,"shift":"night","sku":"QSA-GROWER-01","qty":2850,"qc":"passed","notes":null},
      {"d":33,"shift":"morning","sku":"QSA-LAYER-01","qty":3050,"qc":"passed","notes":null},
      {"d":30,"shift":"evening","sku":"QSA-LAYER-02","qty":2950,"qc":"failed","notes":"Crumb hardness out of spec at 12.5 percent moisture; batch quarantined and retained for re-pelleting."},
      {"d":27,"shift":"night","sku":"QSA-BROILER-01","qty":2700,"qc":"passed","notes":null},
      {"d":24,"shift":"morning","sku":"QSA-BROILER-02","qty":2950,"qc":"passed","notes":null},
      {"d":21,"shift":"evening","sku":"QSA-GROWER-01","qty":2800,"qc":"passed","notes":null},
      {"d":18,"shift":"morning","sku":"QSA-LAYER-01","qty":3050,"qc":"passed","notes":null},
      {"d":15,"shift":"night","sku":"QSA-LAYER-02","qty":2950,"qc":"passed","notes":null},
      {"d":12,"shift":"morning","sku":"QSA-BROILER-02","qty":1200,"qc":"pending","notes":null},
      {"d":11,"shift":"evening","sku":"QSA-GROWER-01","qty":1200,"qc":"pending","notes":null},
      {"d":10,"shift":"night","sku":"QSA-LAYER-01","qty":1200,"qc":"pending","notes":null},
      {"d":9,"shift":"morning","sku":"QSA-BROILER-02","qty":2000,"qc":"passed","notes":null},
      {"d":8,"shift":"evening","sku":"QSA-GROWER-01","qty":2000,"qc":"passed","notes":null},
      {"d":7,"shift":"morning","sku":"QSA-LAYER-02","qty":2000,"qc":"passed","notes":null},
      {"d":6,"shift":"evening","sku":"QSA-BROILER-03","qty":750,"qc":"passed","notes":null}
    ]$json$::jsonb) as r(d integer, shift text, sku text, qty numeric, qc text, notes text)
  loop
    perform set_config('request.jwt.claim.sub', v_production::text, true);
    select p.id into v_product_id from public.products as p where p.sku = v_spec.sku;

    v_materials := jsonb_build_array(
      jsonb_build_object('product_id', v_maize, 'quantity', round(v_spec.qty * 0.58, 2)),
      jsonb_build_object('product_id', v_soy, 'quantity', round(v_spec.qty * 0.27, 2)),
      jsonb_build_object('product_id', v_premix, 'quantity', round(v_spec.qty * 0.012, 2))
    );

    perform public.create_production_run(
      v_product_id,
      v_spec.qty,
      v_spec.shift,
      (now() at time zone 'Asia/Kolkata')::date - v_spec.d,
      v_materials,
      v_spec.qc::public.production_qc_status,
      v_spec.notes
    );

    update public.stock_movements
    set created_at = public.qsa_dev_ts(v_spec.d)
    where source = 'production'
      and reference_id in (select id from public.production_runs where product_id = v_product_id and run_date = (now() at time zone 'Asia/Kolkata')::date - v_spec.d);
  end loop;

  ------------------------------------------------------ stock write offs (out)

  for v_spec in
    select * from jsonb_to_recordset($json$[
      {"sku":"QSA-BROILER-01","qty":3400,"reason":"Pest damage write-off in godown 2 (supervisor report GRN-4471)"},
      {"sku":"QSA-BROILER-02","qty":450,"reason":"Shortage reported on handover to transporter, Mumbai route"},
      {"sku":"QSA-LAYER-01","qty":300,"reason":"Moisture damage, 10 bags quarantined"}
    ]$json$::jsonb) as r(sku text, qty numeric, reason text)
  loop
    perform set_config('request.jwt.claim.sub', v_inventory::text, true);
    select p.id into v_product_id from public.products as p where p.sku = v_spec.sku;
    perform public.create_stock_adjustment(v_product_id, v_spec.qty, 'out', v_spec.reason);
  end loop;

  ------------------------------------------------------------------ order book


  for v_spec in
    select * from jsonb_to_recordset($json$[
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":58,"dispatch_d":52,"pay_d":50,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/HDFC/6643011","lines":[["QSA-BROILER-01",1200],["QSA-LAYER-01",900]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":45,"dispatch_d":40,"pay_d":35,"target":"paid","pay_ratio":1.00,"mode":"cheque","ref":"CHQ-004512","lines":[["QSA-LAYER-02",1400]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":34,"dispatch_d":30,"pay_d":25,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/HDFC/6643288","lines":[["QSA-GROWER-01",2600]],"advance_d":27,"advance_amount":60000,"advance_ref":"NEFT/HDFC/6643412"},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":20,"dispatch_d":15,"pay_d":12,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/HDFC/6643550","lines":[["QSA-LAYER-01",1800]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":18,"target":"approved","lines":[["QSA-BROILER-01",1500]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":12,"dispatch_d":10,"pay_d":8,"target":"escalated_paid","pay_ratio":1.00,"mode":"upi","ref":"UPI/ravimenon@okhdfc","lines":[["QSA-BROILER-02",2200]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":6,"target":"pending","lines":[["QSA-LAYER-02",2000]]},
      {"dealer":"20000000-0000-4000-8000-000000000001","rep":"10000000-0000-4000-8000-000000000005","manager":"10000000-0000-4000-8000-000000000003","d":3,"target":"pending","lines":[["QSA-GROWER-01",2400]]},

      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":50,"dispatch_d":45,"pay_d":42,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/SBI/7711884","lines":[["QSA-BROILER-02",2000],["QSA-LAYER-01",1500],["QSA-BROILER-03",500]]},
      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":40,"dispatch_d":35,"pay_d":33,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/SBI/7712011","lines":[["QSA-LAYER-02",1600]],"advance_d":36,"advance_amount":150000,"advance_ref":"NEFT/SBI/7712010"},
      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":30,"dispatch_d":25,"pay_d":22,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/SBI/7712455","lines":[["QSA-GROWER-01",2200]]},
      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":22,"dispatch_d":18,"pay_d":15,"target":"partial","pay_ratio":0.30,"mode":"cash","ref":null,"lines":[["QSA-BROILER-01",1000],["QSA-LAYER-02",1200]]},
      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":14,"target":"approved","lines":[["QSA-LAYER-01",1500],["QSA-BROILER-03",700]]},
      {"dealer":"20000000-0000-4000-8000-000000000002","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":8,"target":"approved","lines":[["QSA-BROILER-02",1800]]},

      {"dealer":"20000000-0000-4000-8000-000000000003","rep":"10000000-0000-4000-8000-000000000007","manager":"10000000-0000-4000-8000-000000000004","d":55,"dispatch_d":50,"pay_d":47,"target":"paid","pay_ratio":1.00,"mode":"bank_transfer","ref":"NEFT/ICIC/4482109","lines":[["QSA-BROILER-01",900],["QSA-LAYER-01",1100]]},
      {"dealer":"20000000-0000-4000-8000-000000000003","rep":"10000000-0000-4000-8000-000000000007","manager":"10000000-0000-4000-8000-000000000004","d":33,"dispatch_d":28,"pay_d":24,"target":"partial","pay_ratio":0.60,"mode":"bank_transfer","ref":"NEFT/ICIC/4482771","lines":[["QSA-GROWER-01",1300]]},
      {"dealer":"20000000-0000-4000-8000-000000000003","rep":"10000000-0000-4000-8000-000000000007","manager":"10000000-0000-4000-8000-000000000004","d":15,"target":"approved","lines":[["QSA-LAYER-02",1100]]},
      {"dealer":"20000000-0000-4000-8000-000000000003","rep":"10000000-0000-4000-8000-000000000007","manager":"10000000-0000-4000-8000-000000000004","d":5,"target":"pending","lines":[["QSA-BROILER-02",950]]},

      {"dealer":"20000000-0000-4000-8000-000000000004","rep":"10000000-0000-4000-8000-000000000008","manager":"10000000-0000-4000-8000-000000000004","d":25,"dispatch_d":20,"pay_d":18,"target":"paid","pay_ratio":1.00,"mode":"upi","ref":"UPI/josephkire@ybl","lines":[["QSA-BROILER-01",600],["QSA-GROWER-01",800]]},
      {"dealer":"20000000-0000-4000-8000-000000000004","rep":"10000000-0000-4000-8000-000000000008","manager":"10000000-0000-4000-8000-000000000004","d":9,"target":"approved","lines":[["QSA-LAYER-01",700]]},

      {"dealer":"20000000-0000-4000-8000-000000000005","rep":"10000000-0000-4000-8000-000000000006","manager":"10000000-0000-4000-8000-000000000003","d":16,"target":"rejected","lines":[["QSA-BROILER-01",400]]}
    ]$json$::jsonb)
    as r(
      dealer uuid, rep uuid, manager uuid, d integer, dispatch_d integer, pay_d integer,
      target text, pay_ratio numeric, mode text, ref text, lines jsonb,
      advance_d integer, advance_amount numeric, advance_ref text
    )
  loop
    v_created := v_spec.d;
    v_dispatched := v_spec.dispatch_d;
    v_paid := v_spec.pay_d;

    if v_spec.dealer = v_coastal and v_spec.d = 55 then
      perform set_config('request.jwt.claim.sub', v_dealer_user::text, true);

      select coalesce(
        jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', (l.line->>1)::numeric)),
        '[]'::jsonb
      )
      into v_lines
      from jsonb_array_elements(v_spec.lines) as l(line)
      join public.products as p on p.sku = l.line->>0;

      select (public.create_dealer_order(v_lines)).id into v_order_id;
    else
      perform set_config('request.jwt.claim.sub', v_spec.rep::text, true);

      insert into public.orders (dealer_id, created_by)
      values (v_spec.dealer, v_spec.rep)
      returning id into v_order_id;

      for v_line in
        select l.line->>0 as sku, (l.line->>1)::numeric as qty
        from jsonb_array_elements(v_spec.lines) as l(line)
      loop
        select p.id into v_product_id from public.products as p where p.sku = v_line.sku;
        insert into public.order_items (order_id, product_id, quantity, unit_price)
        values (
          v_order_id,
          v_product_id,
          v_line.qty,
          public.qsa_dev_price(v_product_id, v_spec.dealer)
        );
      end loop;
    end if;

    update public.orders
    set created_at = public.qsa_dev_ts(v_created), updated_at = public.qsa_dev_ts(v_created)
    where id = v_order_id;
    update public.order_events set created_at = public.qsa_dev_ts(v_created)
    where order_id = v_order_id and status = 'pending';

    if v_spec.advance_amount is not null then
      perform set_config('request.jwt.claim.sub', v_finance::text, true);
      v_payment_id := (public.record_dealer_payment(
        v_spec.dealer,
        v_spec.advance_amount,
        (now() at time zone 'Asia/Kolkata')::date - v_spec.advance_d,
        'bank_transfer',
        v_spec.advance_ref
      )).id;
      update public.payments
      set payment_date = (now() at time zone 'Asia/Kolkata')::date - v_spec.advance_d,
          created_at = public.qsa_dev_ts(v_spec.advance_d)
      where id = v_payment_id;
    end if;

    if v_spec.target = 'pending' then
      continue;
    end if;

    if v_spec.target = 'rejected' then
      perform set_config('request.jwt.claim.sub', v_director::text, true);
      perform public.director_reject_order(
        v_order_id,
        'Account is suspended with unpaid balances. Rejected until the account is regularised.'
      );

      update public.order_events set created_at = public.qsa_dev_ts(v_created + 1)
      where order_id = v_order_id and status = 'rejected';
      update public.order_approvals set created_at = public.qsa_dev_ts(v_created + 1)
      where order_id = v_order_id;
      continue;
    end if;

    perform set_config('request.jwt.claim.sub', v_spec.manager::text, true);

    if v_spec.target = 'escalated_paid' then
      perform public.escalate_order(
        v_order_id,
        'This order pushes exposure past the sanctioned limit. Requesting director approval for the additional volume.'
      );
      perform set_config('request.jwt.claim.sub', v_director::text, true);
      perform public.director_approve_order(
        v_order_id,
        'Approved on director authority. Dealer to clear the pending balance this week.'
      );
    else
      begin
        perform public.approve_order(v_order_id, null, false);
      exception when others then
        if sqlerrm like 'Credit limit exceeded%' then
          perform public.escalate_order(
            v_order_id,
            'Exposure after this order exceeds the sanctioned limit. Requesting director approval.'
          );
          perform set_config('request.jwt.claim.sub', v_director::text, true);
          perform public.director_approve_order(
            v_order_id,
            'Approved on director authority within the revised limit.'
          );
        else
          raise;
        end if;
      end;
    end if;

    update public.orders
    set approved_at = public.qsa_dev_ts(v_created + 1), updated_at = public.qsa_dev_ts(v_created + 1)
    where id = v_order_id;
    update public.order_events set created_at = public.qsa_dev_ts(v_created + 1)
    where order_id = v_order_id and status in ('approved', 'pending_director_approval');
    update public.order_approvals set created_at = public.qsa_dev_ts(v_created + 1)
    where order_id = v_order_id;

    if v_spec.dispatch_d is null then
      continue;
    end if;

    perform set_config('request.jwt.claim.sub', v_logistics::text, true);
    perform public.dispatch_order(
      v_order_id,
      (now() at time zone 'Asia/Kolkata')::date - v_dispatched,
      'Delivered by QSA fleet, LR-14 ' || lpad((400 + v_created)::text, 4, '0')
    );

    update public.orders
    set dispatched_at = public.qsa_dev_ts(v_dispatched), updated_at = public.qsa_dev_ts(v_dispatched)
    where id = v_order_id;
    update public.order_events set created_at = public.qsa_dev_ts(v_dispatched)
    where order_id = v_order_id and status = 'dispatched';
    update public.stock_movements set created_at = public.qsa_dev_ts(v_dispatched)
    where source = 'sales' and reference_id = v_order_id;

    perform set_config('request.jwt.claim.sub', v_finance::text, true);
    v_invoice := public.generate_invoice(v_order_id);

    update public.invoices
    set invoice_date = (now() at time zone 'Asia/Kolkata')::date - v_dispatched,
        created_at = public.qsa_dev_ts(v_dispatched)
    where id = v_invoice.id;
    update public.order_events set created_at = public.qsa_dev_ts(v_dispatched)
    where order_id = v_order_id and status = 'invoiced';

    v_amount := round(v_invoice.total_amount * v_spec.pay_ratio, 2);

    v_payment_id := (public.record_invoice_payment(
      v_invoice.id,
      v_amount,
      (now() at time zone 'Asia/Kolkata')::date - v_paid,
      v_spec.mode::public.payment_mode,
      v_spec.ref
    )).id;

    if exists (select 1 from public.payments where id = v_payment_id and invoice_id = v_invoice.id) then
      update public.payments
      set payment_date = (now() at time zone 'Asia/Kolkata')::date - v_paid,
          created_at = public.qsa_dev_ts(v_paid)
      where id = v_payment_id;
    end if;
  end loop;

  ------------------------------------------------------------- tally exports

  perform set_config('request.jwt.claim.sub', v_finance::text, true);

  perform public.record_tally_export('csv', date '2026-06-01', date '2026-06-30', 42,
    'exports/tally/2026-06-sales.csv', 'a1f4c0b28d9e6f3b5c7a0912d4e6f8b10');
  perform public.record_tally_export('xml', date '2026-07-01', date '2026-07-31', 51,
    'exports/tally/2026-07-sales.xml', 'b2e5d1c39e0f7a4c6d8b102e5f7a9c21');
  perform public.record_tally_export('csv', date '2026-08-01', date '2026-08-31', 47,
    'exports/tally/2026-08-sales.csv', 'c3a6e2d40f1a8b5e7a9c213f6a8b0d32');

  ------------------------------------------------------------- tidy up dates

  -- The pgTAP workflow suites place a 1000 unit order and then remove 200 units
  -- before approving it, so LAYER-01 has to sit inside a narrow band for the stock
  -- guard to fire. Clear the surplus production in one batch write-off once every
  -- dispatch has been booked, so the seeded balance lands inside that band.
  select p.id into v_product_id from public.products as p where p.sku = 'QSA-LAYER-01';
  select sl.current_quantity - 1100 into v_surplus
  from public.stock_levels as sl where sl.product_id = v_product_id;

  if v_surplus > 0 then
    perform set_config('request.jwt.claim.sub', v_inventory::text, true);
    perform public.create_stock_adjustment(
      v_product_id, v_surplus, 'out',
      'Batch write-off: LAYER-01 held past shelf life, godown 1 clearance'
    );
  end if;

  -- pgTAP suites and dry runs burn sequence values that a rollback cannot undo.
  -- Renumber the seeded invoices chronologically and realign the sequence so the
  -- development dataset reads QSA-2026-000001 upwards.
  update public.invoices as i
  set invoice_number = 'QSA-TMP-' || lpad(r.rn::text, 6, '0')
  from (
    select id, row_number() over (order by invoice_date, created_at) as rn
    from public.invoices
  ) as r
  where r.id = i.id;

  update public.invoices
  set invoice_number = 'QSA-' || to_char(invoice_date, 'YYYY') || '-' || right(invoice_number, 6);

  perform setval('public.invoice_number_seq', (select count(*) from public.invoices), true);

  update public.payment_allocations pa
  set created_at = coalesce(
    (select i.created_at from public.invoices as i where i.id = pa.invoice_id),
    pa.created_at
  );

  alter table public.orders disable trigger orders_set_updated_at;
  update public.orders
  set updated_at = coalesce(dispatched_at, approved_at, created_at);
  alter table public.orders enable trigger orders_set_updated_at;

  ------------------------------------------------------------------ assertions

  if (select count(*) from public.orders) <> 21 then
    raise exception 'expected 21 orders, got %', (select count(*) from public.orders);
  end if;

  if (select count(*) from public.invoices) <> 12 then
    raise exception 'expected 12 invoices, got %', (select count(*) from public.invoices);
  end if;

  -- The workflow suites drive orders through dealer 20000000-...-0001 using product
  -- 30000000-...-0001. Fail loudly here rather than letting a data edit break them.
  if private.order_exposure(v_green_valley)
    >= coalesce((select credit_limit_override from public.dealers where id = v_green_valley),
                (select credit_limit from public.dealers where id = v_green_valley)) then
    raise exception 'seeded exposure leaves dealer 20000000-...-0001 without credit headroom';
  end if;

  if exists (
    select 1
    from public.stock_levels as sl
    join public.products as p on p.id = sl.product_id
    where p.id = '30000000-0000-4000-8000-000000000001'
      and (sl.current_quantity < 1010 or sl.current_quantity >= 1210)
  ) then
    raise exception 'LAYER-01 stock must sit in [1010, 1210) for the dispatch stock guard';
  end if;

  if exists (
    select 1 from public.orders as o
    where o.total_amount <> coalesce((
      select sum(oi.line_total) from public.order_items as oi where oi.order_id = o.id
    ), 0)
  ) then
    raise exception 'order totals drifted from their lines';
  end if;

  if exists (select 1 from public.stock_levels where current_quantity < 0) then
    raise exception 'negative stock after seeding';
  end if;

  if exists (
    select 1 from public.orders as o
    where not exists (select 1 from public.order_events as e where e.order_id = o.id)
  ) then
    raise exception 'orders without lifecycle events';
  end if;

  if exists (
    select 1 from public.invoices as i
    where i.taxable_amount + i.gst_amount <> i.total_amount
  ) then
    raise exception 'invoice totals do not reconcile';
  end if;

  if exists (
    select 1 from public.orders as o
    where o.status in ('dispatched', 'invoiced')
      and not exists (
        select 1 from public.stock_movements as m
        where m.source = 'sales' and m.reference_id = o.id
      )
  ) then
    raise exception 'dispatched order without stock movements';
  end if;

  -- the dealer facing RPC must ignore the expired dealer specific price and fall
  -- back to the standard dealer tier price
  if not exists (
    select 1
    from public.order_items as oi
    join public.products as p on p.id = oi.product_id
    where oi.order_id = (
        select id from public.orders
        where dealer_id = v_coastal and created_at = public.qsa_dev_ts(55)
      )
      and p.sku = 'QSA-BROILER-01'
      and oi.unit_price = 37.50
  ) then
    raise exception 'expired dealer price was not ignored for the coastal order';
  end if;

  raise notice 'qsa_dev_dataset: % production runs, 21 orders, 11 invoices, % payments, % stock movements',
    (select count(*) from public.production_runs),
    (select count(*) from public.payments),
    (select count(*) from public.stock_movements);
end;
$$;

drop function if exists public.qsa_dev_ts(integer);
