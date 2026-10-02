import { formatNumber } from "../lib/format";

// Charts are hand-rolled SVG rather than a charting dependency. Two reasons, both
// about this codebase specifically:
//
//   1. Every number here comes from a Supabase view that is already aggregated, so
//      there is no dataset to fit or scale interactively. A chart library would be
//      bringing a scale and a tooltip system to draw four fixed series.
//   2. The rest of the UI is Tailwind classes over inline hex tokens (#dfe6dc,
//      #6f8c3b, #819083). Hand-rolled SVG reuses those exact tokens, so the charts
//      inherit the same palette and cannot drift from the rest of the app. A
//      library would need its own theme bridged onto those values.
//
// So: server components with no client JS, which matters because every portal page
// here is a server component and a client chart library would force a "use client"
// boundary into the middle of them.

const axis = "#819083";
const grid = "#eef1ec";
const realized = "#6f8c3b";
const pipeline = "#a9d3db";
const rejected = "#f2b8ad";
const amber = "#e0a33e";
const ink = "#276c76";

function niceCeiling(value: number) {
  // A chart whose top bar exactly touches the frame reads as clipped, and a scale
  // starting at a non-round number makes the bars impossible to compare at a
  // glance. Round up to a 1/2/5 x 10^n step that always clears the largest value.
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function shortMoney(value: number) {
  if (value >= 10000000) return `${(value / 10000000).toFixed(value % 10000000 === 0 ? 0 : 1)}Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return formatNumber(Math.round(value));
}

function shortCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return formatNumber(Math.round(value));
}

function ticksFor(top: number) {
  return [0, top / 4, top / 2, (top * 3) / 4, top];
}

export type TrendPoint = {
  label: string;
  realized: number;
  pipeline: number;
  rejected: number;
};

export function TrendChart({
  points,
  title,
  description,
  kind = "money",
}: {
  points: TrendPoint[];
  title: string;
  description?: string;
  // A production chart plots units and yield, not rupees, so the axis label and the
  // formatter both change. Defaulting to money would put a rupee sign on a count of
  // bags of rice, which is worse than no axis label at all.
  kind?: "money" | "count";
}) {
  if (points.length === 0) {
    return <EmptyChart message="Nothing falls in this window yet." title={title} />;
  }

  const width = 720;
  const height = 260;
  const padLeft = 56;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 34;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const peak = Math.max(
    ...points.flatMap((point) => [point.realized, point.pipeline]),
    1,
  );
  const top = niceCeiling(peak);
  const y = (value: number) => padTop + plotHeight - (value / top) * plotHeight;
  const band = plotWidth / points.length;
  const barWidth = Math.min(38, band * 0.42);
  const gap = 4;
  const scale = kind === "money" ? shortMoney : shortCount;

  // With more than about 20 bars the labels collide and the chart becomes a solid
  // block, so thin the labels rather than the data: the bars stay, the axis text is
  // dropped to every nth. Losing a label is recoverable from the title tooltip;
  // losing the shape is not.
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-4 text-xs text-[#718075]">
          <Legend colour={realized} label="Realized" />
          <Legend colour={pipeline} label="Pipeline" />
          <Legend colour={rejected} label="Rejected" />
        </span>
      </figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <svg
          aria-label={`${title}: grouped bars by period`}
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {ticksFor(top).map((tick) => (
            <g key={tick}>
              <line
                stroke={grid}
                strokeWidth={1}
                x1={padLeft}
                x2={width - padRight}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                dominantBaseline="middle"
                fill={axis}
                fontSize={11}
                textAnchor="end"
                x={padLeft - 10}
                y={y(tick)}
              >
                {scale(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const centre = padLeft + band * index + band / 2;
            const realizedHeight = Math.max(point.realized > 0 ? 2 : 0, padTop + plotHeight - y(point.realized));
            const pipelineHeight = Math.max(point.pipeline > 0 ? 2 : 0, padTop + plotHeight - y(point.pipeline));
            return (
              <g key={point.label}>
                <title>{`${point.label} · realized ${formatNumber(point.realized)} · pipeline ${formatNumber(
                  point.pipeline,
                )}${point.rejected > 0 ? ` · rejected ${formatNumber(point.rejected)}` : ""}`}</title>
                <rect
                  fill={realized}
                  height={realizedHeight}
                  rx={4}
                  width={barWidth}
                  x={centre - barWidth - gap / 2}
                  y={padTop + plotHeight - realizedHeight}
                />
                <rect
                  fill={pipeline}
                  height={pipelineHeight}
                  rx={4}
                  width={barWidth}
                  x={centre + gap / 2}
                  y={padTop + plotHeight - pipelineHeight}
                />
                {point.rejected > 0 ? (
                  <line
                    stroke={rejected}
                    strokeLinecap="round"
                    strokeWidth={4}
                    x1={centre - barWidth}
                    x2={centre + barWidth}
                    y1={y(point.realized + point.pipeline) - 8}
                    y2={y(point.realized + point.pipeline) - 8}
                  />
                ) : null}
                {index % labelEvery === 0 || index === points.length - 1 ? (
                  <text
                    fill={axis}
                    fontSize={11}
                    textAnchor="middle"
                    x={centre}
                    y={height - padBottom + 18}
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line
            stroke="#dfe6dc"
            strokeWidth={1}
            x1={padLeft}
            x2={width - padRight}
            y1={padTop + plotHeight}
            y2={padTop + plotHeight}
          />
        </svg>
      </div>
    </figure>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} />
      {label}
    </span>
  );
}

function EmptyChart({ title, message }: { title: string; message: string }) {
  return (
    <figure className="rounded-2xl bg-[#f5f7f2] px-4 py-5">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <p className="mt-1 text-sm text-[#718075]">{message}</p>
    </figure>
  );
}

export type RankedBar = {
  label: string;
  value: number;
  secondary?: number;
  detail?: string;
  // React key for the row. The label is a display string, so it is not a safe key
  // on its own: two rows can carry the same label whenever the label is built from
  // more than one field, such as a rep name and a region, and two people can share
  // a name. A caller that has a row id should pass it here. Omit it only when the
  // label is known to be unique, which for a database row is almost never.
  key?: string;
};

// A ranked horizontal bar list, used where the "chart" is really a comparison
// across a handful of named things (regions, reps, dealers, products) where the
// label needs to be readable. Truncating the list is deliberate: a bar chart of 60
// dealers is worse than useless, it hides the tail, so this shows the top N and
// says so.
export function RankedBars({
  rows,
  title,
  description,
  valueLabel,
  emptyMessage,
  limit = 10,
  format = "money",
}: {
  rows: RankedBar[];
  title: string;
  description?: string;
  valueLabel: string;
  emptyMessage: string;
  limit?: number;
  // Products and production are measured in units, not rupees. The formatter is a
  // parameter rather than a prop on every row because a wrong unit on an axis is
  // the single easiest chart mistake to make and the easiest to miss in review.
  format?: "money" | "count";
}) {
  const shown = rows.slice(0, limit);
  const peak = Math.max(...shown.map((row) => row.value), 1);

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-[#718075]">{valueLabel}</span>
      </figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}

      {shown.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{emptyMessage}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {shown.map((row) => (
            <li key={row.key ?? row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 tabular-nums text-[#5d6b60]">
                  {format === "money" ? "₹" : ""}
                  {formatNumber(row.value)}
                  {row.secondary ? (
                    <span className="ml-2 text-xs text-[#819083]">
                      {format === "money" ? "₹" : ""}
                      {formatNumber(row.secondary)} {format === "money" ? "open" : "input"}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#eef1ec]">
                <div
                  className="h-full rounded-full"
                  style={{ background: realized, width: `${Math.max((row.value / peak) * 100, row.value > 0 ? 2 : 0)}%` }}
                />
              </div>
              {row.detail ? <p className="mt-1 text-xs text-[#819083]">{row.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {rows.length > shown.length ? (
        <p className="mt-4 text-xs text-[#819083]">
          Showing the top {shown.length} of {rows.length}. Narrow the window to see the rest.
        </p>
      ) : null}
    </figure>
  );
}

// A single proportional bar for a two-way split, e.g. realized against pipeline for
// one region. Drawn as a proportion rather than two bars side by side so the
// question "how much of this is at risk" is answerable by looking, not by reading
// two numbers against a shared axis.
export function SplitBar({
  realized,
  pipeline,
  label,
}: {
  realized: number;
  pipeline: number;
  label: string;
}) {
  const total = realized + pipeline;
  const realizedPct = total > 0 ? (realized / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-[#5d6b60]">₹{formatNumber(total)}</span>
      </div>
      <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-[#eef1ec]">
        <div className="h-full" style={{ background: realized, width: `${realizedPct}%` }} />
        <div className="h-full" style={{ background: pipeline, width: `${100 - realizedPct}%` }} />
      </div>
      <p className="mt-1 text-xs text-[#819083]">
        {total > 0 ? `${Math.round(realizedPct)}% realized · ₹${formatNumber(pipeline)} uncommitted` : "Nothing committed yet"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut, for a part-to-whole split of a single total.
//
// A donut rather than a pie because the hole gives the total somewhere to live, which
// is the number the reader actually came for. Slices are ordered largest first and
// any slice under 4% is folded into "Other" with a legend entry that names it,
// because a 1% wedge is indistinguishable from a rendering artefact and reads as
// noise. The values stay in the tooltip, so folding is a display decision and not a
// loss of data.
export function Donut({
  slices,
  title,
  description,
  centreLabel,
}: {
  slices: Array<{ label: string; value: number; colour: string }>;
  title: string;
  description?: string;
  centreLabel?: string;
}) {
  const ordered = [...slices].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  const total = ordered.reduce((sum, slice) => sum + slice.value, 0);

  if (total <= 0) {
    return <EmptyChart message="No activity in scope to break down." title={title} />;
  }

  const small = ordered.filter((slice) => (slice.value / total) * 100 < 4);
  const large = ordered.filter((slice) => (slice.value / total) * 100 >= 4);
  const smallTotal = small.reduce((sum, slice) => sum + slice.value, 0);
  const shown = small.length > 0 ? [...large, { label: "Other", value: smallTotal, colour: "#c9d3c4" }] : large;

  const size = 200;
  const radius = 78;
  const thickness = 30;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Each arc starts where the previous one stopped, so its offset is the running
  // total of the dashes before it. Accumulated through reduce rather than a mutated
  // counter: a shared mutable across the render is what makes a second render
  // disagree with the first.
  const arcs = shown.reduce<
    Array<{ label: string; value: number; colour: string; dash: number; gap: number; offset: number }>
  >((acc, slice) => {
    const consumed = acc.reduce((sum, arc) => sum + arc.dash, 0);
    const dash = (slice.value / total) * circumference;
    acc.push({ ...slice, dash, gap: circumference - dash, offset: -consumed });
    return acc;
  }, []);

  return (
    <figure>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <svg
          aria-label={`${title}: part to whole`}
          className="h-auto w-40 shrink-0"
          role="img"
          viewBox={`0 0 ${size} ${size}`}
        >
          <g transform={`rotate(-90 ${centre} ${centre})`}>
            {arcs.map((arc) => (
              <circle
                cx={centre}
                cy={centre}
                fill="none"
                key={arc.label}
                r={radius}
                stroke={arc.colour}
                strokeDasharray={`${arc.dash} ${arc.gap}`}
                strokeDashoffset={arc.offset}
                strokeWidth={thickness}
              >
                <title>{`${arc.label} · ${formatNumber(arc.value)} (${Math.round((arc.value / total) * 100)}%)`}</title>
              </circle>
            ))}
          </g>
          <text
            fill="#334536"
            fontSize={20}
            fontWeight={600}
            textAnchor="middle"
            x={centre}
            y={centre - 2}
          >
            {centreLabel ?? formatNumber(total)}
          </text>
          <text fill={axis} fontSize={10} textAnchor="middle" x={centre} y={centre + 15}>
            total
          </text>
        </svg>
        <ul className="min-w-[180px] flex-1 space-y-2">
          {shown.map((slice) => (
            <li className="flex items-center justify-between gap-3 text-sm" key={slice.label}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.colour }} />
                <span className="truncate">{slice.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[#5d6b60]">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// A stage funnel, one row per lifecycle stage, width by order count.
//
// Horizontal bars rather than a funnel shape: a trapezoid implies each stage narrows
// because of the one above it, and here a stage can be wider than the last, which is
// exactly the "orders piled up awaiting approval" case worth seeing. Colour shifts
// along the lifecycle so a glance separates waiting from moving.
export function FunnelBars({
  rows,
  title,
  description,
}: {
  rows: Array<{ label: string; count: number; amount: number }>;
  title: string;
  description?: string;
}) {
  if (rows.length === 0) {
    return <EmptyChart message="No orders in scope." title={title} />;
  }

  const peak = Math.max(...rows.map((row) => row.count), 1);
  const palette = [amber, amber, realized, ink, ink, realized, realized, rejected];

  return (
    <figure>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}
      <ol className="mt-4 space-y-2.5">
        {rows.map((row, index) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{row.label}</span>
              <span className="shrink-0 tabular-nums text-[#5d6b60]">
                {formatNumber(row.count)} orders · ₹{formatNumber(row.amount)}
              </span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-md bg-[#eef1ec]">
              <div
                className="h-full rounded-md"
                style={{
                  background: palette[index % palette.length],
                  width: `${Math.max((row.count / peak) * 100, row.count > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// A yield line, one point per day.
//
// A line rather than bars because yield is a ratio, and bars imply the height is
// the quantity. A 0.9 that follows a 0.4 is a recovery; the same two numbers as bars
// read as two unrelated amounts. The band is drawn behind the line rather than the
// line over a grid, because the interesting comparison is the line against its own
// recent range, not against zero.
export function YieldLine({
  points,
  title,
  description,
}: {
  points: Array<{ label: string; yieldRatio: number | null }>;
  title: string;
  description?: string;
}) {
  const measured = points.filter((point) => point.yieldRatio !== null) as Array<{
    label: string;
    yieldRatio: number;
  }>;

  if (measured.length < 2) {
    return (
      <EmptyChart
        message="Yield needs at least two days with recorded material input before it can be plotted."
        title={title}
      />
    );
  }

  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 34;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const ratios = measured.map((point) => point.yieldRatio);
  const lo = Math.max(0, Math.floor(Math.min(...ratios) * 10) / 10 - 0.1);
  const hi = Math.ceil(Math.max(...ratios) * 10) / 10 + 0.1;
  const span = Math.max(hi - lo, 0.1);
  const x = (index: number) =>
    padLeft + (measured.length === 1 ? plotWidth / 2 : (plotWidth / (measured.length - 1)) * index);
  const y = (value: number) => padTop + plotHeight - ((value - lo) / span) * plotHeight;

  const line = measured.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(point.yieldRatio)}`).join(" ");
  const area = `${line} L${x(measured.length - 1)} ${padTop + plotHeight} L${x(0)} ${padTop + plotHeight} Z`;
  const labelEvery = Math.max(1, Math.ceil(measured.length / 12));
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-[#718075]">mean {mean.toFixed(2)} output per unit of input</span>
      </figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <svg
          aria-label={`${title}: daily yield ratio`}
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={`yield-fill-${measured.length}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={realized} stopOpacity={0.28} />
              <stop offset="100%" stopColor={realized} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {ticksFor(span).map((_, index) => {
            const value = lo + (span / 4) * index;
            return (
              <g key={value}>
                <line stroke={grid} strokeWidth={1} x1={padLeft} x2={width - padRight} y1={y(value)} y2={y(value)} />
                <text
                  dominantBaseline="middle"
                  fill={axis}
                  fontSize={11}
                  textAnchor="end"
                  x={padLeft - 8}
                  y={y(value)}
                >
                  {value.toFixed(2)}
                </text>
              </g>
            );
          })}

          <path d={area} fill={`url(#yield-fill-${measured.length})`} />
          <path d={line} fill="none" stroke={realized} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />

          {measured.map((point, index) => (
            <g key={point.label}>
              <circle cx={x(index)} cy={y(point.yieldRatio)} fill="#fff" r={3.5} stroke={realized} strokeWidth={2}>
                <title>{`${point.label} · yield ${point.yieldRatio.toFixed(2)} output per unit of input`}</title>
              </circle>
              {index % labelEvery === 0 || index === measured.length - 1 ? (
                <text fill={axis} fontSize={11} textAnchor="middle" x={x(index)} y={height - padBottom + 18}>
                  {point.label}
                </text>
              ) : null}
            </g>
          ))}

          <line
            stroke="#dfe6dc"
            strokeWidth={1}
            x1={padLeft}
            x2={width - padRight}
            y1={padTop + plotHeight}
            y2={padTop + plotHeight}
          />
        </svg>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// A stock-level bar per product, threshold marked.
//
// The threshold is drawn as a tick on the bar itself rather than as a second bar or a
// colour band. A product under its reorder point is the one thing this chart exists
// to surface, and a separate legend entry makes the reader compare two numbers;
// drawing the line on the same axis makes the crossing visible.
export function StockBars({
  rows,
  title,
  description,
  emptyMessage,
}: {
  rows: Array<{
    label: string;
    quantity: number;
    threshold: number;
    unit: string;
    daysSinceMovement: number | null;
  }>;
  title: string;
  description?: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <EmptyChart message={emptyMessage} title={title} />;
  }

  // Scale against the largest of quantity and threshold, not the largest quantity, or
  // a product with a high threshold and little stock draws a threshold tick off the
  // right edge of its own bar and the chart lies about the crossing.
  const peak = Math.max(...rows.flatMap((row) => [row.quantity, row.threshold]), 1);
  const ordered = [...rows].sort((a, b) => a.quantity / Math.max(a.threshold, 1) - b.quantity / Math.max(b.threshold, 1));

  return (
    <figure>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {description ? <p className="mt-1 text-xs text-[#718075]">{description}</p> : null}
      <ol className="mt-4 space-y-3">
        {ordered.map((row) => {
          const low = row.quantity <= row.threshold;
          return (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 tabular-nums text-[#5d6b60]">
                  {formatNumber(row.quantity)} {row.unit}
                  <span className="ml-2 text-xs text-[#819083]">reorder at {formatNumber(row.threshold)}</span>
                </span>
              </div>
              <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full bg-[#eef1ec]">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: low ? amber : realized,
                    width: `${Math.max((row.quantity / peak) * 100, row.quantity > 0 ? 2 : 0)}%`,
                  }}
                />
                <span
                  aria-hidden
                  className="absolute top-0 h-full w-0.5 bg-[#334536]"
                  style={{ left: `${Math.min((row.threshold / peak) * 100, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-[#819083]">
                {low ? "Below reorder point" : "Healthy"}
                {row.daysSinceMovement === null
                  ? " · no recorded movement"
                  : row.daysSinceMovement >= 60
                    ? " · no movement in 60+ days"
                    : ` · last moved ${row.daysSinceMovement}d ago`}
              </p>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
