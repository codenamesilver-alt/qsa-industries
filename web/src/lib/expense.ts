// The client-safe half of the expense module.
//
// This file exists because of one constraint that is easy to trip over: lib/data.ts
// imports the server Supabase client, so a "use client" component that imports anything
// from it by value drags next/headers into the browser bundle and the build fails. The
// established pattern in this repo is to take only a type from data.ts, which is erased
// at compile time and therefore harmless -- see designation-manager.tsx.
//
// The expense screens need more than types. The payment-mode list and its labels are
// used to render a <select> on the client, and they are values rather than types, so
// they cannot come from data.ts. Keeping them here rather than duplicating them is the
// cheaper half of the two bad options: the other one is a second copy of the mode list
// that drifts from the database enum on the first release after someone adds a mode.

// Mirrors public.expense_heads. The catalogue of what money is spent on: Rent,
// Travel, Utilities, Bank Charges. Same shape as DesignationRow on purpose -- it is the
// same kind of object, a list of options somebody must pick from, and it needs a retire
// rather than a delete because expenses point at the row.
export type ExpenseHeadRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

// Mirrors public.expense_ledger, not public.expenses. The view resolves the head name
// and pre-computes net_amount, so the screen never has to remember to subtract a voided
// row from its own arithmetic.
export type ExpenseLedgerRow = {
  id: string;
  head_id: string;
  head_name: string;
  head_is_active: boolean;
  expense_date: string;
  amount: number | string;
  net_amount: number | string;
  vendor: string | null;
  mode: string;
  reference: string | null;
  taxable_amount: number | string | null;
  tax_amount: number | string | null;
  attachment_path: string | null;
  notes: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_at: string | null;
  recorded_by: string;
  created_at: string;
};

// Mirrors public.expense_totals_by_head. Every head appears, including one with no
// expenses, so the totals screen can say "nothing filed under this yet" rather than
// omitting a category somebody is about to use.
export type ExpenseTotalsRow = {
  head_id: string;
  head_name: string;
  head_is_active: boolean;
  expense_count: number;
  voided_count: number;
  total_amount: number | string;
  voided_amount: number | string;
  net_amount: number | string;
  total_tax_amount: number | string;
};

// Mirrors the expense-documents bucket in 20261003200000. Private, 10 MB, and PNG,
// JPEG, WebP or PDF only. The list is checked here as well as in the bucket policy
// because the policy failure is an opaque storage error while this one can name the
// file and the limit.
export const EXPENSE_BUCKET = "expense-documents";
export const EXPENSE_MAX_BYTES = 10 * 1024 * 1024;
export const EXPENSE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

// public.payment_mode, in the order the register should read. Kept as a plain list
// rather than an enum so a new value in the database does not need a release of this
// file before the picker can show it.
export const EXPENSE_PAYMENT_MODES = [
  "bank_transfer",
  "cash",
  "upi",
  "card",
  "cheque",
  "other",
] as const;

export function expenseModeLabel(mode: string) {
  switch (mode) {
    case "bank_transfer":
      return "Bank transfer";
    case "cash":
      return "Cash";
    case "upi":
      return "UPI";
    case "card":
      return "Card";
    case "cheque":
      return "Cheque";
    default:
      return mode.replace(/_/g, " ");
  }
}
