"use client";

import { useEffect, useState } from "react";
import { MODULES } from "../lib/modules-config";

const CORE_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "products", label: "Products" },
  { key: "dealers", label: "Dealers" },
  { key: "users", label: "Users & staff" },
  { key: "price-lists", label: "Price lists" },
  { key: "designations", label: "Designations" },
  { key: "departments", label: "Departments" },
  { key: "orders", label: "Sales orders" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "expenses", label: "Expenses" },
  { key: "finance-settings", label: "Finance settings" },
  { key: "production", label: "Production" },
  { key: "quality", label: "Quality / QC" },
  { key: "inventory", label: "Inventory" },
  { key: "purchasing", label: "Purchasing" },
  { key: "logistics", label: "Logistics / delivery" },
  { key: "org-chart", label: "Organization chart" },
  { key: "dealer-onboarding", label: "Dealer onboarding" },
  { key: "reports", label: "Reporting" },
  { key: "settings", label: "Settings" },
  { key: "audit-log", label: "Audit log" },
  { key: "hr", label: "HR / Employees" },
  { key: "crm", label: "CRM (leads/opps)" },
];

const ALL_MODULES = [...CORE_MODULES, ...MODULES.map((m) => ({ key: "mod-" + m.slug, label: m.title }))];

const PERMS = ["write", "read", "edit", "delete", "na"] as const;

type Desig = { id: string; name: string };

export function RolesPermissionsManager({ designations }: { designations: Desig[] }) {
  const [desigId, setDesigId] = useState(designations[0]?.id ?? "");
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!desigId) return;
    (async () => {
      const res = await fetch(`/api/designation-permissions?designation_id=${desigId}`);
      const json = await res.json();
      const map: Record<string, string> = {};
      for (const r of json.data || []) map[r.module_key] = r.permission;
      for (const m of ALL_MODULES) if (!map[m.key]) map[m.key] = "na";
      setPerms(map);
    })();
  }, [desigId]);

  async function save() {
    setSaving(true);
    setMsg("");
    const payload = {
      designation_id: desigId,
      permissions: Object.entries(perms).map(([module_key, permission]) => ({ module_key, permission })),
    };
    const res = await fetch("/api/designation-permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setMsg(json.error ?? "Failed"); return; }
    setMsg("Saved.");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-[#334536]">
          Designation
          <select className="ml-2 rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setDesigId(e.target.value)} value={desigId}>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button className="rounded-2xl bg-[#15221b] px-5 py-2 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={saving} onClick={save} type="button">
          {saving ? "Saving…" : "Save permissions"}
        </button>
        {msg ? <span className="text-sm text-[#4e741d]">{msg}</span> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
            <tr>
              <th className="pb-3 pr-4 font-bold">Module / Feature</th>
              {PERMS.map((p) => <th className="pb-3 pr-4 font-bold text-center" key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8ede6]">
            {ALL_MODULES.map((m) => (
              <tr key={m.key}>
                <td className="py-2 pr-4 font-medium">{m.label}</td>
                {PERMS.map((p) => (
                  <td className="py-2 pr-4 text-center" key={p}>
                    <input
                      checked={(perms[m.key] || "na") === p}
                      name={m.key}
                      onChange={() => setPerms((prev) => ({ ...prev, [m.key]: p }))}
                      type="radio"
                      value={p}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
