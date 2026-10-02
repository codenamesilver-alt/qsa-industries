-- A starting job title catalogue.
--
-- Three titles existed before this: CEO, Director and Partner, which were chosen
-- to show what a title looks like rather than to describe a real factory. That
-- leaves an admin opening the job title screen in October 2026 with three entries
-- and no way to add a fourth from anywhere, because the picker on a person's card
-- deliberately refuses to invent titles -- see web/src/components/designation-manager.tsx
-- for why creating is separated from choosing.
--
-- So these are here to be deleted. They are a starting set for a company that runs
-- production, quality, stores, purchasing, logistics, sales and accounts, because
-- a picker containing only three senior titles is not a usable starting point and
-- the alternative -- an admin typing twelve titles into a text box one at a time,
-- one person at a time -- is worse.
--
-- Written as insert-if-absent rather than an upsert, deliberately:
--
--   * An admin who has already renamed "Quality Manager" keeps their name. This
--     migration must not put the word back.
--   * An admin who has already retired a title keeps it retired. is_active is not
--     in the insert.
--   * Re-running is harmless.
--
-- Nothing is assigned to anybody. These rows exist to be chosen, and public.users
-- still has exactly the designation_id values it had before this file ran.

insert into public.designations (name, description, sort_order)
select v.name, v.description, v.sort_order
from (values
  -- Company. The three that already existed are not repeated here.
  ('Plant Manager',            'Runs the shop floor day to day',                                  10),
  ('Production Manager',       'Owns production runs and their output',                           20),
  ('Quality Manager',          'Owns incoming and in-process quality decisions',                  30),
  ('Quality Inspector',        'Inspects incoming raw material and finished goods',               40),
  ('QC Chemist',               'Runs the laboratory against a batch specification',               50),
  ('Store Keeper',             'Owns the physical racks, receipts and issue of stock',            60),
  ('Inventory Manager',        'Owns stock levels, reorder points and the movement ledger',       70),
  ('Purchase Manager',         'Raises purchase orders against raw materials and their suppliers',80),
  ('Logistics Manager',        'Owns dispatch, transit and delivery',                             90),
  ('Accounts Executive',       'Raises invoices and takes payments',                             100),
  ('Accounts Manager',         'Owns invoicing, allocation and the ledger export',               110),
  ('Finance Manager',          'Owns pricing, credit policy and finance settings',               120),
  ('Sales Director',           'Owns the regional sales plan',                                   130),
  ('Sales Manager',            'Runs a region and the people reporting into it',                 140),
  ('Senior Sales Executive',   'Handles the larger accounts in a region',                        150),
  ('Sales Executive',          'Handles a set of dealers',                                       160),
  ('Customer Care Executive',  'Handles service and repeat orders for existing dealers',         170)
) as v (name, description, sort_order)
where not exists (
  select 1 from public.designations as d where lower(d.name) = lower(v.name)
);

-- ---------------------------------------------------------------------------
-- Why the three originals stay in place
--
-- CEO, Director and Partner are not in the list above because they are not
-- factory floor titles; they are here because 20261003100000 seeded them and
-- because a company chart with a CEO at the top of it is a reasonable thing for a
-- founder to want to see. If they are wrong for this business, retire them from
-- the job title screen -- nobody has to be holding them, and retiring is
-- reversible. Deleting is not offered on purpose: public.users.designation_id
-- points here, and a hard delete would take the title off somebody's card with no
-- way back.
-- ---------------------------------------------------------------------------