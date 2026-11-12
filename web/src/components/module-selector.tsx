"use client";

import { useEffect, useState } from "react";
import { MODULES } from "../lib/modules-config";

type Designation = { id: string; name: string };

export function ModuleSelector() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [designationId, setDesignationId] = useState("");
  const [states, setStates] = useState<Record<string, "on" | "off">>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/designations");
      const json = await res.json();
      const list = json?.data ?? [];
      setDesignations(list);
      if (list.length) setDesignationId(list[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!designationId) return;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/designation-permissions?designation_id=${designationId}`);
      const json = await res.json();
      const map: Record<string, "on" | "off"> = {};
      for (const m of MODULES) map[m.slug] = "off";
      for (const row of json?.data ?? []) {
        map[row.module_key] = row.permission === "on" ? "on" : "off";
      }
      setStates(map);
      setLoading(false);
    })();
  }, [designationId]);

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const permissions = MODULES.map((m) => ({
      module_key: m.slug,
      permission: states[m.slug] ?? "off",
    }));
    const res = await fetch("/api/designation-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designation_id: designationId, permissions }),
    });
    const json = await res.json();
    setSaving(false);
    if (json?.error) setMessage("Save failed: " + json.error);
    else setMessage("Saved successfully.");
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-bold text-[#15221b]">Designation</label>
        <select
          className="mt-1 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm"
          value={designationId}
          onChange={(e) => setDesignationId(e.target.value)}
        >
          {designations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-[#718075]">Loading modules...</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[#e8ede6]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#f5f7f2] text-xs uppercase tracking-[0.16em] text-[#819083]">
              <tr>
                <th className="px-3 py-2 font-bold">Module</th>
                <th className="px-3 py-2 font-bold">On</th>
                <th className="px-3 py-2 font-bold">Off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ede6]">
              {MODULES.map((m) => (
                <tr key={m.slug}>
                  <td className="px-3 py-2 font-semibold text-[#15221b]">{m.title}</td>
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name={m.slug}
                      checked={states[m.slug] === "on"}
                      onChange={() => setStates((s) => ({ ...s, [m.slug]: "on" }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name={m.slug}
                      checked={states[m.slug] === "off"}
                      onChange={() => setStates((s) => ({ ...s, [m.slug]: "off" }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          className="rounded-full bg-[#7bb51d] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          disabled={saving || !designationId}
          onClick={handleSave}
          type="button"
        >
          {saving ? "Saving..." : "Save module selection"}
        </button>
        {message ? <span className="text-sm text-[#4f6254]">{message}</span> : null}
      </div>
    </div>
  );
}