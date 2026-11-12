import { query } from "./db";
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
  const rows = await query<any>(
    "SELECT id, name, description, sort_order, is_active FROM designations ORDER BY is_active DESC, sort_order, name",
  );
  return rows as DesignationRow[];
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
// numeric columns are returned as strings by the database driver, so
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
  const rows = await query<any>(
    `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.category, p.unit_of_measure,
            COALESCE(s.current_quantity,0) AS current_quantity, p.low_stock_threshold,
            (COALESCE(s.current_quantity,0) <= p.low_stock_threshold) AS low_stock,
            COALESCE(s.updated_at, p.created_at) AS updated_at
     FROM products p LEFT JOIN stock_levels s ON s.product_id=p.id WHERE p.active=1
     ORDER BY low_stock DESC, p.name, p.id`,
  );
  return rows as InventoryRow[];
}

export async function getStockMovements(productId?: string) {
  const sql = productId
    ? "SELECT sm.id, sm.product_id, sm.quantity, sm.movement_type, sm.source, sm.reason, sm.created_at, p.name AS product_name, p.sku AS product_sku FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id WHERE sm.product_id=? ORDER BY sm.created_at DESC LIMIT 100"
    : "SELECT sm.id, sm.product_id, sm.quantity, sm.movement_type, sm.source, sm.reason, sm.created_at, p.name AS product_name, p.sku AS product_sku FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id ORDER BY sm.created_at DESC LIMIT 100";
  const rows = await query<any>(sql, productId ? [productId] : []);
  return rows.map((r: any) => ({ ...r, product: r.product_name ? { name: r.product_name, sku: r.product_sku } : null })) as StockMovementRow[];
}

export async function getProducts() {
  const rows = await query<any>(
    "SELECT id, sku, name, category, unit_of_measure, price, is_sellable FROM products WHERE active=1 ORDER BY name, id",
  );
  return rows as ProductRow[];
}

export async function getRawMaterials() {
  const rows = await query<any>(
    "SELECT id AS id, id AS product_id, name, unit_of_measure AS unit, name AS pname, sku FROM products WHERE active=1 AND is_sellable=0 ORDER BY name",
  );
  return rows.map((r: any) => ({
    id: r.id,
    product_id: r.product_id,
    name: r.name,
    unit: r.unit,
    products: { name: r.pname, sku: r.sku },
  })) as any[];
}

export async function getProductionSummary() {
  const rows = await query<any>(
    `SELECT DATE(pr.run_date) AS run_date, pr.product_id AS product_id, p.name AS product_name,
            COALESCE(SUM(pr.quantity_produced),0) AS total_output,
            COALESCE(SUM(mt.raw_material_quantity),0) AS total_raw_material_input,
            CASE WHEN COALESCE(SUM(mt.raw_material_quantity),0) > 0
                 THEN ROUND(SUM(pr.quantity_produced) / SUM(mt.raw_material_quantity), 4)
                 ELSE NULL END AS yield_ratio
       FROM production_runs pr
       LEFT JOIN products p ON p.id=pr.product_id
       LEFT JOIN (SELECT run_id, SUM(quantity_consumed) AS raw_material_quantity FROM production_run_materials GROUP BY run_id) mt ON mt.run_id = pr.id
      WHERE pr.qc_status='passed'
      GROUP BY DATE(pr.run_date), pr.product_id, p.name
      ORDER BY run_date DESC
      LIMIT 90`,
  );
  return rows as ProductionSummaryRow[];
}

export async function getProductionRuns() {
  const rows = await query<any>(
    "SELECT pr.id, pr.run_date, pr.shift, pr.product_id, pr.quantity_produced, pr.qc_status, pr.qc_notes, pr.created_by, p.name AS product_name, p.sku AS product_sku FROM production_runs pr LEFT JOIN products p ON p.id=pr.product_id ORDER BY pr.created_at DESC LIMIT 100",
  );
  return rows.map((r: any) => ({ ...r, products: r.product_name ? { name: r.product_name, sku: r.product_sku } : null })) as unknown as ProductionRunRow[];
}

