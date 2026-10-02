"use client";

// Collapsible and searchable lists for pages that would otherwise render every
// record's full detail at once.
//
// The problem this solves is not cosmetic. The administration screen used to map over
// every product, every dealer and every user and mount a complete form for each one,
// which put the page at roughly 25,000 pixels tall. Printing it, scrolling it, and
// waiting for it to become interactive all got worse as the catalogue grew, and the
// failure mode was silent: a new product added one more form to a page that was
// already unusable.
//
// There are two shapes here, because the lists are not all the same shape:
//
//   RecordPicker  a list of rows that each hide a form or a set of controls. One line
//                per record, exactly one row open at a time. Use it when the work is
//                "open the thing I want and edit it".
//
//   RecordFilter  a search box over a list or table whose rows are not collapsible,
//                because the row is already the whole content: an ageing table, a
//                payment register, an order queue with a button on it. Use it when the
//                work is "read the list, and find a row without scrolling past twenty
//                others to find it".
//
// Both filter as you type across every field you nominate rather than guessing, because
// a filter over dealers should match the GSTIN and a filter over people should not
// match the reporting line. An empty key list falls back to the summary text.
import { useId, useMemo, useState } from "react";

export type PickerItem = {
  id: string;
  /** One line, shown in the collapsed row. Usually the name. */
  summary: string;
  /** The dimmer second line under the summary. Optional. */
  detail?: React.ReactNode;
  /** Badges or pills on the right of the collapsed row. Optional. */
  tags?: React.ReactNode;
  /** Mounted only while the row is open. */
  body: React.ReactNode;
  /** Extra strings the search box should match. Defaults to summary and detail. */
  searchKeys?: string[];
  /** Plain-text version of `tags`, so a badge's wording is searchable. */
  tagText?: string;
};

/**
 * The search box and the live count, shared by both exports.
 *
 * The input's id comes from useId rather than the placeholder text. Two pickers on
 * one page used to produce two elements with the same id whenever their placeholders
 * matched, which breaks the label's association and makes the field ambiguous to
 * anything reading the accessibility tree.
 */
function SearchBar({
  query,
  onQuery,
  placeholder,
  searchLabel,
  shown,
  total,
  filtered,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  searchLabel?: string;
  shown: number;
  total: number;
  filtered: boolean;
}) {
  const id = useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[15rem] flex-1">
        <label className="sr-only" htmlFor={id}>
          {searchLabel ?? placeholder}
        </label>
        <input
          autoComplete="off"
          className="w-full rounded-2xl border border-[#dfe6dc] bg-white px-4 py-3 text-sm outline-none placeholder:text-[#9aa79c] focus:border-[#6f8c3b] focus:ring-2 focus:ring-[#6f8c3b]/20"
          id={id}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={query}
        />
      </div>

      <p aria-live="polite" className="text-xs font-medium text-[#718075]">
        {filtered
          ? `${shown} of ${total} match`
          : `${total} ${total === 1 ? "record" : "records"}`}
      </p>
    </div>
  );
}

/**
 * Search over a list or table whose rows are not collapsible.
 *
 * The render prop receives the rows that survived the search, so the caller keeps
 * ownership of the markup. That is the whole point: an ageing table has to stay a
 * table, and a caller cannot wrap a table in a list of disclosure rows without
 * breaking it.
 *
 * `collapseAfter` caps what is rendered before the search box is touched. Searching
 * always lifts the cap, because someone who typed a query wants every match, not the
 * first handful. Without it a register with four hundred receipts is four hundred
 * rows on screen, which is the height problem this whole file exists to solve.
 */
