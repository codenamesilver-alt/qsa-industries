import { createClient } from "./supabase/server";
import type { ReportRange } from "./report-range";

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
  status: "active" | "inactive" | "suspended";
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
  // Added in 20261002120000. The designation is the person's job title and is
  // deliberately independent of both the permission role and the org post title,
  // so all three can be null without any of them shadowing another.
  designation: string | null;
  // Added in 20261003100000. The name above is resolved through the catalogue, so
  // this is the reference it was resolved from: the pickers write it, not the
  // text, because a title typed twice is two titles and the permission screen
  // needs the row rather than the wording.
  designation_id: string | null;
  phone: string | null;
  dealer_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_role: string | null;
};

// Mirrors public.designations, added in 20261003100000. The catalogue of job
// titles: one row per title a person can hold, and the thing every title picker in
// the app reads. Sorted active first then by sort_order then name, which is the
// order the table's own index encodes.
export type DesignationRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export async function getDesignations() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("designations")
    .select("id, name, description, sort_order, is_active")
    .order("is_active", { ascending: false })
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []) as DesignationRow[];
}

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
  requested_delivery_date: string | null;
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

// Regional and hierarchy rollups, PRD 9.4. realized_* is revenue the business has
// committed to (approved, dispatched, invoiced) and pipeline_* is live but
// uncommitted demand, which is also credit exposure. The two are never added
// together: mixing them produces a number that is neither revenue nor risk.
export type SalesByRegionPeriodRow = {
  region: string;
  period: string;
  dealers_selling: number | string;
  realized_orders: number | string;
  realized_amount: number | string;
  pipeline_orders: number | string;
  pipeline_amount: number | string;
  rejected_orders: number | string;
  rejected_amount: number | string;
};

export type SalesByRegionTotalsRow = {
  region: string;
  dealer_count: number | string;
  realized_orders: number | string;
  realized_amount: number | string;
  pipeline_orders: number | string;
  pipeline_amount: number | string;
};

export type SalesByRepRow = {
  rep_id: string;
  rep_name: string;
  manager_id: string | null;
  manager_name: string;
  region: string;
  dealer_count: number | string;
  realized_orders: number | string;
  realized_amount: number | string;
  pipeline_orders: number | string;
  pipeline_amount: number | string;
};

export type SalesByDealerRow = {
  dealer_id: string;
  dealer_name: string;
  region: string;
  state: string | null;
  status: string;
  credit_limit: number | string;
  realized_orders: number | string;
  realized_amount: number | string;
  pipeline_orders: number | string;
  pipeline_amount: number | string;
  invoiced_amount: number | string;
  open_invoices: number | string;
  outstanding_amount: number | string;
};

export type DealerExposureRow = {
  dealer_id: string;
  dealer_name: string;
  credit_limit: number | string;
  exposure: number | string;
  available_credit: number | string;
};

// --- 20260928101000 and 20260928101500 ----------------------------------------
//
// Every amount here arrives as numeric and is used as a number, so these are typed
// number | string like the rest of the file. That is deliberate: a view summing
// numeric columns in Postgres returns numeric, which the Supabase client hands over
// as a string, and coercing it to number at the type level would hide the real
// boundary. Every loader consumer calls Number() on these, and the chart components
// take numbers, so a string that slipped through would render as NaN rather than
// silently plotting zero.

export type DealerRepCoverageRow = {
  rep_id: string;
  rep_name: string;
  is_active: boolean;
  manager_name: string;
  dealer_count: number | string;
  realized_amount: number | string;
  pipeline_amount: number | string;
  // Counted per rep, so it is a per-rep reminder and never a total. See the view.
  unassigned_dealers: number | string;
};

export type SalesRepDealerRow = {
  dealer_id: string;
  dealer_name: string;
  status: string;
  region: string;
  sales_rep_id: string | null;
  rep_name: string;
  credit_limit: number | string;
  credit_limit_override: number | string | null;
};

export type SalesDailySplitRow = {
  order_date: string;
  realized_orders: number | string;
  realized_amount: number | string;
  pipeline_orders: number | string;
  pipeline_amount: number | string;
  rejected_orders: number | string;
  rejected_amount: number | string;
};

