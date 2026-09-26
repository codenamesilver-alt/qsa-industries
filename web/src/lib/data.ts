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
  source: "production" | "sales" | "adjustment";
  reason: string | null;
  created_at: string;
  product?: { name: string; sku: string } | null;
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