export function RecordFilter<T>({
  items,
  searchKeys,
  placeholder = "Search",
  searchLabel,
  emptyMessage = "Nothing to show.",
  noMatchMessage = "No match.",
  collapseAfter,
  children,
}: {
  items: readonly T[];
  /** The fields this search should match, per row. */
  searchKeys: (item: T) => string[];
  placeholder?: string;
  searchLabel?: string;
  emptyMessage?: string;
  noMatchMessage?: string;
  /** Show at most this many rows until the search box is used. */
  collapseAfter?: number;
  children: (visible: T[]) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return [...items];
    return items.filter((item) =>
      searchKeys(item)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, needle, searchKeys]);

  const capped = needle === "" && !showAll && collapseAfter !== undefined && visible.length > collapseAfter;
  const rows = capped ? visible.slice(0, collapseAfter) : visible;

  // Clearing the search puts the cap back. Doing it here rather than in an effect
  // keeps this a single render pass: the effect version set state after the browser
  // had already painted the long list, so the list visibly grew and then shrank.
  const onQuery = (value: string) => {
    setQuery(value);
    if (value.trim() === "") setShowAll(false);
  };

  if (items.length === 0) {
    return <p className="rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{emptyMessage}</p>;
  }

  return (
    <div>
      <SearchBar
        filtered={needle !== ""}
        onQuery={onQuery}
        placeholder={placeholder}
        query={query}
        searchLabel={searchLabel}
        shown={visible.length}
        total={items.length}
      />

      {visible.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{noMatchMessage}</p>
      ) : (
        <>
          {children(rows)}

          {capped ? (
            <button
              className="mt-4 w-full rounded-2xl border border-[#dfe6dc] bg-[#fafbf9] px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]"
              onClick={() => setShowAll(true)}
              type="button"
            >
              Show all {visible.length} — or search to narrow them
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function RecordPicker({
  items,
  placeholder = "Search",
  searchLabel,
  emptyMessage = "Nothing to show.",
  noMatchMessage = "No match.",
  /** Rendered above the list, e.g. a "Create new" form the list sits under. */
  header,
  /** Start with every row open. Only sensible for short lists. */
  defaultOpenAll = false,
  /** List at most this many collapsed rows until the search box is used. */
  collapseAfter,
}: {
  items: PickerItem[];
  placeholder?: string;
  searchLabel?: string;
  emptyMessage?: string;
  noMatchMessage?: string;
  header?: React.ReactNode;
  defaultOpenAll?: boolean;
  collapseAfter?: number;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(defaultOpenAll);
  const [showAllRows, setShowAllRows] = useState(false);

  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = [...(item.searchKeys ?? []), item.summary, item.tagText ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, needle]);

  // Same rule as RecordFilter: a typed query means "show me everything that matches",
  // so the row cap lifts while the box has text in it. Clearing the box re-applies it,
  // from the handler rather than an effect, so the list never renders long and then
  // shortens in front of you.
  const onQuery = (value: string) => {
    setQuery(value);
    if (value.trim() === "") setShowAllRows(false);
  };

  const capped =
    needle === "" && !showAllRows && collapseAfter !== undefined && visible.length > collapseAfter;
  const listed = capped ? visible.slice(0, collapseAfter) : visible;

  const isOpen = (id: string) => expandAll || openId === id;

  // TEMP-PROBE-REMOVED

  return (
    <div>
      {header}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SearchBar
          filtered={needle !== ""}
          onQuery={onQuery}
          placeholder={placeholder}
          query={query}
          searchLabel={searchLabel}
          shown={visible.length}
          total={items.length}
        />

        {items.length > 6 ? (
          <button
            className="rounded-full border border-[#dfe6dc] px-3 py-1.5 text-xs font-bold text-[#4f6254] hover:bg-[#f5f7f2]"
            onClick={() => setExpandAll((value) => !value)}
            type="button"
          >
            {expandAll ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{emptyMessage}</p>
      ) : visible.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">
          {noMatchMessage}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[#e8ede6] overflow-hidden rounded-2xl border border-[#e8ede6]">
          {listed.map((item) => {
            const open = isOpen(item.id);
            return (
              <li className="bg-white" key={item.id}>
                <button
                  aria-expanded={open}
                  className="flex w-full items-start justify-between gap-4 px-4 py-3.5 text-left hover:bg-[#fafbf9]"
                  onClick={() => {
                    setExpandAll(false);
                    setOpenId((current) => (current === item.id ? null : item.id));
                  }}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.summary}</span>
                    {item.detail ? (
                      <span className="mt-1 block truncate text-xs text-[#819083]">{item.detail}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* The badge is built by a Server Component, so it arrives without
                        React's "this was static JSX" marker. Sitting next to the chevron
                        would put it in a sibling array, and React then reports it as an
                        unkeyed list child. Owning wrapper keeps it out of that position;
                        inline-flex keeps the flex layout identical. */}
                    <span className="inline-flex shrink-0">{item.tags}</span>
                    <span
                      aria-hidden="true"
                      className={`text-xs text-[#819083] transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      ▾
                    </span>
                  </span>
                </button>

                {open ? <div className="border-t border-[#eef2ec] px-4 pb-5 pt-4">{item.body}</div> : null}
              </li>
            );
          })}
        </ul>
      )}

      {capped ? (
        <button
          className="mt-4 w-full rounded-2xl border border-[#dfe6dc] bg-[#fafbf9] px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]"
          onClick={() => setShowAllRows(true)}
          type="button"
        >
          Show all {visible.length} — or search to find one
        </button>
      ) : null}
    </div>
  );
}
