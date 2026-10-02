"use client";

// The bullet list under a page headline, collapsed behind one link.
//
// Every page in the portal passes a `highlights` array to PortalShell, and that list is
// a description of the page rather than anything the page does. It was fine at three
// items and stopped being fine at seven: on the overview it pushed the metric cards that
// answer the question ("are we short on anything?") below a fold of sentences about what
// the page contains. Reading "order counts by lifecycle stage" and then scrolling to find
// the order counts is the page telling you what it has and then making you look for it.
//
// So the headline stays and the inventory of the page goes behind a link. The list is
// still one click away on every screen, which is what makes collapsing it honest rather
// than a loss -- it is reference text, and reference text belongs off the main path.
//
// Closed by default rather than open because that is the whole point of the change. Open
// would be the current behaviour with extra markup on it.
//
// This is a client component only because the open state is state. PortalShell itself
// stays a server component, so this is one small island on the page rather than making
// every header and its whole subtree client-rendered.
import { useId, useState } from "react";

/**
 * `className` lets the login screen keep its more generous spacing. Inside the portal the
 * list sits directly under a description and needs to stay tight, because the point of
 * the change there is to save vertical space; on the login screen it stands on its own
 * below the description, and the same tight margin would read as cramped.
 */
export function HighlightList({
  items,
  className = "mt-3",
}: {
  items: readonly string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  // A page that passes an empty list should not render a link that reveals nothing.
  // Silence is better than a dead control.
  if (items.length === 0) return null;

  return (
    <div className={className}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6f8c3b] underline decoration-[#c3d6a1] decoration-1 underline-offset-4 transition-colors hover:text-[#15221b] hover:decoration-[#6f8c3b]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "Show less" : "Know more"}
        {/* Chevron rather than a plus: a plus reads as "add something", and this adds
            nothing, it reveals. The rotation is what signals the two states once the
            label has changed to "Show less". */}
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open ? (
        <ul
          className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3"
          // A labelled region rather than a bare div, so the expanded list is
          // announced as something that appeared rather than as loose text.
          role="region"
          id={listId}
        >
          {items.map((item) => (
            <li className="flex gap-2 text-xs leading-5 text-[#334536]" key={item}>
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#6f8c3b]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
