"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";
import type { AdminDealerRow, AdminProductRow, PriceListRow } from "../lib/data";

type Props = {
  entry: PriceListRow | null;
  products: AdminProductRow[];
  dealers: AdminDealerRow[];
};

// A price belongs to exactly one dealer or exactly one tier, never both and
// never neither: price_lists_scope says so and admin_upsert_price_list repeats
// the check so the message arrives as a sentence rather than as a constraint
// violation. The form therefore offers a scope selector instead of two optional
// fields, which is the only shape that cannot express the illegal state.
type Scope = "tier" | "dealer";

export function AdminPriceListForm({ entry, products, dealers }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(entry?.dealer_id ? "dealer" : "tier");
  const [productId, setProductId] = useState(entry?.product_id ?? products[0]?.id ?? "");
  const [dealerId, setDealerId] = useState(entry?.dealer_id ?? "");
  const [tier, setTier] = useState(entry?.price_tier ?? "standard_dealer");
  const [price, setPrice] = useState(entry ? String(entry.price) : "");
  const [validFrom, setValidFrom] = useState(entry?.valid_from ?? "");
  const [validTo, setValidTo] = useState(entry?.valid_to ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  const priceValue = Number(price);
  const rangeValid = validFrom === "" || validTo === "" || validTo >= validFrom;
  const canSubmit =
    productId !== "" && Number.isFinite(priceValue) && priceValue >= 0 && rangeValid &&
    (scope === "dealer" ? dealerId !== "" : tier.trim() !== "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/price-lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_product_id: productId, p_price: priceValue, p_price_list_id: entry?.id ?? null, p_dealer_id: scope === "dealer" ? dealerId : null, p_price_tier: scope === "tier" ? tier.trim() : null, p_valid_from: validFrom || null, p_valid_to: validTo || null }) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error ?? "Failed");
      setFailed(true);
      return;
    }
    setMessage(entry ? "Price updated." : "Price created.");
    if (!entry) {
      setPrice("");
      setValidFrom("");
      setValidTo("");
    }
    router.refresh();
  }

  // Prices are snapshotted onto the order line when it is raised, so removing one
  // cannot rewrite a document that has already been issued. That is why this is
  // a delete rather than a status flag.
  async function remove() {
    if (!entry) return;
    setMessage("");
    setFailed(false);
    setRemoving(true);
    const res = await fetch("/api/price-lists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_price_list_id: entry.id }) });
    const json = await res.json();
    setRemoving(false);
    if (!res.ok) {
      setMessage(json.error ?? "Failed");
      setFailed(true);
      return;
    }
    setMessage("Price removed.");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      <div className="flex justify-end">
        <PdfHelp guide="04-price-lists" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Product
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setProductId(event.target.value)}
            value={productId}
          >
            <option value="">Select a product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} · {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Applies to
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setScope(event.target.value as Scope)}
            value={scope}
          >
            <option value="tier">A price tier</option>
            <option value="dealer">One dealer</option>
          </select>
        </label>

        {scope === "dealer" ? (
          <label className="text-sm font-semibold text-[#334536]">
            Dealer
            <select
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
              onChange={(event) => setDealerId(event.target.value)}
              value={dealerId}
            >
              <option value="">Select a dealer</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-sm font-semibold text-[#334536]">
            Price tier
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              onChange={(event) => setTier(event.target.value)}
              placeholder="standard_dealer"
              value={tier}
            />
            <span className="mt-2 block text-xs font-normal text-[#718075]">
              A tier price covers every dealer without a price of its own.
            </span>
          </label>
        )}

        <label className="text-sm font-semibold text-[#334536]">
          Price
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            min="0"
            onChange={(event) => setPrice(event.target.value)}
            step="0.01"
            type="number"
            value={price}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Valid from
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setValidFrom(event.target.value)}
            type="date"
            value={validFrom}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Valid to
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setValidTo(event.target.value)}
            type="date"
            value={validTo}
          />
        </label>
      </div>

      {!rangeValid ? (
        <p className="rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
          A price cannot end before it starts.
        </p>
      ) : null}
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !canSubmit}
          type="submit"
        >
          {loading ? "Saving…" : entry ? "Save price" : "Create price"}
        </button>
        {entry ? (
          <button
            className="rounded-2xl bg-[#fff0ed] px-5 py-3 text-sm font-bold text-[#a33a2b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={removing}
            onClick={remove}
            type="button"
          >
            {removing ? "Removing…" : "Remove price"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