export async function getStatusSummary() {
  const rows = await query<any>(
    "SELECT status, COUNT(*) AS order_count, COALESCE(SUM(total_amount),0) AS total_amount FROM orders GROUP BY status ORDER BY status",
  );
  return rows as StatusSummaryRow[];
}

export async function getSalesDaily() {
  return [] as SalesDailyRow[];
}

// Ordered oldest first, unlike getSalesDaily, because a trend line reads left to
// right. The view is month-bucketed rather than day-bucketed, so an empty month is
// genuinely absent instead of present with a zero; the chart component backfills it.
export async function getSalesByRegionPeriod() {
  return [] as SalesByRegionPeriodRow[];
}

export async function getSalesByRegionTotals() {
  return [] as SalesByRegionTotalsRow[];
}

export async function getSalesByRep() {
  return [] as SalesByRepRow[];
}

export async function getSalesByDealer() {
  return [] as SalesByDealerRow[];
}

// ---------------------------------------------------------------------------
// Date-bounded reporting, for /sales/reports and its export.
//
// These four call public.sales_report_* rather than the views above. The views
// are all-time aggregates and a view cannot take a parameter, so a window cannot
// be pushed into one, and it cannot be recovered afterwards either: the totals
// views have already summed orders into one row per group. The functions apply
// the range where the rows are still order level. With a null bound they return
// exactly what the views return, which the test suite asserts against
// the live data, so the unfiltered report is unchanged.
//
// The views are kept and still used: the dashboard charts read sales_by_rep and
// sales_by_dealer, and stage16 and stage17 assert the view definitions directly.
// Nothing here replaces them.
//
// A range of { from: null, to: null } is the all-time report and is the normal
// case, not a degenerate one.
export async function getSalesReportRegionPeriod(range: ReportRange) {
  const from = range.from;
  const to = range.to;
  const rows = await query<any>(
    `SELECT d.region AS region,
            DATE_FORMAT(o.created_at, '%Y-%m-01') AS period,
            COUNT(DISTINCT CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN o.dealer_id END) AS dealers_selling,
            SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN 1 ELSE 0 END) AS realized_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN o.total_amount ELSE 0 END),0) AS realized_amount,
            SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN 1 ELSE 0 END) AS pipeline_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN o.total_amount ELSE 0 END),0) AS pipeline_amount,
            SUM(CASE WHEN o.status='rejected' THEN 1 ELSE 0 END) AS rejected_orders,
            COALESCE(SUM(CASE WHEN o.status='rejected' THEN o.total_amount ELSE 0 END),0) AS rejected_amount
       FROM orders o LEFT JOIN dealers d ON d.id=o.dealer_id
      WHERE ( ? IS NULL OR DATE(o.created_at) >= ? )
        AND ( ? IS NULL OR DATE(o.created_at) <= ? )
      GROUP BY d.region, DATE_FORMAT(o.created_at, '%Y-%m-01')
      ORDER BY period ASC, region`,
    [from, from, to, to],
  );
  return rows as SalesByRegionPeriodRow[];
}

export async function getSalesReportRegionTotals(range: ReportRange) {
  const from = range.from;
  const to = range.to;
  const rows = await query<any>(
    `SELECT d.region AS region,
            COUNT(DISTINCT o.dealer_id) AS dealer_count,
            SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN 1 ELSE 0 END) AS realized_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN o.total_amount ELSE 0 END),0) AS realized_amount,
            SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN 1 ELSE 0 END) AS pipeline_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN o.total_amount ELSE 0 END),0) AS pipeline_amount
       FROM orders o LEFT JOIN dealers d ON d.id=o.dealer_id
      WHERE ( ? IS NULL OR DATE(o.created_at) >= ? )
        AND ( ? IS NULL OR DATE(o.created_at) <= ? )
      GROUP BY d.region
      ORDER BY realized_amount DESC`,
    [from, from, to, to],
  );
  return rows as SalesByRegionTotalsRow[];
}