export type StageFunnelRow = {
  status: string;
  stage_order: number | string;
  order_count: number | string;
  total_amount: number | string;
  oldest_created_at: string | null;
};

export type ProductionDailyRow = {
  run_date: string;
  run_count: number | string;
  product_count: number | string;
  total_output: number | string;
  total_input: number | string;
  yield_ratio: number | string | null;
};

export type ProductionYieldRow = {
  product_id: string;
  product_name: string;
  sku: string;
  run_count: number | string;
  total_output: number | string;
  total_input: number | string;
  yield_ratio: number | string | null;
  last_run_date: string | null;
};

export type InventoryAgingRow = {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  unit_of_measure: string;
  current_quantity: number | string;
  low_stock_threshold: number | string;
  last_movement_at: string | null;
  last_movement_date: string | null;
  days_since_movement: number | string | null;
  dead_stock: boolean;
};

export type CreditExposureSummaryRow = {
  dealer_id: string;
  dealer_name: string;
  region: string;
  status: string;
  credit_limit: number | string;
  exposure: number | string;
  available_credit: number | string;
  outstanding_amount: number | string;
  open_invoices: number | string;
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

// Ordered oldest first, unlike getSalesDaily, because a trend line reads left to
// right. The view is month-bucketed rather than day-bucketed, so an empty month is
// genuinely absent instead of present with a zero; the chart component backfills it.
export async function getSalesByRegionPeriod() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRegionPeriodRow>((from, to) =>
    supabase
      .from("sales_by_region_period")
      .select("*")
      .order("period", { ascending: true })
      .order("region")
      .range(from, to),
  );
  return rows;
}

export async function getSalesByRegionTotals() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRegionTotalsRow>((from, to) =>
    supabase
      .from("sales_by_region_period_totals")
      .select("*")
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
}

export async function getSalesByRep() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRepRow>((from, to) =>
    supabase
      .from("sales_by_rep")
      .select("*")
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
}

