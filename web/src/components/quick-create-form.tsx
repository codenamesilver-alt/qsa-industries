"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Field = { name: string; label: string; type?: string; required?: boolean; options?: string[] };

export function QuickCreateForm({ endpoint, fields, title }: { endpoint: string; fields: Field[]; title?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, any> = {};
    for (const f of fields) {
      const v = fd.get(f.name);
      body[f.name] = v === "" ? null : v;
    }
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage("Created successfully.");
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {title ? <p className="text-sm font-semibold text-[#334536]">{title}</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((f) => (
          <label className="text-sm font-semibold text-[#334536]" key={f.name}>
            {f.label}
            {f.options ? (
              <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name={f.name} required={f.required}>
                <option value="">Select</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
                name={f.name}
                required={f.required}
                type={f.type || "text"}
              />
            )}
          </label>
        ))}
      </div>
      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