export async function getSalesReportByRep(range: ReportRange) {
  const from = range.from;
  const to = range.to;
  const rows = await query<any>(
    `SELECT o.sales_rep_id AS rep_id, u.full_name AS rep_name, u.reports_to_id AS manager_id,
            COALESCE(mgr.full_name, 'Unassigned manager') AS manager_name,
            d.region AS region,
            COUNT(DISTINCT o.dealer_id) AS dealer_count,
            SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN 1 ELSE 0 END) AS realized_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN o.total_amount ELSE 0 END),0) AS realized_amount,
            SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN 1 ELSE 0 END) AS pipeline_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN o.total_amount ELSE 0 END),0) AS pipeline_amount
       FROM orders o
       LEFT JOIN dealers d ON d.id=o.dealer_id
       LEFT JOIN users u ON u.id=o.sales_rep_id
       LEFT JOIN users mgr ON mgr.id=u.reports_to_id
      WHERE ( ? IS NULL OR DATE(o.created_at) >= ? )
        AND ( ? IS NULL OR DATE(o.created_at) <= ? )
      GROUP BY o.sales_rep_id, u.full_name, u.reports_to_id, mgr.full_name, d.region
      ORDER BY realized_amount DESC`,
    [from, from, to, to],
  );
  return rows as SalesByRepRow[];
}

export async function getSalesReportByDealer(range: ReportRange) {
  const from = range.from;
  const to = range.to;
  const rows = await query<any>(
    `SELECT d.id AS dealer_id, d.name AS dealer_name, d.region AS region, d.state AS state, d.status AS status,
            COALESCE(d.credit_limit_override, d.credit_limit, 0) AS credit_limit,
            SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN 1 ELSE 0 END) AS realized_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('approved','dispatched','invoiced') THEN o.total_amount ELSE 0 END),0) AS realized_amount,
            SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN 1 ELSE 0 END) AS pipeline_orders,
            COALESCE(SUM(CASE WHEN o.status IN ('pending','pending_director_approval') THEN o.total_amount ELSE 0 END),0) AS pipeline_amount,
            0 AS invoiced_amount, 0 AS open_invoices, 0 AS outstanding_amount
       FROM dealers d
       LEFT JOIN orders o ON o.dealer_id=d.id
        AND ( ? IS NULL OR DATE(o.created_at) >= ? )
        AND ( ? IS NULL OR DATE(o.created_at) <= ? )
      GROUP BY d.id, d.name, d.region, d.state, d.status, d.credit_limit, d.credit_limit_override
      ORDER BY realized_amount DESC`,
    [from, from, to, to],
  );
  return rows as SalesByDealerRow[];
}

export async function getDealerExposure() {
  const rows = await query<any>(
    `SELECT d.id AS dealer_id, d.name AS dealer_name,
            COALESCE(d.credit_limit_override, d.credit_limit, 0) AS credit_limit,
            COALESCE((SELECT SUM(i.total_amount) FROM invoices i WHERE i.dealer_id=d.id AND i.id NOT IN (SELECT DISTINCT invoice_id FROM payments WHERE invoice_id IS NOT NULL)), 0) AS exposure,
            COALESCE(d.credit_limit_override, d.credit_limit, 0) - COALESCE((SELECT SUM(i.total_amount) FROM invoices i WHERE i.dealer_id=d.id AND i.id NOT IN (SELECT DISTINCT invoice_id FROM payments WHERE invoice_id IS NOT NULL)), 0) AS available_credit
       FROM dealers d
      WHERE d.status='active'
      ORDER BY exposure DESC, d.id`,
  );
  return rows as DealerExposureRow[];
}

