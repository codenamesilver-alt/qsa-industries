import { createClient } from "./supabase/server";

type Page<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

export type InventoryRow = {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  unit_of_measure: string;
  current_quantity: number | string;
  low_stock_threshold: number | string;
  low_stock: boolean;
  updated_at: string;
};

export type StockMovementRow = {
  id: string;
  product_id: string;
  quantity: number | string;
  movement_type: "in" | "out";
  source: "production" | "sales" | "adjustment" | "opening_balance" | "purchase";
  reason: string | null;
  created_at: string;
  product?: { name: string; sku: string } | null;
};

export type ExpiringBatchRow = {
  batch_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  batch_code: string;
  manufacture_date: string | null;
  expiry_date: string;
  available_quantity: number | string;
  days_remaining: number | string;
  expiry_status: "expired" | "critical" | "warning" | "ok";
};

export type PurchaseOrderLineRow = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  quantity_received: number | string;
  products?: { name: string; sku: string } | null;
};

export type PurchaseOrderRow = {
  id: string;
  po_number: string;
  supplier_name: string;
  supplier_gstin: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  order_date: string;
  expected_date: string | null;
  total_amount: number | string;
  notes: string | null;
  received_at: string | null;
  purchase_order_lines?: PurchaseOrderLineRow[] | null;
};

export type DealerAgeingRow = {
  dealer_id: string;
  dealer_name: string;
  open_invoice_count: number | string;
  total_outstanding: number | string;
  current_amount: number | string;
  bucket_1_amount: number | string;
  bucket_2_amount: number | string;
  bucket_3_amount: number | string;
  bucket_4_plus_amount: number | string;
};

export type FinanceSettingsRow = {
  id: boolean;
  gst_rate: number | string;
  company_state: string | null;
  price_includes_gst: boolean;
  ageing_grace_days: number | string | null;
  ageing_bucket_1_days: number | string | null;
  ageing_bucket_2_days: number | string | null;
  ageing_bucket_3_days: number | string | null;
  credit_counts_current_invoices: boolean;
  updated_at: string;
};

export type DealerRow = {
  id: string;
  name: string;
  region: string | null;
  status: "active" | "suspended";
  credit_limit: number | string;
  credit_limit_override: number | string | null;
  sales_rep_id: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
};

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  price: number | string;
  is_sellable: boolean;
};

// The admin catalogue. Carries the three fields getProducts() leaves out, each
// of which is an admin-only edit: hsn_code because an invoice cannot be raised
// without one, low_stock_threshold because the replenishment report reads it,
// and active because a retired product has to stay visible to be un-retired.
export type AdminProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  price: number | string;
  hsn_code: string;
  low_stock_threshold: number | string;
  is_sellable: boolean;
  active: boolean;
};

export type AdminDealerRow = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  credit_limit: number | string;
  credit_limit_override: number | string | null;
  status: "active" | "inactive" | "suspended";
  region: string | null;
  sales_rep_id: string | null;
};

// No embedded product or dealer: the labels are resolved by the page from the
// catalogue and dealer master it already loaded, so a role that can read a price
// but not the master row behind it still gets a labelled table.
export type PriceListRow = {
  id: string;
  product_id: string;
  dealer_id: string | null;
  price_tier: string | null;
  price: number | string;
  valid_from: string | null;
  valid_to: string | null;
};

// Mirrors public.user_directory. dealer_name and manager_name are the point of
// the view: reading users, dealers and user_hierarchy separately and joining
// them client side would drop every row the joining role cannot see, which is
// precisely the failure the view was written to avoid.
export type UserDirectoryRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  dealer_id: string | null;
  dealer_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_role: string | null;
};

export type DeliveryStatusValue = "awaiting_dispatch" | "in_transit" | "delivered";

// Mirrors public.delivery_board. days_in_transit is negative for a consignment
// dispatched ahead of the business date, so a screen must not assume a sign.
export type DeliveryBoardRow = {
  order_id: string;
  order_reference: string;
  dealer_name: string | null;
  sales_rep_id: string | null;
  status: string;
  delivery_status: DeliveryStatusValue;
  dispatch_date: string | null;
  delivered_at: string | null;
  tracking_note: string | null;
  delivery_note: string | null;
  total_amount: number | string;
  days_in_transit: number | string | null;
};

