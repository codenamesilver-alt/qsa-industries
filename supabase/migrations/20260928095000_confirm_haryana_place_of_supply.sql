-- Place of supply: the supplying office is registered in Haryana.
--
-- Until now finance_settings.company_state was NULL, and generate_invoice treats
-- NULL as intra-state. That default was a deliberate placeholder for an
-- unconfirmed answer, and it was the wrong answer: every seeded dealer sits in
-- Maharashtra or Andhra Pradesh, so all of them are inter-state supplies and
-- should have carried IGST rather than a CGST/SGST split.
--
-- This migration records the confirmed state. It does not rewrite the invoices
-- already issued under the old default: those are financial records, and moving
-- tax on an issued invoice without a credit note is not a data fix, it is a
-- compliance event. Instead it adds a worklist so finance can decide what to
-- reissue, which is the reversible half of the job.
--
-- Idempotent: a deliberately different value set by an admin later is left alone,
-- because this is a one-time answer to a one-time question, not an enforcement of
-- it on every run.

update public.finance_settings
   set company_state = 'Haryana'
 where id = true
   and (company_state is null or btrim(company_state) = '');

comment on column public.finance_settings.company_state is
  'State of the supplying office. Supplies to a dealer in this state are '
  'intra-state (CGST + SGST); anywhere else is inter-state (IGST). Confirmed as '
  'Haryana, so the seeded Maharashtra and Andhra Pradesh dealers are inter-state '
  'supplies and are invoiced with IGST.';

-- ---------------------------------------------------------------------------
-- Worklist for invoices issued under the unconfirmed intra-state default.
--
-- An invoice is affected when it recorded no company state, or a state other than
-- the confirmed one, AND the dealer was in fact outside that state. Those are the
-- invoices that were issued with a CGST/SGST split where IGST was due. Anything
-- already invoiced as inter-state is left out, and an invoice whose dealer sits in
-- Haryana is correctly intra-state either way.
--
-- security_invoker so this inherits the invoice policies and shows a rep only what
-- they could already read. Finance and admin see the whole list.
-- ---------------------------------------------------------------------------
create or replace view public.finance_place_of_supply_review
with (security_invoker = true) as
select
  i.id,
  i.invoice_number,
  i.invoice_date,
  i.dealer_id,
  d.name as dealer_name,
  d.state as dealer_state,
  i.company_state as recorded_company_state,
  i.total_amount,
  i.taxable_amount,
  i.cgst_amount,
  i.sgst_amount,
  i.igst_amount,
  (select f.company_state from public.finance_settings f where f.id = true) as confirmed_company_state
from public.invoices i
join public.dealers d on d.id = i.dealer_id
where (i.company_state is null or i.company_state <> (select f.company_state from public.finance_settings f where f.id = true))
  and (d.state is null or d.state <> (select f.company_state from public.finance_settings f where f.id = true))
  and (i.cgst_amount > 0 or i.sgst_amount > 0);

comment on view public.finance_place_of_supply_review is
  'Invoices whose tax split contradicts the confirmed place of supply. These were '
  'issued while company_state was unset, which defaulted every invoice to the '
  'intra-state CGST/SGST split. Each one needs a credit note and a reissue; this '
  'view does not change any of them.';

grant select on table public.finance_place_of_supply_review to authenticated;