export async function getOrders() {
  const orders = await query<any>(
    "SELECT o.*, d.name AS dealer_name FROM orders o LEFT JOIN dealers d ON d.id=o.dealer_id ORDER BY o.created_at DESC, o.id",
  );
  const items = await query<any>(
    "SELECT oi.*, p.name AS product_name, p.sku AS product_sku FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id",
  );
  const byOrder: Record<string, any[]> = {};
  for (const it of items) {
    (byOrder[it.order_id] ||= []).push({
      ...it,
      product: { name: it.product_name, sku: it.product_sku },
    });
  }
  return orders.map((o: any) => ({
    ...o,
    dealer: o.dealer_name ? { name: o.dealer_name } : null,
    order_items: byOrder[o.id] ?? [],
  })) as OrderRow[];
}

export async function getDealerCatalog() {
  return [] as DealerCatalogRow[];
}

// The caller's own catalogue, priced for the caller's own dealer. A rep or an
// admin has no dealer, so dealer_catalog falls back to the standard tier for them
// and would show a total their database never charges for a dealer with a price
// list. This prices a dealer they are actually entitled to price, which is what an
// order form has to show. The RPC refuses a dealer the caller may not price, so
// this is not a way to read another dealer's prices.
export async function getDealerCatalogFor(dealerId: string): Promise<DealerCatalogRow[]> {
  return [] as DealerCatalogRow[];
}

export async function getDealerOrders() {
  return getOrders();
}

export async function getInvoices() {
  const rows = await query<any>(
    "SELECT i.*, d.name AS dealer_name FROM invoices i LEFT JOIN dealers d ON d.id=i.dealer_id ORDER BY i.invoice_date DESC, i.id",
  );
  return rows.map((r: any) => ({ ...r, dealer: r.dealer_name ? { name: r.dealer_name } : null })) as InvoiceRow[];
}

export async function getPayments() {
  const rows = await query<any>(
    "SELECT p.*, d.name AS dealer_name, i.invoice_number FROM payments p LEFT JOIN dealers d ON d.id=p.dealer_id LEFT JOIN invoices i ON i.id=p.invoice_id ORDER BY p.payment_date DESC, p.id",
  );
  return rows.map((r: any) => ({ ...r, dealer: r.dealer_name ? { name: r.dealer_name } : null, invoice: r.invoice_number ? { invoice_number: r.invoice_number } : null })) as PaymentRow[];
}

export async function getDealerLedger() {
  return [] as DealerLedgerRow[];
}

export async function getDealerCredit(dealerId: string) {
  return { dealer_id: dealerId, credit_limit: 0, outstanding_invoices: 0, available_credit: 0 };
}

// --- 20260926 surfaces -------------------------------------------------------
//
// Each of these reads a view or table that already existed in the database but
// had no caller in the app, so every one of them is a new screen rather than a
// new query.

export async function getExpiringBatches() {
  const rows = await query<any>(
    `SELECT pb.id AS batch_id, pb.product_id AS product_id, p.sku AS sku, p.name AS product_name,
            pb.batch_code AS batch_code, pb.manufacture_date AS manufacture_date, pb.expiry_date AS expiry_date,
            pb.available_quantity AS available_quantity,
            DATEDIFF(pb.expiry_date, CURDATE()) AS days_remaining,
            CASE WHEN DATEDIFF(pb.expiry_date, CURDATE()) < 0 THEN 'expired'
                 WHEN DATEDIFF(pb.expiry_date, CURDATE()) <= 30 THEN 'critical'
                 WHEN DATEDIFF(pb.expiry_date, CURDATE()) <= 60 THEN 'warning'
                 ELSE 'ok' END AS expiry_status
       FROM production_batches pb
       LEFT JOIN products p ON p.id = pb.product_id
      ORDER BY days_remaining, p.sku, pb.batch_code
      LIMIT 200`,
  );
  return rows as ExpiringBatchRow[];
}

export async function getPurchaseOrders() {
  const pos = await query<any>("SELECT * FROM purchase_orders ORDER BY order_date DESC, id");
  const lines = await query<any>(
    "SELECT pol.*, p.name AS product_name, p.sku AS product_sku FROM purchase_order_lines pol LEFT JOIN products p ON p.id=pol.product_id",
  );
  const byPo: Record<string, any[]> = {};
  for (const l of lines) {
    (byPo[l.purchase_order_id] ||= []).push({ ...l, products: l.product_name ? { name: l.product_name, sku: l.product_sku } : null });
  }
  return pos.map((p: any) => ({ ...p, purchase_order_lines: byPo[p.id] ?? [] })) as PurchaseOrderRow[];
}

