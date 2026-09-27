-- GST-compliant invoicing: HSN codes and a real per-line tax breakup.
--
-- The PRD requires invoices that are "GST-compliant (correct tax breakup, HSN
-- codes, invoice numbering per Indian GST rules)". Until now the tax breakup was
-- a single flat rate applied to the order total, which produces a correct total
-- but no HSN and no CGST/SGST-versus-IGST split -- and no way to prove either to
-- an auditor. This migration adds:
--
--   * products.hsn_code, captured onto every invoice line at generation time so
--     a later product edit cannot rewrite the tax record of a past invoice.
--   * public.invoice_lines, one row per order line, holding the HSN, the
--     taxable value, and the tax split.
--   * CGST + SGST for a supply within the company state, IGST for a supply
--     outside it, per the place-of-supply rule.
--
-- Prices are GST-inclusive (see the original generate_invoice, which divided the
-- total by 1 + rate), so the taxable value is derived by grossing down, never up.

-- ---------------------------------------------------------------------------
-- 1. HSN codes on the product master
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists hsn_code text;

-- Indian GST HSN is 4 digits (heading), 6 (sub-heading) or 8 (product). The
-- pattern is deliberately permissive about length but strict about being digits:
-- a letter or a stray space here becomes a rejected invoice return.
alter table public.products
  drop constraint if exists products_hsn_code_format;

alter table public.products
  add constraint products_hsn_code_format
  check (
    hsn_code is null
    or hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'
  );

-- Backfill so the existing catalogue can invoice immediately.
--
-- WARNING: these are the chapter-23 defaults for compounded feed, NOT codes
-- verified against QSA's own GST registration. Feed preparations sit under
-- chapter 23 (residues of the food industry); 23099020 is the commonly used
-- sub-heading for poultry feed and 23099010 for the maize/soy raw materials.
-- Admin must confirm the real per-SKU codes against the CA's registration and
-- the Tally ledger before the first real invoice is filed. See README.
update public.products
   set hsn_code = '23099020'
 where hsn_code is null
   and category = 'Poultry Feed';

update public.products
   set hsn_code = '23099010'
 where hsn_code is null;

-- ---------------------------------------------------------------------------
-- 2. Company state, so the tax split can be decided
-- ---------------------------------------------------------------------------

alter table public.finance_settings
  add column if not exists company_state text,
  add column if not exists price_includes_gst boolean not null default true;

comment on column public.finance_settings.company_state is
  'State of the supplying office. Supplies to a dealer in this state are '
  'intra-state (CGST + SGST); anywhere else is inter-state (IGST). Left NULL '
  'until an admin sets it, in which case invoicing assumes intra-state.';

-- ---------------------------------------------------------------------------
-- 3. Invoice header carries the tax split and the place of supply
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists cgst_amount numeric(14, 2)
    not null default 0 check (cgst_amount >= 0 and cgst_amount <> 'NaN'::numeric),
  add column if not exists sgst_amount numeric(14, 2)
    not null default 0 check (sgst_amount >= 0 and sgst_amount <> 'NaN'::numeric),
  add column if not exists igst_amount numeric(14, 2)
    not null default 0 check (igst_amount >= 0 and igst_amount <> 'NaN'::numeric),
  add column if not exists place_of_supply text,
  add column if not exists company_state text;

-- Intra-state tax splits evenly into CGST and SGST, but an odd number of paise
-- cannot be halved exactly, so one side may differ by 0.01. Anything larger is a
-- real error. Inter-state invoices carry neither, which satisfies this too.
alter table public.invoices
  drop constraint if exists invoices_tax_split_shape;

alter table public.invoices
  add constraint invoices_tax_split_shape
  check (abs(cgst_amount - sgst_amount) <= 0.01);

-- invoices_amounts_reconcile is added at the end of section 5, not here. The
-- invoices that already exist carry a gst_amount but no split yet, so the
-- constraint would reject every one of them until the backfill has run.