export type ProductionSummaryRow = {
  run_date: string;
  product_id: string;
  product_name: string;
  total_output: number | string;
  total_raw_material_input: number | string;
  yield_ratio: number | string | null;
};

export type ProductionRunRow = {
  id: string;
  run_date: string;
  shift: string;
  product_id: string;
  quantity_produced: number | string;
  qc_status: "pending" | "passed" | "failed";
  qc_notes: string | null;
  created_by: string;
  products?: { name: string; sku: string } | null;
};

export type OrderRow = {
  id: string;
  dealer_id: string;
  sales_rep_id: string;
  status: "pending" | "approved" | "pending_director_approval" | "dispatched" | "invoiced" | "rejected";
  total_amount: number | string;
  credit_override: boolean;
  created_at: string;
  dispatch_date: string | null;
  tracking_note: string | null;
  delivery_status: DeliveryStatusValue;
  delivered_at: string | null;
  dealer?: { name: string } | null;
  order_items?: OrderItemRow[] | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  product?: { name: string; sku: string } | null;
};

export type StatusSummaryRow = {
  status: OrderRow["status"];
  order_count: number | string;
  total_amount: number | string;
};

export type SalesDailyRow = {
  order_date: string;
  order_count: number | string;
  approved_sales_amount: number | string;
  rejected_amount: number | string;
};

export type DealerExposureRow = {
  dealer_id: string;
  dealer_name: string;
  credit_limit: number | string;
  exposure: number | string;
  available_credit: number | string;
};

export type DealerCatalogRow = {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  unit_of_measure: string;
  list_price: number | string;
  unit_price: number | string;
  available_quantity: number | string;
};

export type InvoiceRow = {
  id: string;
  order_id: string;
  dealer_id: string;
  invoice_number: string;
  taxable_amount: number | string;
  gst_amount: number | string;
  total_amount: number | string;
  invoice_date: string;
  created_at: string;
  dealer?: { name: string } | null;
};

export type PaymentRow = {
  id: string;
  invoice_id: string | null;
  dealer_id: string;
  amount: number | string;
  payment_date: string;
  mode: "cash" | "bank_transfer" | "upi" | "cheque" | "other";
  reference: string | null;
  dealer?: { name: string } | null;
  invoice?: { invoice_number: string } | null;
};

export type DealerLedgerRow = {
  invoice_id: string;
  invoice_number: string;
  dealer_id: string;
  invoice_date: string;
  total_amount: number | string;
  paid_amount: number | string;
  outstanding_amount: number | string;
};

export async function getInventoryDashboard() {
  const supabase = await createClient();
  const rows = await fetchAll<InventoryRow>((from, to) =>
    supabase
      .from("inventory_dashboard")
      .select("*")
      .order("low_stock", { ascending: false })
      .order("product_name")
      .order("product_id")
      .range(from, to),
  );
  return rows;
}

export async function getStockMovements(productId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("stock_movements")
    .select("id, product_id, quantity, movement_type, source, reason, created_at, products(name, sku)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as StockMovementRow[];
}

export async function getProducts() {
  const supabase = await createClient();
  const rows = await fetchAll<ProductRow>((from, to) =>
    supabase
      .from("products")
      .select("id, sku, name, category, unit_of_measure, price, is_sellable")
      .eq("active", true)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getRawMaterials() {
  const supabase = await createClient();
  const rows = await fetchAll<{
    id: string;
    product_id: string;
    name: string;
    unit: string;
    products: { name: string; sku: string }[] | null;
  }>((from, to) =>
    supabase
      .from("raw_materials")
      .select("id, product_id, name, unit, products(name, sku)")
      .order("name")
      .order("product_id")
      .range(from, to),
  );
  return rows;
}

export async function getProductionSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_period_summary")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(90);
  if (error) throw error;
  return (data ?? []) as ProductionSummaryRow[];
}

export async function getProductionRuns() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_runs")
    .select("id, run_date, shift, product_id, quantity_produced, qc_status, qc_notes, created_by, products(name, sku)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as ProductionRunRow[];
}

export async function getStatusSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_status_summary")
    .select("*")
    .order("status");
  if (error) throw error;
  return (data ?? []) as StatusSummaryRow[];
}

export async function getSalesDaily() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_daily")
    .select("*")
    .order("order_date", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as SalesDailyRow[];
}

export async function getDealerExposure() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerExposureRow>((from, to) =>
    supabase
      .from("dealer_credit_exposure")
      .select("*")
      .order("exposure", { ascending: false })
      .order("dealer_id")
      .range(from, to),
  );
  return rows;
}