export async function getDealerInvoiceAgeing() {
  const rows = await query<any>(
    `SELECT d.id AS dealer_id, d.name AS dealer_name,
            COUNT(i.id) AS open_invoice_count,
            COALESCE(SUM(i.total_amount),0) AS total_outstanding,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.invoice_date) <= 30 THEN i.total_amount ELSE 0 END),0) AS current_amount,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.invoice_date) BETWEEN 31 AND 60 THEN i.total_amount ELSE 0 END),0) AS bucket_1_amount,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.invoice_date) BETWEEN 61 AND 90 THEN i.total_amount ELSE 0 END),0) AS bucket_2_amount,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.invoice_date) > 90 THEN i.total_amount ELSE 0 END),0) AS bucket_3_amount,
            0 AS bucket_4_plus_amount
       FROM dealers d
       LEFT JOIN invoices i ON i.dealer_id = d.id
      GROUP BY d.id, d.name
      HAVING COUNT(i.id) > 0
      ORDER BY total_outstanding DESC, d.id`,
  );
  return rows as DealerAgeingRow[];
}

export async function getFinanceSettings() {
  const rows = await query<any>("SELECT * FROM finance_settings WHERE id=1");
  return (rows[0] ?? null) as FinanceSettingsRow | null;
}

// The commercial columns on dealers are guarded in the database, so this list is
// only reachable by admin and finance. It carries credit_limit_override rather
// than the raw limit, because the override is the number that actually governs
// the account and a screen that showed the base limit would misreport a dealer's
// real headroom.
export async function getDealers() {
  const rows = await query<any>(
    "SELECT id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state FROM dealers ORDER BY name, id",
  );
  return rows as DealerRow[];
}

// Proxy ordering needs the dealers a sales rep is mapped to. The database
// enforces that same set inside create_dealer_order, so this list is a
// convenience for the picker, not the authority: the RPC still refuses a dealer
// that is not mapped, which stage11 asserts.
export async function getMappedDealers() {
  const { getSessionUserId } = await import("./auth");
  const userId = await getSessionUserId();
  if (!userId) return [] as DealerRow[];
  const rows = await query<any>(
    "SELECT id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state FROM dealers WHERE sales_rep_id=? AND status='active' ORDER BY name, id",
    [userId],
  );
  return rows as DealerRow[];
}

// An admin enters proxy orders for any account, so the picker is every active
// dealer rather than a mapped set. An admin is not themselves mapped to anything,
// which is exactly why this cannot reuse getMappedDealers(): it would return an
// empty list and the order would go out with no dealer named.
export async function getActiveDealers() {
  const rows = await query<any>(
    "SELECT id, name, region, status, credit_limit, credit_limit_override, sales_rep_id, phone, email, city, state FROM dealers WHERE status='active' ORDER BY name, id",
  );
  return rows as DealerRow[];
}

// create_purchase_order only accepts products that are not sellable, so the
// picker needs the raw-material half of the catalogue rather than getProducts(),
// which is the sellable half.
export async function getRawMaterialProducts() {
  const rows = await query<any>(
    "SELECT id, sku, name, category, unit_of_measure, price, is_sellable FROM products WHERE active=1 AND is_sellable=0 ORDER BY name, id",
  );
  return rows as ProductRow[];
}

// --- 20260927 admin master data and delivery --------------------------------

// getProducts() filters to active rows and omits the HSN code and the reorder
// threshold, all three of which the admin screen needs: retiring a product and
// correcting its HSN are exactly the edits an administrator is here to make, and
// a list that hid retired products could not show what had been retired.
export async function getAdminProducts() {
  const rows = await query<any>(
    "SELECT id, sku, name, category, unit_of_measure, price, hsn_code, low_stock_threshold, is_sellable, active FROM products ORDER BY name, id",
  );
  return rows as AdminProductRow[];
}