-- ---------------------------------------------------------------------------
-- 4. Invoice lines
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  product_id uuid not null references public.products (id),
  -- Snapshotted at generation time on purpose. If the catalogue HSN is corrected
  -- next year, last year's filed invoice must not move with it.
  hsn_code text not null check (hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'),
  description text not null,
  quantity numeric(14, 2) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  unit_price numeric(14, 2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  line_total numeric(14, 2) not null check (line_total >= 0 and line_total <> 'NaN'::numeric),
  gst_rate numeric(5, 4) not null check (gst_rate >= 0 and gst_rate <= 1),
  taxable_amount numeric(14, 2) not null check (taxable_amount >= 0),
  cgst_amount numeric(14, 2) not null default 0 check (cgst_amount >= 0),
  sgst_amount numeric(14, 2) not null default 0 check (sgst_amount >= 0),
  igst_amount numeric(14, 2) not null default 0 check (igst_amount >= 0),
  created_at timestamptz not null default now(),
  constraint invoice_lines_tax_split_shape check (abs(cgst_amount - sgst_amount) <= 0.01),
  constraint invoice_lines_amounts_reconcile
    check (round(taxable_amount + cgst_amount + sgst_amount + igst_amount, 2) = round(line_total, 2))
);

comment on table public.invoice_lines is
  'Per-line GST invoice detail. One row per order line, with the HSN code and '
  'tax split captured at generation time.';

create index if not exists invoice_lines_invoice_id_idx
  on public.invoice_lines (invoice_id);

create index if not exists invoice_lines_product_id_idx
  on public.invoice_lines (product_id);

alter table public.invoice_lines enable row level security;

-- Same reach as the invoice it belongs to: finance and admin see everything,
-- everyone else sees only invoices for a dealer they can already view.
drop policy if exists invoice_lines_select_scope on public.invoice_lines;

create policy invoice_lines_select_scope
  on public.invoice_lines
  for select
  to authenticated
  using (
    private.current_user_role() = any (array['admin'::public.user_role, 'finance'::public.user_role])
    or private.can_view_dealer(
      (select i.dealer_id from public.invoices as i where i.id = invoice_id)
    )
  );

revoke all on table public.invoice_lines from anon, authenticated;
grant select on table public.invoice_lines to authenticated;

-- A line is written only by generate_invoice, never by a client.
revoke insert, update, delete on table public.invoice_lines from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill lines for the invoices that already exist
-- ---------------------------------------------------------------------------
--
-- These invoices were produced by the old flat-rate path and their header
-- taxable/gst figures are already on the record. Allocating the taxable value
-- proportionally and pushing the rounding remainder onto the last line keeps
-- every stored header number byte-identical while giving each line a real HSN
-- and tax split. Row numbering comes from a window function so the "last line"
-- is identified in the query rather than tracked in a loop counter.

do $$
declare
  invoice_row record;
  current_line record;
  is_inter_state boolean;
  line_taxable numeric(14, 2);
  line_gst numeric(14, 2);
  line_cgst numeric(14, 2);
  line_sgst numeric(14, 2);
  line_igst numeric(14, 2);
  running_taxable numeric(14, 2) := 0;
  running_cgst numeric(14, 2) := 0;
  running_sgst numeric(14, 2) := 0;
  running_igst numeric(14, 2) := 0;
  lines_total numeric(14, 2) := 0;
  configured_gst_rate numeric(5, 4);
  configured_company_state text;
begin
  select gst_rate, company_state
    into configured_gst_rate, configured_company_state
    from public.finance_settings
   where id = true;

  configured_gst_rate := coalesce(configured_gst_rate, 0.18);

  for invoice_row in
    select
      i.id,
      i.order_id,
      i.taxable_amount,
      i.gst_amount,
      i.total_amount,
      coalesce(d.state, '') as dealer_state
    from public.invoices i
    join public.dealers d on d.id = i.dealer_id
    where not exists (select 1 from public.invoice_lines il where il.invoice_id = i.id)
    order by i.invoice_number
  loop
    -- Reset per invoice. These are declared once, so without this they carry
    -- across invoices and the last line of the next invoice goes negative.
    running_taxable := 0;
    running_cgst := 0;
    running_sgst := 0;
    running_igst := 0;

    -- Intra-state unless the dealer sits outside a known company state.
    is_inter_state := configured_company_state is not null
      and invoice_row.dealer_state <> configured_company_state;

    select coalesce(sum(coalesce(oi.line_total, oi.quantity * oi.unit_price)), 0)
      into lines_total
      from public.order_items oi
     where oi.order_id = invoice_row.order_id;

    -- The header figures were derived from the order total, so the lines have to
    -- add back up to that same total. If they do not, the order and its invoice
    -- disagree and this backfill must not paper over it.
    if round(lines_total, 2) <> round(invoice_row.total_amount, 2) then
      raise exception
        'Cannot backfill invoice %: its order lines total % does not match the invoice total %',
        invoice_row.id, lines_total, invoice_row.total_amount;
    end if;

    for current_line in
      select
        oi.id as oi_id,
        oi.product_id,
        coalesce(oi.line_total, oi.quantity * oi.unit_price) as gross,
        oi.quantity,
        oi.unit_price,
        p.hsn_code,
        p.name as product_name,
        row_number() over (order by oi.id) as line_number,
        count(*) over () as line_count
      from public.order_items oi
      join public.products p on p.id = oi.product_id
     where oi.order_id = invoice_row.order_id
     order by oi.id
    loop
      if current_line.line_number = current_line.line_count then
        -- Last line absorbs the rounding so the taxable values sum to the stored
        -- header exactly.
        line_taxable := invoice_row.taxable_amount - running_taxable;
      else
        if invoice_row.total_amount <> 0 then
          line_taxable := round(invoice_row.taxable_amount * current_line.gross / invoice_row.total_amount, 2);
        else
          line_taxable := 0;
        end if;
      end if;

      -- Tax is the remainder of the line, never a second independent rounding of
      -- the header. That is what makes each line's tax + taxable land exactly on
      -- the line total, and makes the line taxes sum to the header tax.
      line_gst := current_line.gross - line_taxable;

      if is_inter_state then
        line_cgst := 0;
        line_sgst := 0;
        line_igst := line_gst;
      else
        line_cgst := round(line_gst / 2, 2);
        line_sgst := line_gst - line_cgst;
        line_igst := 0;
      end if;

      insert into public.invoice_lines (
        invoice_id,
        order_item_id,
        product_id,
        hsn_code,
        description,
        quantity,
        unit_price,
        line_total,
        gst_rate,
        taxable_amount,
        cgst_amount,
        sgst_amount,
        igst_amount
      )
      values (
        invoice_row.id,
        current_line.oi_id,
        current_line.product_id,
        current_line.hsn_code,
        current_line.product_name,
        current_line.quantity,
        current_line.unit_price,
        current_line.gross,
        configured_gst_rate,
        line_taxable,
        line_cgst,
        line_sgst,
        line_igst
      );

      running_taxable := running_taxable + line_taxable;
      running_cgst := running_cgst + line_cgst;
      running_sgst := running_sgst + line_sgst;
      running_igst := running_igst + line_igst;
    end loop;

    update public.invoices
       set cgst_amount = running_cgst,
           sgst_amount = running_sgst,
           igst_amount = running_igst,
           place_of_supply = nullif(invoice_row.dealer_state, ''),
           company_state = configured_company_state
     where id = invoice_row.id;
  end loop;
end;
$$;

-- Now that every invoice carries a split, the reconcile rule can be enforced.
-- This is the invariant that makes an invoice defensible, so it lives in the
-- database rather than in whichever code path happened to write the row.
alter table public.invoices
  drop constraint if exists invoices_amounts_reconcile;

alter table public.invoices
  add constraint invoices_amounts_reconcile
  check (
    round(taxable_amount + cgst_amount + sgst_amount + igst_amount, 2) = round(total_amount, 2)
    and round(cgst_amount + sgst_amount + igst_amount, 2) = round(gst_amount, 2)
  );

-- ---------------------------------------------------------------------------
-- 6. generate_invoice rewritten to produce the lines
-- ---------------------------------------------------------------------------

create or replace function public.generate_invoice(target_order_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  invoice_row public.invoices%rowtype;
  current_line record;
  actor_role public.user_role;
  configured_gst_rate numeric(5, 4);
  configured_company_state text;
  dealer_state text;
  is_inter_state boolean;
  line_count integer;
  line_taxable numeric(14, 2);
  line_gst numeric(14, 2);
  line_cgst numeric(14, 2);
  line_sgst numeric(14, 2);
  line_igst numeric(14, 2);
  header_taxable numeric(14, 2) := 0;
  header_cgst numeric(14, 2) := 0;
  header_sgst numeric(14, 2) := 0;
  header_igst numeric(14, 2) := 0;
  header_total numeric(14, 2) := 0;
  missing_hsn text;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can generate invoices';
  end if;

  select *
  into order_row
  from public.orders
  where id = target_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  if order_row.status <> 'dispatched' then
    raise exception 'Only dispatched orders can be invoiced';
  end if;

  if order_row.invoice_id is not null then
    raise exception 'Order already has an invoice';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
  for update;

  -- Refuse to produce a non-compliant invoice rather than file one without a
  -- statutory classification. The message names the SKUs so it is fixable.
  select string_agg(p.sku, ', ' order by p.sku)
  into missing_hsn
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = order_row.id
    and p.hsn_code is null;

  if missing_hsn is not null then
    raise exception
      'Cannot invoice: no HSN code on product(s) %. Set the HSN code in the product master first.',
      missing_hsn;
  end if;

  select gst_rate, company_state
  into configured_gst_rate, configured_company_state
  from public.finance_settings
  where id = true;

  configured_gst_rate := coalesce(configured_gst_rate, 0.18);

  select coalesce(d.state, '')
  into dealer_state
  from public.dealers d
  where d.id = order_row.dealer_id;

  -- Place of supply decides the split. With no company state configured the
  -- invoice is treated as intra-state; the finance screen flags the setting as
  -- unset so this default is never mistaken for a confirmed answer.
  is_inter_state := configured_company_state is not null
    and dealer_state <> configured_company_state;

  select count(*)
  into line_count
  from public.order_items
  where order_id = order_row.id;

  if line_count = 0 then
    raise exception 'Order % has no lines to invoice', target_order_id;
  end if;

  insert into public.invoices (
    order_id,
    dealer_id,
    invoice_number,
    taxable_amount,
    gst_amount,
    total_amount,
    invoice_date,
    created_by,
    place_of_supply,
    company_state
  )
  values (
    order_row.id,
    order_row.dealer_id,
    'QSA-' || to_char(private.business_date(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'),
    0,
    0,
    0,
    private.business_date(),
    (select auth.uid()),
    nullif(dealer_state, ''),
    configured_company_state
  )
  returning * into invoice_row;

  for current_line in
    select
      oi.id as oi_id,
      oi.product_id,
      coalesce(oi.line_total, oi.quantity * oi.unit_price) as gross,
      oi.quantity,
      oi.unit_price,
      p.hsn_code,
      p.name as product_name
    from public.order_items oi
    join public.products p on p.id = oi.product_id
   where oi.order_id = order_row.id
   order by oi.id
  loop
    -- Prices are GST-inclusive, so gross down for the taxable value and treat
    -- the remainder as tax. Doing the remainder rather than a second
    -- multiplication is what makes taxable + tax land exactly on the line total.
    line_taxable := round(current_line.gross / (1 + configured_gst_rate), 2);
    line_gst := current_line.gross - line_taxable;

    if is_inter_state then
      line_cgst := 0;
      line_sgst := 0;
      line_igst := line_gst;
    else
      line_cgst := round(line_gst / 2, 2);
      line_sgst := line_gst - line_cgst;
      line_igst := 0;
    end if;

    insert into public.invoice_lines (
      invoice_id,
      order_item_id,
      product_id,
      hsn_code,
      description,
      quantity,
      unit_price,
      line_total,
      gst_rate,
      taxable_amount,
      cgst_amount,
      sgst_amount,
      igst_amount
    )
    values (
      invoice_row.id,
      current_line.oi_id,
      current_line.product_id,
      current_line.hsn_code,
      current_line.product_name,
      current_line.quantity,
      current_line.unit_price,
      current_line.gross,
      configured_gst_rate,
      line_taxable,
      line_cgst,
      line_sgst,
      line_igst
    );

    header_taxable := header_taxable + line_taxable;
    header_cgst := header_cgst + line_cgst;
    header_sgst := header_sgst + line_sgst;
    header_igst := header_igst + line_igst;
    header_total := header_total + current_line.gross;
  end loop;

  update public.invoices
     set taxable_amount = header_taxable,
         cgst_amount = header_cgst,
         sgst_amount = header_sgst,
         igst_amount = header_igst,
         gst_amount = header_cgst + header_sgst + header_igst,
         total_amount = header_total
   where id = invoice_row.id
  returning * into invoice_row;

  update public.orders
  set status = 'invoiced',
      invoice_id = invoice_row.id
  where id = order_row.id;

  return invoice_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Tally export now carries HSN and the tax split
-- ---------------------------------------------------------------------------
--
-- Rebuilt against public.invoice_lines rather than by re-joining order_items, so
-- what leaves for Tally is exactly what was filed, not a fresh guess. Direction
-- is one-way, ERP to Tally; Tally remains the system of record.

-- Dropped rather than replaced: create or replace view cannot change a column's
-- ordinal position, and HSN sits earlier in the list than the old view had it.
drop view if exists public.tally_invoice_lines;

create view public.tally_invoice_lines
with (security_invoker = true)
as
select
  i.invoice_number,
  i.invoice_date,
  d.name as dealer_name,
  d.email as dealer_email,
  p.sku,
  il.description as product_name,
  il.hsn_code,
  il.id as line_id,
  il.quantity,
  il.unit_price,
  il.line_total,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then il.taxable_amount
  end as taxable_amount,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then il.cgst_amount
  end as cgst_amount,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then il.sgst_amount
  end as sgst_amount,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then il.igst_amount
  end as igst_amount,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then i.gst_amount
  end as gst_amount,
  case
    when row_number() over (partition by i.id order by il.id) = 1 then i.total_amount
  end as total_amount
from public.invoice_lines il
join public.invoices i on i.id = il.invoice_id
join public.dealers d on d.id = i.dealer_id
join public.products p on p.id = il.product_id
where private.current_user_role() = any (array['admin'::public.user_role, 'finance'::public.user_role]);

grant select on public.tally_invoice_lines to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Backfill guard: every invoice must now be line-itemised and reconcile
-- ---------------------------------------------------------------------------

do $$
declare
  unlined integer;
  mismatched integer;
begin
  select count(*)
  into unlined
  from public.invoices i
  where not exists (select 1 from public.invoice_lines il where il.invoice_id = i.id);

  if unlined > 0 then
    raise exception 'Backfill incomplete: % invoice(s) have no lines', unlined;
  end if;

  select count(*)
  into mismatched
  from public.invoices i
  where round(i.taxable_amount + i.gst_amount, 2) <> round(i.total_amount, 2)
     or round(i.gst_amount, 2) <> round(i.cgst_amount + i.sgst_amount + i.igst_amount, 2);

  if mismatched > 0 then
    raise exception 'Backfill incomplete: % invoice(s) do not reconcile', mismatched;
  end if;
end;
$$;
