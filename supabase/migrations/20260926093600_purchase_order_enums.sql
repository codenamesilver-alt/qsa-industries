-- Enum values needed by raw-material purchasing, in one file because neither can
-- be used until this transaction commits.
--
--   * stock_movement_source gains 'purchase' so a goods receipt is
--     distinguishable from production output or a manual correction once it is
--     sitting in the ledger.
--   * purchase_order_status is new: a PO moves draft -> ordered -> received, and
--     the intermediate partial state is what makes a short delivery visible
--     instead of silently closing the order.

alter type public.stock_movement_source add value if not exists 'purchase';

create type public.purchase_order_status as enum (
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled'
);
