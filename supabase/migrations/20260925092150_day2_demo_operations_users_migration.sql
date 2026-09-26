-- Makes the demo account set reproducible from migrations alone.
--
-- 20260925082457_day1_demo_seed.sql creates eight auth users, but the operations
-- accounts the dataset and the portals need -- production_manager,
-- inventory_manager, logistics, finance and the dealer login for Coastal Agri
-- Enterprises -- were provisioned out of band. Nothing in the repository created
-- them, so a fresh install replayed the migrations and then failed inside
-- 20260925092200_dev_demo_dataset with:
--
--   ERROR:  You cannot adjust inventory
--
-- because private.current_user_role() resolves to null when the inventory
-- manager has no row in public.users.
--
-- The same run also left every demo account with the unusable random password
-- that the day-1 seed installs, so a fresh install could not sign in at all.
--
-- DEVELOPMENT ONLY. This migration creates demo accounts with a shared
-- development password. Do not apply it to a production database: rotate the
-- credentials and drop this file before any real launch. To use a different
-- development password, set it on the session first:
--
--   set qsa.demo_password = 'something-else';
--
-- Everything here is idempotent, so re-running it against a database that was
-- provisioned by hand changes nothing.

do $$
declare
  v_password constant text := coalesce(
    nullif(current_setting('qsa.demo_password', true), ''),
    'Qsa@Demo2026'
  );
  v_rec record;
begin
  raise notice
    'Provisioning demo operations accounts with the shared development password (override with: set qsa.demo_password = ''...''; before running).';

  for v_rec in
    select *
    from jsonb_to_recordset($json$[
      {"id":"bddaf4a6-c4c0-4637-8369-c3cb7338098d","full_name":"Priya Production",         "email":"operations.production@qsa-demo.in","role":"production_manager","dealer_id":null},
      {"id":"6a251aaf-5609-4b83-a04c-282929b6197b","full_name":"Ishaan Inventory",         "email":"operations.inventory@qsa-demo.in", "role":"inventory_manager", "dealer_id":null},
      {"id":"890e8dd2-9940-4be8-b79c-a43c9de3ce0c","full_name":"Kiran Logistics",          "email":"logistics@qsa-demo.in",            "role":"logistics",          "dealer_id":null},
      {"id":"22145f21-ebba-4e23-8bc5-b9650307a4ea","full_name":"Farah Finance",            "email":"finance@qsa-demo.in",              "role":"finance",            "dealer_id":null},
      {"id":"4637f04f-aed6-44bc-82d8-774991079d1d","full_name":"Coastal Agri Enterprises", "email":"dealer@qsa-demo.in",               "role":"dealer",             "dealer_id":"20000000-0000-4000-8000-000000000003"}
    ]$json$::jsonb)
      as r(id uuid, full_name text, email text, role text, dealer_id uuid)
  loop
    ------------------------------------------------------------ auth account

    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      phone_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      v_rec.id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_rec.email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'role', v_rec.role,
        'provider', 'email',
        'providers', jsonb_build_array('email')
      ),
      jsonb_build_object('full_name', v_rec.full_name, 'email_verified', true),
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
    )
    values (
      gen_random_uuid(),
      v_rec.id,
      v_rec.id,
      jsonb_build_object(
        'sub', v_rec.id,
        'email', v_rec.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    )
    on conflict (provider_id, provider) do nothing;

    ------------------------------------------------------- application profile

    -- The on_auth_user_created trigger already inserts this row from the app
    -- metadata, but upsert explicitly so the role and the dealer link are
    -- correct even on a database where the trigger is missing.
    insert into public.users (id, full_name, email, role, dealer_id, is_active)
    values (
      v_rec.id,
      v_rec.full_name,
      v_rec.email,
      v_rec.role::public.user_role,
      v_rec.dealer_id,
      true
    )
    on conflict (id) do update
      set full_name  = excluded.full_name,
          email      = excluded.email,
          role       = excluded.role,
          dealer_id  = excluded.dealer_id,
          is_active  = true;
  end loop;

  --------------------------------------------- usable passwords for the demo set

  -- The day-1 seed installs a random bcrypt hash that nobody can sign in with.
  -- Give every @qsa-demo.in account the shared development password so a fresh
  -- install is actually usable across all three portals.
  update auth.users
  set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf'))
  where id in (
    select u.id
    from public.users as u
    where u.email like '%@qsa-demo.in'
  );
end
$$;
