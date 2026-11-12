select 'designation_permissions' as t, count(*)::text as n from public.designation_permissions
union all select 'role_permissions', count(*)::text from public.role_permissions
union all select 'expense_heads', count(*)::text from public.expense_heads
union all select 'org_positions', count(*)::text from public.org_positions
union all select 'tally_exports', count(*)::text from public.tally_exports
union all select 'batches', count(*)::text from public.batches
union all select 'org chart binding col', string_agg(column_name,',') from information_schema.columns where table_name='designations' and table_schema='public';
