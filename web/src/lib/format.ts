export function businessDate(value: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).formatToParts(value);
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  return `${year}-${month}-${day}`;
}

export function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusTone(status: string) {
  if (status === "rejected") return "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]";
  if (status === "approved" || status === "invoiced" || status === "delivered") {
    return "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]";
  }
  if (status === "pending_director_approval") return "border-[#f0cf86] bg-[#fff7df] text-[#8b6412]";
  if (status === "dispatched" || status === "in_transit") return "border-[#a9d3db] bg-[#e8f7f8] text-[#276c76]";
  return "border-[#d6e1ce] bg-[#f5f7f2] text-[#4f6254]";
}
