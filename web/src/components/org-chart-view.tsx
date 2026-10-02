"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrgChartRow } from "../lib/data";
import {
  buildOrgTree,
  GAP_Y,
  layoutOrgChart,
  NODE_H,
  NODE_W,
  roleLabel,
  type Laid,
} from "../lib/org-tree";

// The chart itself, read-only, and the same component for everybody who can see
// it. An admin builds the chart on the panel below; this is what the building is
// for, and it is deliberately not editable in place, because a chart that changes
// under the pointer of the person reading it is not a chart anyone can be shown.
//
// What changed is the drawing. The old version was a nested list with a border down
// the left of each level, which cannot be laid out side by side, cannot be panned,
// and makes "show me who reports to this person" a thing you read rather than a
// thing you click. This lays the tree out the way an org chart is actually drawn:
// leaves get a column each, a parent is centred over its children, and the
// connectors are an SVG elbow under the parent and down into each child.
//
// Still no charting library. The whole layout is one post-order pass assigning each
// leaf the next free column and averaging the children for the parent, which is
// about thirty lines, and it keeps the app free of a rendering dependency for a
// screen with four divs and a path per edge.

const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;

type Search = { query: string; matches: Set<string> };

export function OrgChartView({ rows }: { rows: OrgChartRow[] }) {
  const roots = useMemo(() => buildOrgTree(rows), [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(
    null,
  );

  // A search matches a post, the person in it, or their job title, because an
  // admin looking for somebody usually knows one of the three and never knows which.
  const search = useMemo<Search>(() => {
    const needle = query.trim().toLowerCase();
    const matches = new Set<string>();
    if (needle === "") return { query: "", matches };
    for (const row of rows) {
      const haystack = [row.title, row.user_full_name, row.user_designation, row.user_email]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (haystack.includes(needle)) matches.add(row.id);
    }
    return { query: needle, matches };
  }, [query, rows]);

  const { laid, width, height } = useMemo(
    () => layoutOrgChart(roots, collapsed),
    [roots, collapsed],
  );

  const byId = useMemo(() => new Map(laid.map((item) => [item.node.row.id, item])), [laid]);
  const selected = selectedId === null ? null : rows.find((row) => row.id === selectedId) ?? null;

  // A post hidden by a collapsed ancestor cannot be the open selection, so opening
  // one first expands the path down to it. Otherwise clicking a search result the
  // reader cannot see would silently do nothing.
  const reveal = useCallback(
    (id: string) => {
      setCollapsed((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [],
  );

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
    // A pinch on a trackpad arrives as ctrl+wheel. Plain wheel is left alone so the
    // container still scrolls the way a scroll container is expected to.
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
        Nothing to draw yet.
      </p>
    );
  }

  const matchCount = search.matches.size;
  const dimOthers = matchCount > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-xl border border-[#d6e1ce] bg-white px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819083]">Find</span>
          <input
            className="w-full text-sm font-normal outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="A post, a name or a job title"
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
              current.size > 0 ? new Set() : new Set(laid.filter((i) => i.node.children.length > 0).map((i) => i.node.row.id)),
            )
          }
        >
          {collapsed.size > 0 ? "Expand all" : "Collapse all"}
        </ChartButton>

        <p aria-live="polite" className="ml-auto text-xs text-[#5d6b60]">
          {matchCount > 0
            ? `${matchCount} ${matchCount === 1 ? "match" : "matches"}`
            : `${laid.length} ${laid.length === 1 ? "post" : "posts"} shown`}
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
                  .map((child) => byId.get(child.row.id))
                  .filter((item): item is Laid => item !== undefined);
                if (children.length === 0) return null;

                const parentCx = parent.x + NODE_W / 2;
                const bottom = parent.y + NODE_H;
                const midY = bottom + GAP_Y / 2;
                const childCxs = children.map((child) => child.x + NODE_W / 2);
                const spineLeft = Math.min(...childCxs);
                const spineRight = Math.max(...childCxs);

                return (
                  <g key={`edge-${parent.node.row.id}`} stroke="#c9d6c0" strokeWidth={2} fill="none">
                    <path d={`M ${parentCx} ${bottom} V ${midY}`} />
                    {childCxs.length > 1 ? (
                      <path d={`M ${spineLeft} ${midY} H ${spineRight}`} />
                    ) : null}
                    {children.map((child) => (
                      <path
                        d={`M ${child.x + NODE_W / 2} ${midY} V ${child.y}`}
                        key={`edge-${child.node.row.id}`}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {laid.map((item) => (
              <ChartNode
                centred={dimOthers && search.matches.has(item.node.row.id)}
                dimmed={dimOthers && !search.matches.has(item.node.row.id)}
                isSelected={selectedId === item.node.row.id}
                key={item.node.row.id}
                layout={item}
                onCentre={() => centreOn(item.node.row.id)}
                onSelect={() => setSelectedId((current) =>
                  current === item.node.row.id ? null : item.node.row.id,
                )}
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(item.node.row.id)) next.delete(item.node.row.id);
                    else next.add(item.node.row.id);
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
              Pick a post to see who holds it, who they report to and who reports to them.
            </p>
          ) : (
            <PostDetail
              onCentre={() => centreOn(selected.id)}
              reports={laid.filter((item) => item.node.row.parent_id === selected.id)}
              row={selected}
            />
          )}
        </aside>
      </div>

      <p className="text-xs text-[#5d6b60]">
        Drag the chart to move it, pinch or use the buttons to zoom, and use the arrow on a post to fold its
        reports away. Escape clears the search and the selection.
      </p>
    </div>
  );
}

function ChartNode({
  layout,
  isSelected,
  centred,
  dimmed,
  onSelect,
  onToggle,
  onCentre,
}: {
  layout: Laid;
  isSelected: boolean;
  centred: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onCentre: () => void;
}) {
  const { row } = layout.node;
  const vacant = row.user_id === null;
  const suspended = row.user_is_active === false;
  const hasChildren = layout.node.children.length > 0;

  return (
    <div
      className={`absolute rounded-2xl border px-4 py-3 transition-opacity ${
        isSelected
          ? "border-[#15221b] bg-white shadow-lg"
          : centred
            ? "border-[#9db56a] bg-white shadow-md"
            : vacant
              ? "border-dashed border-[#c9d6c0] bg-white"
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
        <span className="block text-sm font-bold text-[#15221b]">{row.title}</span>
        {vacant ? (
          <span className="mt-1 block text-xs font-bold uppercase tracking-[0.12em] text-[#819083]">
            Vacant
          </span>
        ) : (
          <>
            <span className="mt-1 block truncate text-sm text-[#334536]">{row.user_full_name}</span>
            {/* The designation is the job title, which is a different thing from the
                post above it and from the role below, so it gets its own line. */}
            {row.user_designation ? (
              <span className="mt-0.5 block truncate text-xs text-[#4f6254]">{row.user_designation}</span>
            ) : null}
            <span className="mt-0.5 block truncate text-xs text-[#718075]">
              {roleLabel(row.user_role)}
              {suspended ? " · login suspended" : ""}
            </span>
          </>
        )}
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
          {layout.collapsed
            ? `+${layout.hiddenCount}`
            : `−${layout.node.children.length}`}
        </button>
      ) : null}
    </div>
  );
}

function PostDetail({
  row,
  reports,
  onCentre,
}: {
  row: OrgChartRow;
  reports: Laid[];
  onCentre: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-sm font-bold text-[#15221b]">{row.title}</p>
        <button
          className="mt-1 text-xs font-semibold text-[#4f6254] underline"
          onClick={onCentre}
          type="button"
        >
          Centre the chart here
        </button>
      </div>

      <dl className="space-y-2">
        <Detail label="Held by" value={row.user_full_name ?? "Vacant"} />
        <Detail label="Job title" value={row.user_designation ?? "None recorded"} />
        <Detail label="Role" value={row.user_role ? roleLabel(row.user_role) : "None"} />
        <Detail label="Email" value={row.user_email ?? "—"} />
        <Detail
          label="Login"
          value={row.user_id === null ? "—" : row.user_is_active === false ? "Suspended" : "Active"}
        />
      </dl>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#819083]">
          Reports to this post
        </p>
        {reports.length === 0 ? (
          <p className="mt-1 text-sm text-[#718075]">Nothing reports here.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-[#334536]">
            {reports.map((item) => (
              <li key={item.node.row.id}>{item.node.row.title}</li>
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
