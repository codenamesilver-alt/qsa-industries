select 'designation_permissions' as t, count(*)::text as n from public.designation_permissions
union all select 'role_permissions', count(*)::text from public.role_permissions
union all select 'expense_heads', count(*)::text from public.expense_heads
union all select 'org_positions', count(*)::text from public.org_positions
union all select 'product_batches', count(*)::text from public.product_batches
union all select 'tally_exports', count(*)::text from public.tally_exports
union all select 'designation_cols', string_agg(column_name,',') from information_schema.columns where table_schema='public' and table_name='designations'
union all select 'batch_cols', string_agg(column_name,',') from information_schema.columns where table_schema='public' and table_name='product_batches'
union all select 'org_position_cols', string_agg(column_name,',') from information_schema.columns where table_schema='public' and table_name='org_positions';