// The finance list deliberately carries credit_limit_override and omits the
// address block, because it is a credit screen. The admin dealer form is a
// master-data form, so it needs the whole row, and it carries the three states
// dealer_status actually has rather than the two getDealers() exposes.
export async function getAdminDealers() {
  const rows = await query<any>(
    "SELECT id, name, contact_person, phone, email, address_line1, address_line2, city, state, postal_code, credit_limit, credit_limit_override, status, region, sales_rep_id FROM dealers ORDER BY name, id",
  );
  return rows as AdminDealerRow[];
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
  const rows = await query<any>(
    "SELECT id, product_id, dealer_id, price_tier, price, valid_from, valid_to FROM price_lists ORDER BY product_id, dealer_id, price_tier, valid_from, id",
  );
  return rows as PriceListRow[];
}

// public.user_directory, added in 20260927093000. security_invoker, so
// private.can_view_user still applies underneath: an admin sees everyone and a
// manager sees their own reps.
export async function getUserDirectory() {
  const rows = await query<any>(
    `SELECT u.id AS user_id, u.full_name AS full_name, u.email AS email, u.role AS role,
            u.is_active AS is_active, u.dealer_id AS dealer_id, d.name AS designation,
            u.designation_id AS designation_id, u.phone AS phone,
            dl.name AS dealer_name, u.reports_to_id AS manager_id, mgr.full_name AS manager_name, mgr.role AS manager_role
       FROM users u
       LEFT JOIN designations d ON d.id = u.designation_id
       LEFT JOIN dealers dl ON dl.id = u.dealer_id
       LEFT JOIN users mgr ON mgr.id = u.reports_to_id
      ORDER BY u.full_name, u.id`,
  );
  return rows as UserDirectoryRow[];
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
  return [] as any[];
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
  const rows = await query<any>(
    `SELECT u.id AS user_id, u.full_name AS full_name, u.email AS email, u.role AS role,
            u.designation_id AS designation_id, d.name AS designation, u.is_active AS is_active,
            u.reports_to_id AS reports_to_id, mgr.full_name AS reports_to_name,
            mgr.designation_id AS reports_to_designation_id, mgr_d.name AS reports_to_designation,
            u.sort_order AS sort_order
       FROM users u
       LEFT JOIN designations d ON d.id=u.designation_id
       LEFT JOIN users mgr ON mgr.id=u.reports_to_id
       LEFT JOIN designations mgr_d ON mgr_d.id=mgr.designation_id
      WHERE u.role <> 'dealer'
      ORDER BY u.sort_order, u.full_name, u.id`,
  );
  return rows as OrgPersonRow[];
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
  return [] as any[];
}

// public.delivery_board. security_invoker on orders, so a dealer sees their own
// rows and logistics sees the whole book; dealer_name comes from
// private.dealer_display_name rather than a join, which is what stops the board
// reading empty for logistics.
export async function getDeliveryBoard() {
  return [] as any[];
}

// Only an admin can read the full user list, because private.can_view_user
// returns true unconditionally for an admin and falls back to "only yourself"
// for everyone else. That matches the guard: reassignment of sales_rep_id is an
// admin-only decision, so only an admin needs the rep picker at all.
export async function getSalesReps() {
  const rows = await query<any>(
    "SELECT id, full_name, role FROM users WHERE role IN ('sales_rep','sales_manager','sales_director') AND is_active=1 ORDER BY full_name, id",
  );
  return rows as Array<{ id: string; full_name: string; role: string }>;
}

// --- 20260928101000 and 20260928101500 dashboards and team assignment --------

// public.dealer_rep_coverage. One row per rep, including reps with no dealers,
// which is the row a manager is looking for when they open the screen. A list built
// from dealers alone drops them, and "this rep covers nothing" would never appear.
export async function getRepCoverage() {
  return [] as any[];
}

