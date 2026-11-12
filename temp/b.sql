select table_name from information_schema.tables where table_schema='public' and (table_name like '%batch%' or table_name like '%expir%') order by 1;
