import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { MODULES } from "../../../lib/modules-config";
import Link from "next/link";

const roles = ["admin"] as const;

const CATEGORY: Record<string, string> = {
  suppliers: "Master Data", "product-variants": "Master Data", "product-uom": "Master Data", "product-barcodes": "Master Data",
  "tax-groups": "Master Data", "product-images": "Master Data", "category-hierarchy": "Master Data",
  "reorder-rules": "Inventory & Warehouse", "serial-numbers": "Inventory & Warehouse", "stock-reservations": "Inventory & Warehouse",
  "stock-transfers": "Inventory & Warehouse", "quarantine-stock": "Inventory & Warehouse", "cycle-counts": "Inventory & Warehouse",
  "uom-conversions": "Inventory & Warehouse", "safety-stock": "Inventory & Warehouse", "batch-genealogy": "Inventory & Warehouse",
  "work-centers": "Production & Quality", routings: "Production & Quality", "work-orders": "Production & Quality",
  "wip-tracking": "Production & Quality", "scrap-records": "Production & Quality", "bom-versions": "Production & Quality",
  "quality-inspections": "Production & Quality", "sampling-plans": "Production & Quality", coa: "Production & Quality",
  ncr: "Production & Quality", capa: "Production & Quality", deviations: "Production & Quality",
  "calibration-records": "Production & Quality", "test-methods": "Production & Quality", "mrp-runs": "Production & Quality",
  "purchase-requisitions": "Procurement", rfq: "Procurement", grn: "Procurement", "three-way-match": "Procurement",
  "ap-payments": "Procurement", "landed-costs": "Procurement", "blanket-pos": "Procurement", "supplier-returns": "Procurement",
  "gl-accounts": "Finance & Accounting", "journal-entries": "Finance & Accounting", "payment-terms": "Finance & Accounting",
  dunning: "Finance & Accounting", "write-offs": "Finance & Accounting", currencies: "Finance & Accounting",
  "exchange-rates": "Finance & Accounting", budgets: "Finance & Accounting", "cost-centers": "Finance & Accounting",
  depreciation: "Finance & Accounting", "cheque-management": "Finance & Accounting", "expense-approvals": "Finance & Accounting",
  "tally-config": "Finance & Accounting", "invoice-cancellations": "Finance & Accounting", refunds: "Finance & Accounting",
  shifts: "HR & Payroll", "holiday-calendar": "HR & Payroll", "leave-types": "HR & Payroll", "leave-balances": "HR & Payroll",
  "payroll-components": "HR & Payroll", "salary-structures": "HR & Payroll", "tax-declarations": "HR & Payroll",
  recruitment: "HR & Payroll", training: "HR & Payroll", "exit-records": "HR & Payroll",
  shipments: "Logistics & Delivery", "pick-pack": "Logistics & Delivery", vehicles: "Logistics & Delivery",
  "route-plans": "Logistics & Delivery", "freight-costs": "Logistics & Delivery", returns: "Logistics & Delivery",
  campaigns: "Sales & CRM", "lead-activities": "Sales & CRM",
  "global-search-index": "Platform / Admin", "document-folders": "Platform / Admin", documents: "Platform / Admin",
  "notification-channels": "Platform / Admin", "notification-templates": "Platform / Admin", workflows: "Platform / Admin",
  sessions: "Platform / Admin", "password-resets": "Platform / Admin", "user-preferences": "Platform / Admin",
  "audit-diff": "Platform / Admin", "scheduled-reports": "Platform / Admin", "kpi-snapshots": "Platform / Admin",
};

const CATEGORY_ORDER = [
  "Master Data", "Inventory & Warehouse", "Production & Quality", "Procurement",
  "Finance & Accounting", "HR & Payroll", "Logistics & Delivery", "Sales & CRM", "Platform / Admin",
];

export default async function ModulesHubPage() {
  const profile = await requireProfile(roles);
  const grouped: Record<string, typeof MODULES> = {};
  for (const m of MODULES) {
    const cat = CATEGORY[m.slug] || "Other";
    (grouped[cat] ||= []).push(m);
  }

  return (
    <PortalShell description="All extended modules grouped by category." eyebrow="Internal operations / modules" highlights={["Modules grouped by category for easy navigation."]} profile={profile} title="Modules hub">
      <div className="space-y-8">
        {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 text-lg font-semibold text-[#27312d]">{cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[cat].sort((a, b) => a.title.localeCompare(b.title)).map((m) => (
                <Link className="rounded-2xl border border-[#dfe6dc] bg-white p-4 text-sm font-semibold text-[#27312d] shadow-[var(--raised-sm)] transition hover:border-[#9db56a]" href={`/internal/modules/${m.slug}`} key={m.slug}>
                  {m.title}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PortalShell>
  );
}