export async function getSalesByDealer() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByDealerRow>((from, to) =>
    supabase
      .from("sales_by_dealer")
      .select("*")
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Date-bounded reporting, for /sales/reports and its export.
//
// These four call public.sales_report_* rather than the views above. The views
// are all-time aggregates and a view cannot take a parameter, so a window cannot
// be pushed into one, and it cannot be recovered afterwards either: the totals
// views have already summed orders into one row per group. The functions apply
// the range where the rows are still order level. With a null bound they return
// exactly what the views return, which supabase/tests/stage20 asserts against
// the live data, so the unfiltered report is unchanged.
//
// The views are kept and still used: the dashboard charts read sales_by_rep and
// sales_by_dealer, and stage16 and stage17 assert the view definitions directly.
// Nothing here replaces them.
//
// A range of { from: null, to: null } is the all-time report and is the normal
// case, not a degenerate one.
export async function getSalesReportRegionPeriod(range: ReportRange) {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRegionPeriodRow>((from, to) =>
    supabase
      .rpc("sales_report_region_period", { p_from: range.from, p_to: range.to })
      .order("period", { ascending: true })
      .order("region")
      .range(from, to),
  );
  return rows;
}

export async function getSalesReportRegionTotals(range: ReportRange) {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRegionTotalsRow>((from, to) =>
    supabase
      .rpc("sales_report_region_totals", { p_from: range.from, p_to: range.to })
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
}

export async function getSalesReportByRep(range: ReportRange) {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByRepRow>((from, to) =>
    supabase
      .rpc("sales_report_by_rep", { p_from: range.from, p_to: range.to })
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
}

export async function getSalesReportByDealer(range: ReportRange) {
  const supabase = await createClient();
  const rows = await fetchAll<SalesByDealerRow>((from, to) =>
    supabase
      .rpc("sales_report_by_dealer", { p_from: range.from, p_to: range.to })
      .order("realized_amount", { ascending: false })
      .range(from, to),
  );
  return rows;
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

// The caller's own catalogue, priced for the caller's own dealer. A rep or an
// admin has no dealer, so dealer_catalog falls back to the standard tier for them
// and would show a total their database never charges for a dealer with a price
// list. This prices a dealer they are actually entitled to price, which is what an
// order form has to show. The RPC refuses a dealer the caller may not price, so
// this is not a way to read another dealer's prices.
export async function getDealerCatalogFor(dealerId: string): Promise<DealerCatalogRow[]> {
  if (!dealerId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dealer_catalog_for", {
    target_dealer_id: dealerId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DealerCatalogRow[];
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

// public.org_chart, added in 20260928110000. security_invoker on
// org_positions, so the policy underneath admits internal staff and nobody else,
// and the person on each post comes from private.org_person rather than a join on
// users, which the users policy would empty for every reader but an admin.
//
// Kept because org_positions and its four admin functions still exist and are
// still tested; the org chart page no longer reads it. A post is not a person, and
// the chart below is a projection of people rather than of boxes on a wall.
export type OrgChartRow = {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  user_id: string | null;
  user_full_name: string | null;
  user_email: string | null;
  user_role: string | null;
  user_designation: string | null;
  user_designation_id: string | null;
  user_is_active: boolean | null;
};

export async function getOrgChart() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_chart")
    .select("*")
    .order("sort_order")
    .order("title")
    .order("id");
  if (error) throw error;
  return (data ?? []) as OrgChartRow[];
}

// public.org_people_tree, added in 20261003110000. One row per employee, which is
// one row per box on the chart, and the box carries the person rather than being a
// separate thing that happens to be filled.
//
// The difference from org_chart above is the shape of the data rather than the
// reading of it: reports_to_id is a column on the person, so a person with nobody
// above them is a head of the company rather than a chart with one root and no way
// to express a second one. reports_to_name is in the view so the box can name
// whoever it reports to without the client walking the tree a second time.
export type OrgPersonRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  designation_id: string | null;
  designation: string | null;
  is_active: boolean;
  reports_to_id: string | null;
  reports_to_name: string | null;
  reports_to_designation_id: string | null;
  reports_to_designation: string | null;
  sort_order: number;
};

export async function getOrgPeople() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_people_tree")
    .select("*")
    .order("sort_order")
    .order("full_name")
    .order("user_id");
  if (error) throw error;
  return (data ?? []) as OrgPersonRow[];
}

// public.org_staff_roster, for the two pickers on the builder: the person on a
// post, and the person who might be. Sorted by name here rather than in SQL so the
// pickers read alphabetically, which is how a person looks for themselves in a
// list of colleagues.
export type OrgStaffMember = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export async function getOrgStaffRoster() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_staff_roster")
    .select("*")
    .order("full_name")
    .order("user_id");
  if (error) throw error;
  return (data ?? []) as OrgStaffMember[];
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

// --- 20260928101000 and 20260928101500 dashboards and team assignment --------

// public.dealer_rep_coverage. One row per rep, including reps with no dealers,
// which is the row a manager is looking for when they open the screen. A list built
// from dealers alone drops them, and "this rep covers nothing" would never appear.
export async function getRepCoverage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dealer_rep_coverage")
    .select("*")
    // rep_name, not full_name. The view selects users.full_name but aliases it to
    // rep_name, so full_name is not a column of this relation and PostgREST rejects
    // the order-by outright -- which fails the whole query, and with it /sales/team,
    // rather than degrading to an unsorted list.
    .order("rep_name")
    .order("rep_id");
  if (error) throw error;
  return (data ?? []) as DealerRepCoverageRow[];
}

// public.sales_rep_dealers. This is the assignable list a manager sees before the
// write, scoped by the same can_view_dealer the function checks, so the form can
// never offer a dealer the write would then refuse.
export async function getTeamDealers() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesRepDealerRow>((from, to) =>
    supabase
      .from("sales_rep_dealers")
      .select("*")
      .order("dealer_name")
      .order("dealer_id")
      .range(from, to),
  );
  return rows;
}

// public.sales_daily_split. Ordered oldest first because a trend reads left to
// right. The view is day-bucketed and days with no orders are absent, so the chart
// backfills them.
export async function getSalesDailySplit() {
  const supabase = await createClient();
  const rows = await fetchAll<SalesDailySplitRow>((from, to) =>
    supabase
      .from("sales_daily_split")
      .select("*")
      .order("order_date", { ascending: true })
      .range(from, to),
  );
  return rows;
}

// public.order_stage_funnel. Ordered by the lifecycle position the view carries,
// not by status alphabetically, which would put rejected in the middle of the
// pipeline and read as a stage orders pass through.
export async function getStageFunnel() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_stage_funnel")
    .select("*")
    .order("stage_order");
  if (error) throw error;
  return (data ?? []) as StageFunnelRow[];
}

