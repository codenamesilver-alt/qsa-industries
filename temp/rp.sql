select r.name as role, string_agg(rp.permission_code, ', ' order by rp.permission_code) as perms
from public.role_permissions rp join public.roles r on r.id=rp.role_id group by 1 order by 1;