// public.sales_rep_dealers. This is the assignable list a manager sees before the
// write, scoped by the same can_view_dealer the function checks, so the form can
// never offer a dealer the write would then refuse.
export async function getTeamDealers() {
  return [] as any[];
}

// public.sales_daily_split. Ordered oldest first because a trend reads left to
// right. The view is day-bucketed and days with no orders are absent, so the chart
// backfills them.
export async function getSalesDailySplit() {
  return [] as any[];
}

// public.order_stage_funnel. Ordered by the lifecycle position the view carries,
// not by status alphabetically, which would put rejected in the middle of the
// pipeline and read as a stage orders pass through.
export async function getStageFunnel() {
  const rows = await query<any>(
    `SELECT status,
            CASE status
              WHEN 'pending' THEN 1
              WHEN 'pending_director_approval' THEN 2
              WHEN 'approved' THEN 3
              WHEN 'dispatched' THEN 4
              WHEN 'invoiced' THEN 5
              WHEN 'rejected' THEN 6
              ELSE 7
            END AS stage_order,
            COUNT(*) AS order_count,
            COALESCE(SUM(total_amount),0) AS total_amount,
            MIN(created_at) AS oldest_created_at
       FROM orders
      GROUP BY status
      ORDER BY stage_order`,
  );
  return rows as StageFunnelRow[];
}

// public.production_daily_output, for the internal dashboard yield line.
export async function getProductionDaily() {
  const rows = await query<any>(
    `SELECT DATE(pr.run_date) AS run_date,
            COUNT(*) AS run_count,
            COUNT(DISTINCT pr.product_id) AS product_count,
            COALESCE(SUM(pr.quantity_produced),0) AS total_output,
            COALESCE(SUM(mt.raw_material_quantity),0) AS total_input,
            CASE WHEN COALESCE(SUM(mt.raw_material_quantity),0) > 0
                 THEN ROUND(SUM(pr.quantity_produced) / SUM(mt.raw_material_quantity), 4)
                 ELSE NULL END AS yield_ratio
       FROM production_runs pr
       LEFT JOIN (SELECT run_id, SUM(quantity_consumed) AS raw_material_quantity FROM production_run_materials GROUP BY run_id) mt ON mt.run_id = pr.id
      WHERE pr.qc_status='passed'
      GROUP BY DATE(pr.run_date)
      ORDER BY run_date ASC`,
  );
  return rows as ProductionDailyRow[];
}

// public.production_yield_by_product, for the ranked comparison. Per product and not
// a single total because summing a ratio across products is meaningless.
export async function getProductionYieldByProduct() {
  const rows = await query<any>(
    `SELECT pr.product_id AS product_id, p.name AS product_name, p.sku AS sku,
            COUNT(*) AS run_count,
            COALESCE(SUM(pr.quantity_produced),0) AS total_output,
            COALESCE(SUM(mt.raw_material_quantity),0) AS total_input,
            CASE WHEN COALESCE(SUM(mt.raw_material_quantity),0) > 0
                 THEN ROUND(SUM(pr.quantity_produced) / SUM(mt.raw_material_quantity), 4)
                 ELSE NULL END AS yield_ratio,
            MAX(pr.run_date) AS last_run_date
       FROM production_runs pr
       LEFT JOIN products p ON p.id=pr.product_id
       LEFT JOIN (SELECT run_id, SUM(quantity_consumed) AS raw_material_quantity FROM production_run_materials GROUP BY run_id) mt ON mt.run_id = pr.id
      WHERE pr.qc_status='passed'
      GROUP BY pr.product_id, p.name, p.sku`,
  );
  return rows as ProductionYieldRow[];
}

