select id, gst_rate, company_state, price_includes_gst, ageing_grace_days, credit_counts_current_invoices from public.finance_settings;
select last_value, is_called from public.tally_export_id_seq;
