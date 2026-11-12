"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function EmployeeOnboardingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [docPaths, setDocPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File, kind: string) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const res = await fetch("/api/employees/upload", { method: "POST", body: fd });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) throw new Error(json.error ?? "Upload failed");
    return json.data.path as string;
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { setPhotoPath(await uploadFile(f, "photo")); } catch (err: any) { setMessage(err.message); setFailed(true); }
  }

  async function onDocChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      try { const p = await uploadFile(f, "document"); setDocPaths((prev) => [...prev, p]); } catch (err: any) { setMessage(err.message); setFailed(true); }
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, any> = {};
    for (const [k, v] of fd.entries()) body[k] = v === "" ? null : v;
    body.photo_path = photoPath;
    body.leave_quota = Number(body.leave_quota || 0);
    body.leave_quota_after_probation = body.leave_quota_after_probation ? Number(body.leave_quota_after_probation) : null;
    body.probation_months = body.probation_months ? Number(body.probation_months) : null;
    body.salary = body.salary ? Number(body.salary) : null;
    const res = await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage("Employee created.");
    e.currentTarget.reset();
    setPhotoPath(null);
    setDocPaths([]);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm font-semibold text-[#334536]">Personal details</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">Full name <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="full_name" required /></label>
        <label className="text-sm font-semibold text-[#334536]">Department <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="department" /></label>
        <label className="text-sm font-semibold text-[#334536]">Designation <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="designation" /></label>
        <label className="text-sm font-semibold text-[#334536]">Join date <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="join_date" type="date" /></label>
        <label className="text-sm font-semibold text-[#334536]">Salary <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="salary" type="number" /></label>
        <label className="text-sm font-semibold text-[#334536]">Status <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>

      <p className="text-sm font-semibold text-[#334536]">Identity</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">Aadhaar (12 digits) <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="aadhaar_number" /></label>
        <label className="text-sm font-semibold text-[#334536]">PAN (AAAAA0000A) <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="pan_number" /></label>
      </div>

      <p className="text-sm font-semibold text-[#334536]">Bank details</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">Bank name <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="bank_name" /></label>
        <label className="text-sm font-semibold text-[#334536]">Account number <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="bank_account_number" /></label>
        <label className="text-sm font-semibold text-[#334536]">IFSC <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="bank_ifsc" /></label>
      </div>

      <p className="text-sm font-semibold text-[#334536]">Address</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">Address line 1 <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="address_line1" /></label>
        <label className="text-sm font-semibold text-[#334536]">Address line 2 <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="address_line2" /></label>
        <label className="text-sm font-semibold text-[#334536]">City <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="city" /></label>
        <label className="text-sm font-semibold text-[#334536]">State <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="state" /></label>
        <label className="text-sm font-semibold text-[#334536]">Postal code <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="postal_code" /></label>
      </div>

      <p className="text-sm font-semibold text-[#334536]">Employment</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Employment type
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="employment_type">
            <option value="permanent">Permanent</option>
            <option value="probation">Probation</option>
            <option value="contract">Contract</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">Probation months <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="probation_months" type="number" /></label>
        <label className="text-sm font-semibold text-[#334536]">Probation end date <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="probation_end_date" type="date" /></label>
        <label className="text-sm font-semibold text-[#334536]">Leave quota <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="leave_quota" type="number" defaultValue="0" /></label>
        <label className="text-sm font-semibold text-[#334536]">Leave quota after probation <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="leave_quota_after_probation" type="number" /></label>
        <label className="text-sm font-semibold text-[#334536]">Notes <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="notes" /></label>
      </div>

      <p className="text-sm font-semibold text-[#334536]">Photo &amp; documents</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Photo
          <input className="mt-2 w-full text-sm" type="file" accept="image/*" onChange={onPhotoChange} />
          {photoPath ? <span className="mt-1 block text-xs text-[#4e741d]">Uploaded: {photoPath}</span> : null}
          {uploading ? <span className="mt-1 block text-xs text-[#718075]">Uploading…</span> : null}
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Documents (Aadhaar, PAN, etc.)
          <input className="mt-2 w-full text-sm" type="file" multiple onChange={onDocChange} />
          {docPaths.length ? <ul className="mt-1 text-xs text-[#4e741d]">{docPaths.map((p) => <li key={p}>{p}</li>)}</ul> : null}
        </label>
      </div>

      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading || uploading} type="submit">
        {loading ? "Saving…" : "Create employee"}
      </button>
    </form>
  );
}
