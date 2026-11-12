select viewname, definition from pg_views where schemaname='public' and viewname in ('org_chart','org_people','org_people_tree','org_staff_roster');
