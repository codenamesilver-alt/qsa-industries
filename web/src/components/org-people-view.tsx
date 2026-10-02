"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrgPersonRow } from "../lib/data";
import { buildPeopleTree } from "../lib/org-people-tree";
import {
  GAP_Y,
  layoutTree,
  NODE_H,
  NODE_W,
  roleLabel,
  type Laid,
} from "../lib/org-tree";

// The chart, read-only, drawn as people.
//
// It is the same component shape as the post chart below the repository: pan, zoom,
// fold, search, select. What changed is what a box is. A box used to be a post with
// a person sitting in it, which meant two names for one fact and an admin inventing
// a post for every title the company used. A box here is a person. The designation
// under the name is the job title they hold, chosen from the catalogue, and the
// role under it is the permission model, which is a different thing and is labelled
// as one.
//
// No chart library, same as before: the layout is one post-order pass assigning each
// leaf the next free column and averaging the children for the parent, and four divs
// and a path per edge do not justify a rendering dependency.

const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;

type Search = { query: string; matches: Set<string> };

export function OrgPeopleView({ rows }: { rows: OrgPersonRow[] }) {
  const roots = useMemo(() => buildPeopleTree(rows), [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(
    null,
  );

  // A search matches the person, their designation or their email. Somebody looking
  // for a colleague usually knows the name and sometimes only knows the title, so
  // both are searched rather than making the reader remember which field they typed
  // into last time.
  const search = useMemo<Search>(() => {
    const needle = query.trim().toLowerCase();
    const matches = new Set<string>();
    if (needle === "") return { query: "", matches };
    for (const row of rows) {
      const haystack = [row.full_name, row.designation, row.email]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (haystack.includes(needle)) matches.add(row.user_id);
    }
    return { query: needle, matches };
  }, [query, rows]);

  const { laid, width, height } = useMemo(
    () => layoutTree(roots, (row) => row.user_id, collapsed),
    [roots, collapsed],
  );

  const byId = useMemo(() => new Map(laid.map((item) => [item.node.row.user_id, item])), [laid]);
  const selected = selectedId === null ? null : rows.find((row) => row.user_id === selectedId) ?? null;

  const reveal = useCallback((id: string) => {
    setCollapsed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || width === 0 || height === 0) return;
    const padding = 32;
    const next = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(
        (viewport.clientWidth - padding * 2) / width,
        (viewport.clientHeight - padding * 2) / height,
      )),
    );
    setScale(next);
    setOffset({
      x: Math.max(padding, (viewport.clientWidth - width * next) / 2),
      y: padding,
    });
  }, [width, height]);

  // Fit once per shape change rather than on every render: the reader's zoom and
  // pan are theirs, and a re-render caused by hovering a node must not reset them.
  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedId(null);
      setQuery("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setScale((current) => {
      const next = clamp(current * (event.deltaY < 0 ? 1.1 : 0.9), MIN_SCALE, MAX_SCALE);
      // Keep the point under the cursor pinned while the scale changes.
      setOffset((origin) => ({
        x: pointerX - ((pointerX - origin.x) * next) / current,
        y: pointerY - ((pointerY - origin.y) * next) / current,
      }));
      return next;
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragging.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragging.current;
    if (!drag) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.pointerX),
      y: drag.originY + (event.clientY - drag.pointerY),
    });
  }

  function endDrag() {
    dragging.current = null;
  }

  function centreOn(id: string) {
    const item = byId.get(id);
    const viewport = viewportRef.current;
    if (!item || !viewport) return;
    reveal(id);
    setOffset({
      x: viewport.clientWidth / 2 - (item.x + NODE_W / 2) * scale,
      y: viewport.clientHeight / 2 - (item.y + NODE_H / 2) * scale,
    });
  }

  if (laid.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#d6e1ce] px-4 py-6 text-sm text-[#718075]">
        Nobody to draw yet.
      </p>
    );
  }

  const matchCount = search.matches.size;
  const dimOthers = matchCount > 0;
  const heads = rows.filter((row) => row.reports_to_id === null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-xl border border-[#d6e1ce] bg-white px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819083]">Find</span>
          <input
            className="w-full text-sm font-normal outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="A name, a job title or an email"
            type="search"
            value={query}
          />
        </label>

        <ChartButton onClick={() => setScale((current) => clamp(current * 1.15, MIN_SCALE, MAX_SCALE))}>
          Zoom in
        </ChartButton>
        <ChartButton onClick={() => setScale((current) => clamp(current / 1.15, MIN_SCALE, MAX_SCALE))}>
          Zoom out
        </ChartButton>
        <ChartButton onClick={fit}>Fit</ChartButton>
        <ChartButton
          onClick={() =>
            setCollapsed((current) =>
              current.size > 0 ? new Set() : new Set(laid.filter((i) => i.node.children.length > 0).map((i) => i.node.row.user_id)),
            )
          }
        >
          {collapsed.size > 0 ? "Expand all" : "Collapse all"}
        </ChartButton>

        <p aria-live="polite" className="ml-auto text-xs text-[#5d6b60]">
          {matchCount > 0
            ? `${matchCount} ${matchCount === 1 ? "match" : "matches"}`
            : `${laid.length} ${laid.length === 1 ? "person" : "people"} shown`}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          aria-label="Organization chart. Drag to pan, pinch or use the buttons to zoom."
          className="relative h-[32rem] cursor-grab touch-none overflow-hidden rounded-2xl border border-[#dfe6dc] bg-[#fbfdf9] active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          ref={viewportRef}
          role="group"
        >
          <div
            style={{
              height,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: "0 0",
              width,
            }}
          >
            <svg
              aria-hidden="true"
              className="absolute left-0 top-0 overflow-visible"
              height={height}
              width={width}
            >
              {laid.map((parent) => {
                if (parent.collapsed) return null;
                const children = parent.node.children
                  .map((child) => byId.get(child.row.user_id))
                  .filter((item): item is Laid<OrgPersonRow> => item !== undefined);
                if (children.length === 0) return null;

                const parentCx = parent.x + NODE_W / 2;
                const bottom = parent.y + NODE_H;
                const midY = bottom + GAP_Y / 2;
                const childCxs = children.map((child) => child.x + NODE_W / 2);
                const spineLeft = Math.min(...childCxs);
                const spineRight = Math.max(...childCxs);

                return (
                  <g key={`edge-${parent.node.row.user_id}`} stroke="#c9d6c0" strokeWidth={2} fill="none">
                    <path d={`M ${parentCx} ${bottom} V ${midY}`} />
                    {childCxs.length > 1 ? (
                      <path d={`M ${spineLeft} ${midY} H ${spineRight}`} />
                    ) : null}
                    {children.map((child) => (
                      <path
                        d={`M ${child.x + NODE_W / 2} ${midY} V ${child.y}`}
                        key={`edge-${child.node.row.user_id}`}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {laid.map((item) => (
              <PeopleNode
                centred={dimOthers && search.matches.has(item.node.row.user_id)}
                dimmed={dimOthers && !search.matches.has(item.node.row.user_id)}
                isSelected={selectedId === item.node.row.user_id}
                isHead={item.node.row.reports_to_id === null}
                key={item.node.row.user_id}
                layout={item}
                onCentre={() => centreOn(item.node.row.user_id)}
                onSelect={() => setSelectedId((current) =>
                  current === item.node.row.user_id ? null : item.node.row.user_id,
                )}
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(item.node.row.user_id)) next.delete(item.node.row.user_id);
                    else next.add(item.node.row.user_id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-[#dfe6dc] bg-white p-4">
          {selected === null ? (
            <p className="text-sm text-[#718075]">
              Pick somebody to see who they report to, who reports to them, and what they do.
            </p>
          ) : (
            <PersonDetail
              onCentre={() => centreOn(selected.user_id)}
              person={selected}
              reports={rows.filter((row) => row.reports_to_id === selected.user_id)}
            />
          )}
        </aside>
      </div>

      <p className="text-xs text-[#5d6b60]">
        {heads === 1
          ? "One person reports to nobody, so the chart has a single head. A partner who does not report to the CEO is a second head, and the chart will draw it as one."
          : `${heads} people report to nobody. That is the top of the company: a CEO and partners who do not report to each other.`}{" "}
        Drag the chart to move it, pinch or use the buttons to zoom, and use the arrow on a person to fold
        their reports away. Escape clears the search and the selection.
      </p>
    </div>
  );
}

function PeopleNode({
  layout,
  isSelected,
  isHead,
  centred,
  dimmed,
  onSelect,
  onToggle,
  onCentre,
}: {
  layout: Laid<OrgPersonRow>;
  isSelected: boolean;
  isHead: boolean;
  centred: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onCentre: () => void;
}) {
  const { row } = layout.node;
  const suspended = row.is_active === false;
  const hasChildren = layout.node.children.length > 0;

  return (
    <div
      className={`absolute rounded-2xl border px-4 py-3 transition-opacity ${
        isSelected
          ? "border-[#15221b] bg-white shadow-lg"
          : centred
            ? "border-[#9db56a] bg-white shadow-md"
            : suspended
              ? "border-dashed border-[#f2b8ad] bg-white"
              : isHead
                ? "border-[#c9d6c0] bg-white"
                : "border-[#dfe6dc] bg-white"
      } ${dimmed ? "opacity-35" : "opacity-100"}`}
      onDoubleClick={onCentre}
      style={{ height: NODE_H, left: layout.x, top: layout.y, width: NODE_W }}
    >
      <button
        aria-pressed={isSelected}
        className="block w-full text-left"
        onClick={onSelect}
        type="button"
      >
        <span className="block truncate text-sm font-bold text-[#15221b]">{row.full_name}</span>
        {/* The designation is the job title and the role is the permission model.
            Two lines, because drawing them as one is what made the old chart
            unreadable: "Director" as a box and "admin" as the same word meant two
            different things. */}
        {row.designation ? (
          <span className="mt-1 block truncate text-sm text-[#334536]">{row.designation}</span>
        ) : (
          <span className="mt-1 block truncate text-xs font-bold uppercase tracking-[0.12em] text-[#819083]">
            No job title
          </span>
        )}
        <span className="mt-0.5 block truncate text-xs text-[#718075]">
          {roleLabel(row.role)}
          {suspended ? " · login suspended" : isHead ? " · top of the company" : ""}
        </span>
      </button>

      {hasChildren ? (
        <button
          aria-expanded={!layout.collapsed}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[#c9d6c0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#4f6254]"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          type="button"
        >
          {layout.collapsed ? `+${layout.hiddenCount}` : `−${layout.node.children.length}`}
        </button>
      ) : null}
    </div>
  );
}

function PersonDetail({
  person,
  reports,
  onCentre,
}: {
  person: OrgPersonRow;
  reports: OrgPersonRow[];
  onCentre: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-sm font-bold text-[#15221b]">{person.full_name}</p>
        <button
          className="mt-1 text-xs font-semibold text-[#4f6254] underline"
          onClick={onCentre}
          type="button"
        >
          Centre the chart here
        </button>
      </div>

      <dl className="space-y-2">
        <Detail label="Job title" value={person.designation ?? "None recorded"} />
        <Detail label="Role" value={person.role ? roleLabel(person.role) : "None"} />
        <Detail label="Email" value={person.email ?? "—"} />
        <Detail label="Login" value={person.is_active ? "Active" : "Suspended"} />
        <Detail
          label="Reports to"
          value={
            person.reports_to_id === null
              ? "Nobody — top of the company"
              : `${person.reports_to_name ?? "Unknown account"}${
                  person.reports_to_designation ? `, ${person.reports_to_designation}` : ""
                }`
          }
        />
      </dl>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819083]">
          Reports to this person
        </p>
        {reports.length === 0 ? (
          <p className="mt-1 text-sm text-[#718075]">Nobody reports here.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-[#334536]">
            {reports.map((row) => (
              <li key={row.user_id}>{row.full_name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819083]">{label}</dt>
      <dd className="break-words text-[#334536]">{value}</dd>
    </div>
  );
}

function ChartButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-xs font-semibold text-[#4f6254] hover:border-[#9db56a]"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}