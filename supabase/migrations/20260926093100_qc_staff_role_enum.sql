-- Adds the optional QC staff role from PRD section 3.2.
--
-- Kept in its own file on purpose. `alter type ... add value` cannot have the new
-- value used until the transaction commits, and every policy, cast and seed row
-- that mentions 'qc_staff' does exactly that. One file, one transaction, so the
-- value is committed here and only becomes usable in the next migration.

alter type public.user_role add value if not exists 'qc_staff';
