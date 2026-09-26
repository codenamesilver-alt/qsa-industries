insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'admin@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Arjun Mehta"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'nadia.kapoor@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Nadia Kapoor"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'imran.sheikh@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Imran Sheikh"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'meera.nair@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Meera Nair"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'ravi.menon@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ravi Menon"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'sana.qureshi@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sana Qureshi"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    'authenticated',
    'authenticated',
    'vikram.desai@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Vikram Desai"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    'authenticated',
    'authenticated',
    'ananya.iyer@qsa-demo.in',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ananya Iyer"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '11000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '{"sub":"10000000-0000-4000-8000-000000000001","email":"admin@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '{"sub":"10000000-0000-4000-8000-000000000002","email":"nadia.kapoor@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '{"sub":"10000000-0000-4000-8000-000000000003","email":"imran.sheikh@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '{"sub":"10000000-0000-4000-8000-000000000004","email":"meera.nair@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    '{"sub":"10000000-0000-4000-8000-000000000005","email":"ravi.menon@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000006',
    '{"sub":"10000000-0000-4000-8000-000000000006","email":"sana.qureshi@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000007',
    '{"sub":"10000000-0000-4000-8000-000000000007","email":"vikram.desai@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '11000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000008',
    '{"sub":"10000000-0000-4000-8000-000000000008","email":"ananya.iyer@qsa-demo.in","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do nothing;

insert into public.users (id, full_name, email, role, phone, is_active) values
  ('10000000-0000-4000-8000-000000000001', 'Arjun Mehta', 'admin@qsa-demo.in', 'admin', '+91 98765 10001', true),
  ('10000000-0000-4000-8000-000000000002', 'Nadia Kapoor', 'nadia.kapoor@qsa-demo.in', 'sales_director', '+91 98765 10002', true),
  ('10000000-0000-4000-8000-000000000003', 'Imran Sheikh', 'imran.sheikh@qsa-demo.in', 'sales_manager', '+91 98765 10003', true),
  ('10000000-0000-4000-8000-000000000004', 'Meera Nair', 'meera.nair@qsa-demo.in', 'sales_manager', '+91 98765 10004', true),
  ('10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'ravi.menon@qsa-demo.in', 'sales_rep', '+91 98765 10005', true),
  ('10000000-0000-4000-8000-000000000006', 'Sana Qureshi', 'sana.qureshi@qsa-demo.in', 'sales_rep', '+91 98765 10006', true),
  ('10000000-0000-4000-8000-000000000007', 'Vikram Desai', 'vikram.desai@qsa-demo.in', 'sales_rep', '+91 98765 10007', true),
  ('10000000-0000-4000-8000-000000000008', 'Ananya Iyer', 'ananya.iyer@qsa-demo.in', 'sales_rep', '+91 98765 10008', true)
on conflict (id) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  role = excluded.role,
  phone = excluded.phone,
  is_active = excluded.is_active;

insert into public.user_hierarchy (user_id, manager_id) values
  ('10000000-0000-4000-8000-000000000002', null),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000004')
on conflict (user_id) do update set manager_id = excluded.manager_id;

insert into public.dealers (
  id,
  name,
  contact_person,
  phone,
  email,
  address_line1,
  city,
  state,
  postal_code,
  country,
  credit_limit,
  credit_limit_override,
  sales_rep_id,
  status
) values
  (
    '20000000-0000-4000-8000-000000000001',
    'Green Valley Poultry Farms',
    'Ramesh Gupta',
    '+91 98765 20001',
    'accounts@greenvalleypoultry.in',
    '18 Harvest Farm Road',
    'Nashik',
    'Maharashtra',
    '422001',
    'India',
    250000.00,
    null,
    '10000000-0000-4000-8000-000000000005',
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Sunrise Feeds and Farms',
    'Kavita Patil',
    '+91 98765 20002',
    'purchase@sunrisefeeds.in',
    '7 Sunrise Poultry Park',
    'Pune',
    'Maharashtra',
    '411045',
    'India',
    400000.00,
    450000.00,
    '10000000-0000-4000-8000-000000000006',
    'active'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Coastal Agri Enterprises',
    'Suresh Kumar',
    '+91 98765 20003',
    'accounts@coastalagri.in',
    '24 Farm Link Road',
    'Rajahmundry',
    'Andhra Pradesh',
    '533101',
    'India',
    300000.00,
    null,
    '10000000-0000-4000-8000-000000000007',
    'active'
  )
on conflict (id) do update set
  name = excluded.name,
  contact_person = excluded.contact_person,
  phone = excluded.phone,
  email = excluded.email,
  address_line1 = excluded.address_line1,
  city = excluded.city,
  state = excluded.state,
  postal_code = excluded.postal_code,
  country = excluded.country,
  credit_limit = excluded.credit_limit,
  credit_limit_override = excluded.credit_limit_override,
  sales_rep_id = excluded.sales_rep_id,
  status = excluded.status;

insert into public.products (id, sku, name, category, unit_of_measure, price, active) values
  ('30000000-0000-4000-8000-000000000001', 'QSA-LAYER-01', 'Layer Grower Pellets', 'Poultry Feed', 'kg', 32.50, true),
  ('30000000-0000-4000-8000-000000000002', 'QSA-LAYER-02', 'Layer Finisher Pellets', 'Poultry Feed', 'kg', 35.00, true),
  ('30000000-0000-4000-8000-000000000003', 'QSA-BROILER-01', 'Broiler Starter Feed', 'Poultry Feed', 'kg', 38.75, true),
  ('30000000-0000-4000-8000-000000000004', 'QSA-BROILER-02', 'Broiler Finisher Feed', 'Poultry Feed', 'kg', 41.00, true),
  ('30000000-0000-4000-8000-000000000005', 'QSA-GROWER-01', 'Grower Feed', 'Poultry Feed', 'kg', 30.25, true)
on conflict (sku) do update set
  name = excluded.name,
  category = excluded.category,
  unit_of_measure = excluded.unit_of_measure,
  price = excluded.price,
  active = excluded.active;

insert into public.price_lists (id, product_id, price_tier, price, valid_from) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'standard_dealer', 31.75, '2026-01-01'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'standard_dealer', 34.25, '2026-01-01'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'standard_dealer', 37.50, '2026-01-01'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 'standard_dealer', 39.75, '2026-01-01'),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', 'standard_dealer', 29.50, '2026-01-01')
on conflict (id) do update set
  product_id = excluded.product_id,
  price_tier = excluded.price_tier,
  price = excluded.price,
  valid_from = excluded.valid_from;
