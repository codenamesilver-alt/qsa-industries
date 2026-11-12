import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const mapping = {
  "admin-dealer-form.tsx": "02-admin-dealers",
  "admin-price-list-form.tsx": "04-price-lists",
  "admin-product-form.tsx": "01-admin-products",
  "admin-user-form.tsx": "03-admin-users",
  "batch-receive-form.tsx": "11-batch-receive",
  "dealer-assignment-form.tsx": "16-dealer-assignment",
  "dealer-credit-form.tsx": "15-dealer-credit",
  "dealer-onboarding-form.tsx": "17-dealer-onboarding",
  "designation-manager.tsx": "20-designations",
  "expense-actions.tsx": "22-expenses",
  "finance-settings-form.tsx": "21-finance-settings",
  "order-checkout-form.tsx": "05-orders-checkout",
  "order-edit-form.tsx": "06-orders-edit",
  "org-chart-builder.tsx": "18-org-chart",
  "org-people-builder.tsx": "19-org-people",
  "production-qc-actions.tsx": "09-production-qc",
  "production-run-form.tsx": "08-production-runs",
  "proxy-order-form.tsx": "07-proxy-orders",
  "purchase-order-form.tsx": "12-purchase-orders",
  "purchase-order-receive-form.tsx": "13-po-receive",
  "delivery-confirm-form.tsx": "14-delivery-confirm",
  "stock-adjustment-form.tsx": "10-stock-adjustment",
  "staff-login-form.tsx": "24-staff-login",
  "super-admin-form.tsx": "25-super-admin",
  "finance-actions.tsx": "23-tally-export",
};

const dir = join(process.cwd(), "src", "components");

for (const [file, guide] of Object.entries(mapping)) {
  const path = join(dir, file);
  let src = readFileSync(path, "utf8");

  // add import if missing
  if (!src.includes('from "./pdf-help"')) {
    // insert after last import line
    const importRegex = /^import .*;$/gm;
    let lastImportIndex = -1;
    let m;
    while ((m = importRegex.exec(src)) !== null) {
      lastImportIndex = m.index + m[0].length;
    }
    if (lastImportIndex !== -1) {
      src = src.slice(0, lastImportIndex) + '\nimport { PdfHelp } from "./pdf-help";' + src.slice(lastImportIndex);
    }
  }

  // insert PdfHelp after first <form ...> opening tag if not already
  if (!src.includes(`guide="${guide}"`)) {
    const formMatch = src.match(/<form[^>]*>/);
    if (formMatch) {
      const idx = formMatch.index + formMatch[0].length;
      const insert = `\n      <div className="flex justify-end"><PdfHelp guide="${guide}" /></div>`;
      src = src.slice(0, idx) + insert + src.slice(idx);
    }
  }

  writeFileSync(path, src, "utf8");
  console.log("updated", file);
}
console.log("DONE");