// public.production_daily_output, for the internal dashboard yield line.
export async function getProductionDaily() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_daily_output")
    .select("*")
    .order("run_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductionDailyRow[];
}

// public.production_yield_by_product, for the ranked comparison. Per product and not
// a single total because summing a ratio across products is meaningless.
export async function getProductionYieldByProduct() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_yield_by_product")
    .select("*")
    .order("yield_ratio", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as ProductionYieldRow[];
}

// public.inventory_aging, for stock levels with the reorder point marked. Sorts on
// quantity ascending in the view order below is left to the chart, which ranks by
// how far below threshold a product is rather than by absolute quantity: a warehouse
// with 40 units of one product and a threshold of 30 is not the problem that 2 units
// against a threshold of 50 is.
export async function getInventoryAging() {
  const supabase = await createClient();
  const rows = await fetchAll<InventoryAgingRow>((from, to) =>
    supabase
      .from("inventory_aging")
      .select("*")
      .order("product_name")
      .order("product_id")
      .range(from, to),
  );
  return rows;
}

// public.credit_exposure_summary. Replaces getDealerExposure on the sales dashboard
// because it adds the dealer_ledger outstanding figure, so exposure and what is
// actually owed come from one row and cannot drift apart.
export async function getCreditExposureSummary() {
  const supabase = await createClient();
  const rows = await fetchAll<CreditExposureSummaryRow>((from, to) =>
    supabase
      .from("credit_exposure_summary")
      .select("*")
      .order("exposure", { ascending: false })
      .order("dealer_id")
      .range(from, to),
  );
  return rows;
}

// Mirrors public.dealer_onboarding_board.
//
// The stage and outstanding columns come from the view rather than being derived
// in TypeScript, and that is the whole point of the view existing. A stage
// computed in the browser is a second copy of a rule that already lives in one
// CASE expression next to the columns it reads, and the copy that drifts is the
// one on screen. A dealer who was approved, logged in, and left unmapped to a rep
// was reported as credit_refused by the first draft of that CASE, which is a
// stage that says the dealer had been refused something they had not.
//
// Outstanding is a text[] and nullable: null on a closed record, because a
// declined or live dealer is not waiting on anything. The screen shows it
// verbatim rather than reordering it, since the order is the order the flow runs
// in.
export type DealerOnboardingStage =
  | "paper"
  | "awaiting_credit"
  | "credit_refused"
  | "awaiting_login"
  | "awaiting_activation"
  | "live"
  | "deactivated"
  | "declined";

export type DealerOnboardingRow = {
  dealer_id: string;
  dealer_name: string;
  region: string | null;
  state: string | null;
  dealer_status: "active" | "inactive" | "suspended";
  sales_rep_id: string | null;
  rep_name: string;
  credit_limit: number | string;
  credit_limit_override: number | string | null;
  gstin: string | null;
  pan: string | null;
  credit_limit_requested: number | string | null;
  credit_decided_at: string | null;
  credit_decided_by: string | null;
  credit_decided_by_name: string;
  credit_approved: boolean | null;
  credit_decision_note: string | null;
  login_user_id: string | null;
  login_provisioned_at: string | null;
  login_email: string | null;
  activated_at: string | null;
  activated_by: string | null;
  declined_at: string | null;
  declined_by: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
  stage: DealerOnboardingStage;
  outstanding: string[] | null;
};

// public.dealer_onboarding_board, not the dealer_onboardings table. The board
// derives the stage, so reading the table would leave the screen with no stage at
// all and no honest way to invent one.
//
// A dealer with no onboarding record is absent from here, and that is correct
// rather than a gap: it means the account has been trading since before
// onboarding existed, which is read from the dealer master instead.
export async function getDealerOnboardings() {
  const supabase = await createClient();
  const rows = await fetchAll<DealerOnboardingRow>((from, to) =>
    supabase
      .from("dealer_onboarding_board")
      .select("*")
      .order("dealer_name")
      .order("dealer_id")
      .range(from, to),
  );
  return rows;
}