export async function getOrders() {
  const supabase = await createClient();
  const rows = await fetchAll<OrderRow>((from, to) =>
    supabase
      .from("orders")
      .select("*, dealers(name), order_items(*, products(name, sku))")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getDealerCatalog() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerCatalogRow>((from, to) =>
    supabase
      .from("dealer_catalog")
      .select("*")
      .order("product_name")
      .order("product_id")
      .range(from, to),
  );
  return rows;
}

export async function getDealerOrders() {
  const supabase = await createClient();
  const rows = await fetchAll<OrderRow>((from, to) =>
    supabase
      .from("orders")
      .select("*, order_items(*, products(name, sku))")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getInvoices() {
  const supabase = await createClient();
  const rows = await fetchAll<InvoiceRow>((from, to) =>
    supabase
      .from("invoices")
      .select("*, dealers(name)")
      .order("invoice_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getPayments() {
  const supabase = await createClient();
  const rows = await fetchAll<PaymentRow>((from, to) =>
    supabase
      .from("payments")
      .select("*, dealers(name), invoices(invoice_number)")
      .order("payment_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getDealerLedger() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerLedgerRow>((from, to) =>
    supabase
      .from("dealer_ledger")
      .select("*")
      .order("invoice_date", { ascending: false })
      .order("invoice_id")
      .range(from, to),
  );
  return rows;
}

export async function getDealerCredit(dealerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dealer_credit_summary", {
    target_dealer_id: dealerId,
  });
  if (error) throw error;
  return (data?.[0] ?? null) as {
    dealer_id: string;
    credit_limit: number | string;
    outstanding_invoices: number | string;
    available_credit: number | string;
  } | null;
}

// --- 20260926 surfaces -------------------------------------------------------
//
// Each of these reads a view or table that already existed in the database but
// had no caller in the app, so every one of them is a new screen rather than a
// new query.

export async function getExpiringBatches() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expiring_batches")
    .select("*")
    .order("days_remaining")
    .order("sku")
    .order("batch_code")
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ExpiringBatchRow[];
}

export async function getPurchaseOrders() {
  const supabase = await createClient();
  const rows = await fetchAll<PurchaseOrderRow>((from, to) =>
    supabase
      .from("purchase_orders")
      .select("*, purchase_order_lines(*, products(name, sku))")
      .order("order_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

export async function getDealerInvoiceAgeing() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerAgeingRow>((from, to) =>
    supabase
      .from("dealer_invoice_ageing")
      .select("*")
      .order("total_outstanding", { ascending: false })
      .order("dealer_id")
      .range(from, to),
  );
  return rows;
}

export async function getFinanceSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("finance_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data as FinanceSettingsRow | null;
}

// The commercial columns on dealers are guarded in the database, so this list is
// only reachable by admin and finance. It carries credit_limit_override rather
// than the raw limit, because the override is the number that actually governs
// the account and a screen that showed the base limit would misreport a dealer's
// real headroom.
export async function getDealers() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerRow>((from, to) =>
    supabase
      .from("dealers")
      .select(
        "id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state",
      )
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// Proxy ordering needs the dealers a sales rep is mapped to. The database
// enforces that same set inside create_dealer_order, so this list is a
// convenience for the picker, not the authority: the RPC still refuses a dealer
// that is not mapped, which stage11 asserts.
export async function getMappedDealers() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [] as DealerRow[];

  const rows = await fetchAll<DealerRow>((from, to) =>
    supabase
      .from("dealers")
      .select(
        "id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state",
      )
      .eq("sales_rep_id", userId)
      .eq("status", "active")
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// An admin enters proxy orders for any account, so the picker is every active
// dealer rather than a mapped set. An admin is not themselves mapped to anything,
// which is exactly why this cannot reuse getMappedDealers(): it would return an
// empty list and the order would go out with no dealer named.
export async function getActiveDealers() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerRow>((from, to) =>
    supabase
      .from("dealers")
      .select(
        "id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state",
      )
      .eq("status", "active")
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// create_purchase_order only accepts products that are not sellable, so the
// picker needs the raw-material half of the catalogue rather than getProducts(),
// which is the sellable half.
export async function getRawMaterialProducts() {
  const supabase = await createClient();
  const rows = await fetchAll<ProductRow>((from, to) =>
    supabase
      .from("products")
      .select("id, sku, name, category, unit_of_measure, price, is_sellable")
      .eq("active", true)
      .eq("is_sellable", false)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// --- 20260927 admin master data and delivery --------------------------------

// getProducts() filters to active rows and omits the HSN code and the reorder
// threshold, all three of which the admin screen needs: retiring a product and
// correcting its HSN are exactly the edits an administrator is here to make, and
// a list that hid retired products could not show what had been retired.
export async function getAdminProducts() {
  const supabase = await createClient();
  const rows = await fetchAll<AdminProductRow>((from, to) =>
    supabase
      .from("products")
      .select(
        "id, sku, name, category, unit_of_measure, price, hsn_code, low_stock_threshold, is_sellable, active",
      )
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// The finance list deliberately carries credit_limit_override and omits the
// address block, because it is a credit screen. The admin dealer form is a
// master-data form, so it needs the whole row, and it carries the three states
// dealer_status actually has rather than the two getDealers() exposes.
export async function getAdminDealers() {
  const supabase = await createClient();
  const rows = await fetchAll<AdminDealerRow>((from, to) =>
    supabase
      .from("dealers")
      .select(
        "id, name, contact_person, phone, email, address_line1, address_line2, city, state, postal_code, credit_limit, credit_limit_override, status, region, sales_rep_id",
      )
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows;
}

// Reads the table, not a view, because there is no view for it: the admin screen
// is the one place that needs the whole list. The product and dealer names are
// left as ids and resolved by the page, which already holds both lists.
//
// That is not a style choice. price_lists_select_scope filters on can_view_price_list
// and the dealers policy filters on can_view_dealer, so an embedded
// "products(name), dealers(name)" would return an empty object for a role that
// can see the price but not the master row behind it, and the admin table would
// show a column of blanks. Resolving against lists the caller already holds keeps
// the label and the row on the same footing.
//
// price_lists_select_scope also filters on the current date, so a price whose
// valid_from is in the future is invisible here until the day it starts. That is a
// real limitation of the screen rather than a bug in it, and report 006 says so.
export async function getPriceLists() {
  const supabase = await createClient();
  const rows = await fetchAll<PriceListRow>((from, to) =>
    supabase
      .from("price_lists")
      .select("id, product_id, dealer_id, price_tier, price, valid_from, valid_to")
      .order("product_id")
      .order("dealer_id", { nullsFirst: false })
      .order("price_tier", { nullsFirst: false })
      .order("valid_from", { nullsFirst: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

// public.user_directory, added in 20260927093000. security_invoker, so
// private.can_view_user still applies underneath: an admin sees everyone and a
// manager sees their own reps.
export async function getUserDirectory() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_directory")
    .select("*")
    .order("full_name")
    .order("user_id");
  if (error) throw error;
  return (data ?? []) as UserDirectoryRow[];
}

// public.delivery_board. security_invoker on orders, so a dealer sees their own
// rows and logistics sees the whole book; dealer_name comes from
// private.dealer_display_name rather than a join, which is what stops the board
// reading empty for logistics.
export async function getDeliveryBoard() {
  const supabase = await createClient();
  const rows = await fetchAll<DeliveryBoardRow>((from, to) =>
    supabase
      .from("delivery_board")
      .select("*")
      .order("delivery_status")
      .order("dispatch_date", { ascending: false })
      .order("order_id")
      .range(from, to),
  );
  return rows;
}

// Only an admin can read the full user list, because private.can_view_user
// returns true unconditionally for an admin and falls back to "only yourself"
// for everyone else. That matches the guard: reassignment of sales_rep_id is an
// admin-only decision, so only an admin needs the rep picker at all.
export async function getSalesReps() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, role")
    .in("role", ["sales_rep", "sales_manager", "sales_director"])
    .eq("is_active", true)
    .order("full_name")
    .order("id");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; full_name: string; role: string }>;
}
