import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const rolesByRoute = {
  "admin/dealers/route.ts": ["admin"],
  "admin/products/route.ts": ["admin"],
  "admin/users/route.ts": ["admin"],
  "batches/receive/route.ts": ["admin", "production_manager", "inventory_manager"],
  "dealer-assignment/route.ts": ["admin", "sales_rep", "sales_manager", "sales_director"],
  "dealer-catalog/[id]/route.ts": ["dealer", "admin", "sales_rep", "sales_manager", "sales_director"],
  "dealer-login/provision/route.ts": ["admin"],
  "dealer-onboarding/route.ts": ["admin"],
  "dealers/[id]/credit/route.ts": ["admin", "finance"],
  "designations/route.ts": ["admin"],
  "expenses/route.ts": ["admin", "finance"],
  "expenses/heads/route.ts": ["admin", "finance"],
  "expenses/[id]/void/route.ts": ["admin", "finance"],
  "finance/dealer-payment/route.ts": ["admin", "finance"],
  "finance/generate-invoice/route.ts": ["admin", "finance"],
  "finance/invoice-payment/route.ts": ["admin", "finance"],
  "finance/settings/route.ts": ["admin", "finance"],
  "invoices/manual/route.ts": ["admin", "finance"],
  "orders/route.ts": ["dealer", "admin", "sales_rep"],
  "orders/manual/route.ts": ["admin", "sales_rep", "sales_manager", "sales_director"],
  "orders/[id]/actions/route.ts": ["admin", "sales_rep", "sales_manager", "sales_director", "logistics"],
  "orders/[id]/deliver/route.ts": ["admin", "logistics"],
  "orders/[id]/edit/route.ts": ["admin", "sales_rep"],
  "org/route.ts": ["admin"],
  "price-lists/route.ts": ["admin"],
  "production/qc/route.ts": ["admin", "production_manager", "qc_staff"],
  "production/runs/route.ts": ["admin", "production_manager"],
  "purchase-orders/route.ts": ["admin", "inventory_manager", "production_manager"],
  "purchase-orders/[id]/receive/route.ts": ["admin", "inventory_manager", "production_manager"],
  "reports/export/route.ts": ["admin", "finance", "sales_director", "sales_manager"],
  "stock/adjust/route.ts": ["admin", "inventory_manager", "production_manager"],
  "tally/export/route.ts": ["admin", "finance"],
};

const base = join(process.cwd(), "src", "app", "api");

for (const [rel, roles] of Object.entries(rolesByRoute)) {
  const path = join(base, rel);
  let src = readFileSync(path, "utf8");

  // Update imports: ensure getProfile and admitsRole available
  if (!src.includes("getProfile")) {
    src = src.replace(/from "@\/lib\/auth"/, 'from "@/lib/auth"');
  }
  // Replace import of getSessionUserId with getProfile + admitsRole
  src = src.replace(
    /import \{ getSessionUserId \} from "@\/lib\/auth";/,
    'import { getProfile, admitsRole } from "@/lib/auth";',
  );
  // If auth import has other things, add admitsRole/getProfile if missing
  if (src.includes('from "@/lib/auth"') && !src.includes("getProfile")) {
    src = src.replace(/import \{ ([^}]+) \} from "@\/lib\/auth";/, (m, g) => {
      const parts = g.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.includes("getProfile")) parts.unshift("getProfile");
      if (!parts.includes("admitsRole")) parts.push("admitsRole");
      return `import { ${parts.join(", ")} } from "@/lib/auth";`;
    });
  }
  if (src.includes('from "@/lib/auth"') && !src.includes("admitsRole")) {
    src = src.replace(/import \{ ([^}]+) \} from "@\/lib\/auth";/, (m, g) => {
      const parts = g.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.includes("admitsRole")) parts.push("admitsRole");
      return `import { ${parts.join(", ")} } from "@/lib/auth";`;
    });
  }

  const rolesLiteral = JSON.stringify(roles).replace(/"/g, '"');

  // Replace the standard auth guard pattern
  const pattern = /const userId = await getSessionUserId\(\);\s*\n\s*if \(!userId\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/;
  if (pattern.test(src)) {
    src = src.replace(
      pattern,
      `const profile = await getProfile();\n  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });\n  if (!admitsRole(profile.role, ${rolesLiteral.replace(/"/g, "'")} as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });\n  const userId = profile.id;`,
    );
  }

  writeFileSync(path, src, "utf8");
  console.log("hardened", rel);
}
console.log("DONE");
