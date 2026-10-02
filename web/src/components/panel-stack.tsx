"use client";

// Section-level dropdowns, one open at a time per page.
//
// Search on its own does not make a page shorter. It makes a long page findable, and
// findable was half the complaint; the other half was that a finance screen was eight
// screens of scrolling with seven stacked panels, four of which had nothing to do with
// the thing you opened the page for. A search box cannot fix that. Collapsing the
// panels can, so this is the other half.
//
// The rule is one open section at a time, matching the per-record RecordPicker above
// it, so that opening a section closes the one before it. Two independent openers on
// one screen — the section list and the records inside the open section — would
// otherwise multiply rather than reduce the amount on screen.
//
// Every collapsed header keeps its description and an optional count, because a
// collapsed section that hides the fact that it holds twelve invoices is worse than the
// long page it replaced. Collapsed means closed, not unknown.
import { createContext, useContext, useMemo, useState } from "react";

type PanelStackValue = {
  openId: string | null;
  toggle: (id: string) => void;
};

const PanelStackContext = createContext<PanelStackValue | null>(null);

/**
 * Owns which section is open. Wrap a page's sections in this and give each one an id.
 *
 * `defaultOpenId` should be the section someone most often came for, so the common
 * case is one click fewer than a page that starts fully collapsed.
 */
export function PanelStack({ children, defaultOpenId = null }: { children: React.ReactNode; defaultOpenId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);

  const value = useMemo<PanelStackValue>(
    () => ({ openId, toggle: (id: string) => setOpenId((current) => (current === id ? null : id)) }),
    [openId],
  );

  return <PanelStackContext.Provider value={value}>{children}</PanelStackContext.Provider>;
}

/**
 * One collapsible section. Needs a PanelStack above it; without one it renders open and
 * static, which is the correct fallback for a page that has a single section.
 */
export function CollapsiblePanel({
  id,
  title,
  description,
  summary,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  /** Shown on the right of the collapsed header, e.g. "12 records". */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const stack = useContext(PanelStackContext);
  const open = stack ? stack.openId === id : true;
  const bodyId = `panel-${id}`;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-[#dfe6dc] bg-white">
      <h2>
        <button
          aria-controls={bodyId}
          aria-expanded={open}
          className="flex w-full items-start justify-between gap-4 p-6 text-left hover:bg-[#fafbf9] sm:p-8"
          disabled={!stack}
          onClick={() => stack?.toggle(id)}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</span>
            <span className="mt-3 block text-2xl font-semibold tracking-[-0.04em]">{title}</span>
            {description ? <span className="mt-3 block max-w-2xl text-sm leading-6 text-[#718075]">{description}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {summary ? (
              <span className="rounded-full border border-[#dfe6dc] bg-[#f5f7f2] px-3 py-1 text-xs font-bold text-[#4f6254]">
                {summary}
              </span>
            ) : null}
            <span aria-hidden="true" className={`text-xs text-[#819083] transition-transform ${open ? "rotate-180" : ""}`}>
              ▾
            </span>
          </span>
        </button>
      </h2>

      {open ? (
        <div className="border-t border-[#eef2ec] px-6 pb-8 pt-7 sm:px-8" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
