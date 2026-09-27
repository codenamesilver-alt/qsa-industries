-- QC staff: an independent sign-off on production runs.
--
-- The PRD lists QC staff as an optional role on the internal portal. The point
-- of a separate role is segregation of duties: whoever ran the shift should not
-- also be the person certifying the output. Before this, only the run's creator
-- or an admin could set a QC verdict, so QC could never be independent.
--
-- private.validate_production_qc_update() already rejects any update that
-- touches run_date, shift, product, quantity or author, so granting this role
-- UPDATE cannot be used to rewrite production history. Only qc_status and
-- qc_notes get through, and a finalized verdict still cannot be reopened.

-- ---------------------------------------------------------------------------
-- Read access: a QC inspector has to see the run and what it consumed
-- ---------------------------------------------------------------------------

drop policy if exists production_runs_select_scope on public.production_runs;

create policy production_runs_select_scope
  on public.production_runs
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'inventory_manager'::public.user_role,
        'finance'::public.user_role,
        'qc_staff'::public.user_role
      ]
    )
  );

drop policy if exists production_materials_select_scope on public.production_run_materials;

create policy production_materials_select_scope
  on public.production_run_materials
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'inventory_manager'::public.user_role,
        'finance'::public.user_role,
        'qc_staff'::public.user_role
      ]
    )
  );

drop policy if exists raw_materials_select_scope on public.raw_materials;

create policy raw_materials_select_scope
  on public.raw_materials
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'inventory_manager'::public.user_role,
        'finance'::public.user_role,
        'qc_staff'::public.user_role
      ]
    )
  );

-- raw_materials_write_internal is deliberately left as it is. QC staff inspect
-- the bill of materials; they do not edit it.

-- ---------------------------------------------------------------------------
-- Write access: a verdict on any run, not just your own
-- ---------------------------------------------------------------------------

drop policy if exists production_runs_update_internal on public.production_runs;

create policy production_runs_update_internal
  on public.production_runs
  for update
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'qc_staff'::public.user_role
      ]
    )
    and (
      -- Admin and QC sign off on anything. A production manager may only amend
      -- QC fields on a run they recorded themselves.
      private.current_user_role() = any (array['admin'::public.user_role, 'qc_staff'::public.user_role])
      or created_by = (select auth.uid())
    )
  )
  with check (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'qc_staff'::public.user_role
      ]
    )
  );

-- Column-level grant was already in place for every authenticated user; RLS is
-- what actually decides, and the policy above is the decision.

-- ---------------------------------------------------------------------------
-- Demo account, so the role is exercised by the browser smoke suite
-- ---------------------------------------------------------------------------
--
-- DEVELOPMENT ONLY, same shared password and same caveat as
-- 20260925092150_day2_demo_operations_users_migration.sql.

do $$
declare
  v_password constant text := coalesce(
    nullif(current_setting('qsa.demo_password', true), ''),
    'Qsa@Demo2026'
  );
  v_id constant uuid := '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    phone_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    v_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'qc@qsa-demo.in',
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(), '', '', '', '', '',
    jsonb_build_object('role', 'qc_staff', 'provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Ravi QC', 'email_verified', true),
    now(), now()
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(), v_id, v_id,
    jsonb_build_object('sub', v_id, 'email', 'qc@qsa-demo.in', 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  )
  on conflict (provider_id, provider) do nothing;

  insert into public.users (id, full_name, email, role, dealer_id, is_active)
  values (v_id, 'Ravi QC', 'qc@qsa-demo.in', 'qc_staff', null, true)
  on conflict (id) do update
    set full_name = excluded.full_name,
        email     = excluded.email,
        role      = excluded.role,
        is_active = true;

  update auth.users
     set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf'))
   where id = v_id;
end
$$;