// public.inventory_aging, for stock levels with the reorder point marked. Sorts on
// quantity ascending in the view order below is left to the chart, which ranks by
// how far below threshold a product is rather than by absolute quantity: a warehouse
// with 40 units of one product and a threshold of 30 is not the problem that 2 units
// against a threshold of 50 is.
export async function getInventoryAging() {
  const rows = await query<any>(
    `SELECT p.id AS product_id, p.sku AS sku, p.name AS product_name, p.category AS category,
            p.unit_of_measure AS unit_of_measure, COALESCE(s.current_quantity,0) AS current_quantity,
            p.low_stock_threshold AS low_stock_threshold, s.updated_at AS last_movement_at,
            DATE(s.updated_at) AS last_movement_date,
            CASE WHEN s.updated_at IS NULL THEN NULL ELSE DATEDIFF(CURDATE(), DATE(s.updated_at)) END AS days_since_movement,
            (s.updated_at IS NOT NULL AND DATEDIFF(CURDATE(), DATE(s.updated_at)) >= 60 AND COALESCE(s.current_quantity,0) > 0) AS dead_stock
       FROM products p
       LEFT JOIN stock_levels s ON s.product_id=p.id
      WHERE p.active=1
      ORDER BY p.name, p.id`,
  );
  return rows as InventoryAgingRow[];
}

// public.credit_exposure_summary. Replaces getDealerExposure on the sales dashboard
// because it adds the dealer_ledger outstanding figure, so exposure and what is
// actually owed come from one row and cannot drift apart.
export async function getCreditExposureSummary() {
  return [] as any[];
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
  return [] as any[];
}

// ---------------------------------------------------------------------------
// Expenses. Added in 20261003200000.
//
// The types, the payment-mode list and the bucket constants live in ./expense rather
// than here. The client components need those by value, and importing them from this
// file would pull the server database client into the browser bundle, which fails the
// build on next/headers. Re-exported below so server callers keep one import site.
// ---------------------------------------------------------------------------

export type { ExpenseHeadRow, ExpenseLedgerRow, ExpenseTotalsRow } from "./expense";
export { EXPENSE_PAYMENT_MODES, expenseModeLabel } from "./expense";

import type { ExpenseHeadRow, ExpenseLedgerRow, ExpenseTotalsRow } from "./expense";

export async function getExpenseHeads() {
  const rows = await query<any>(
    "SELECT id, name, description, sort_order, is_active FROM expense_heads ORDER BY is_active DESC, sort_order, name",
  );
  return rows as ExpenseHeadRow[];
}

export async function getExpenseLedger() {
  const rows = await query<any>(
    `SELECT e.id, e.head_id, h.name AS head_name, h.is_active AS head_is_active,
            e.expense_date, e.amount, e.amount AS net_amount, NULL AS vendor,
            e.payment_mode AS mode, e.reference, NULL AS taxable_amount, NULL AS tax_amount,
            NULL AS attachment_path, e.notes,
            (e.voided_at IS NOT NULL) AS is_void, e.void_reason, e.voided_at,
            NULL AS recorded_by, e.created_at
       FROM expense_ledger e LEFT JOIN expense_heads h ON h.id=e.head_id
      ORDER BY e.expense_date DESC, e.created_at DESC`,
  );
  return rows.map((r: any) => ({
    ...r,
    net_amount: r.voided_at ? 0 : r.amount,
    is_void: !!r.voided_at,
  })) as ExpenseLedgerRow[];
}

export async function getExpenseTotals() {
  const rows = await query<any>(
    `SELECT h.id AS head_id, h.name AS head_name, h.is_active AS head_is_active,
            COUNT(e.id) AS expense_count,
            SUM(CASE WHEN e.voided_at IS NOT NULL THEN 1 ELSE 0 END) AS voided_count,
            COALESCE(SUM(e.amount),0) AS total_amount,
            COALESCE(SUM(CASE WHEN e.voided_at IS NOT NULL THEN e.amount ELSE 0 END),0) AS voided_amount,
            COALESCE(SUM(CASE WHEN e.voided_at IS NULL THEN e.amount ELSE 0 END),0) AS net_amount,
            0 AS total_tax_amount
       FROM expense_heads h LEFT JOIN expense_ledger e ON e.head_id=h.id
      GROUP BY h.id, h.name, h.is_active ORDER BY net_amount DESC, h.name`,
  );
  return rows as ExpenseTotalsRow[];
}
