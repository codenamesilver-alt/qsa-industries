select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('users','dealers','products','orders','order_items','invoices','invoice_lines','payments','payment_allocations','stock_movements','stock_levels','production_runs','production_run_materials','raw_materials','batches','purchase_orders','purchase_order_lines','expenses','expense_heads','user_hierarchy','finance_settings','price_lists','dealer_ledger')
order by table_name, ordinal_position;
