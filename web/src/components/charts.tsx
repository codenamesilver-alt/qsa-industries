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
// So: two components, one for time series and one for ranked bars. Both are server
// components with no client JS, which matters because every portal page here is a
// server component and a client chart library would force a "use client" boundary
// into the middle of them.

const axis = "#819083";
const grid = "#eef1ec";
const realized = "#6f8c3b";
const pipeline = "#a9d3db";
const rejected = "#f2b8ad";

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
}: {
  points: TrendPoint[];
  title: string;
  description?: string;
}) {
  if (points.length === 0) {
    return (
      <figure className="rounded-2xl bg-[#f5f7f2] px-4 py-5">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <p className="mt-1 text-sm text-[#718075]">No orders fall in this window yet.</p>
      </figure>
    );
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

  const ticks = [0, top / 4, top / 2, (top * 3) / 4, top];

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
          className="h-auto w-full min-w-[560px]"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {ticks.map((tick) => (
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
                {shortMoney(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const centre = padLeft + band * index + band / 2;
            const realizedHeight = Math.max(point.realized > 0 ? 2 : 0, padTop + plotHeight - y(point.realized));
            const pipelineHeight = Math.max(point.pipeline > 0 ? 2 : 0, padTop + plotHeight - y(point.pipeline));
            return (
              <g key={point.label}>
                <title>{`${point.label} · realized ₹${formatNumber(point.realized)} · pipeline ₹${formatNumber(
                  point.pipeline,
                )}${point.rejected > 0 ? ` · rejected ₹${formatNumber(point.rejected)}` : ""}`}</title>
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
                <text
                  fill={axis}
                  fontSize={11}
                  textAnchor="middle"
                  x={centre}
                  y={height - padBottom + 18}
                >
                  {point.label}
                </text>
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

export type RankedBar = {
  label: string;
  value: number;
  secondary?: number;
  detail?: string;
};

// A ranked horizontal bar list, used where the "chart" is really a comparison
// across a handful of named things (regions, reps, dealers) where the label needs
// to be readable. Truncating the list is deliberate: a bar chart of 60 dealers is
// worse than useless, it hides the tail, so this shows the top N and says so.
export function RankedBars({
  rows,
  title,
  description,
  valueLabel,
  emptyMessage,
  limit = 10,
}: {
  rows: RankedBar[];
  title: string;
  description?: string;
  valueLabel: string;
  emptyMessage: string;
  limit?: number;
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
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 tabular-nums text-[#5d6b60]">
                  ₹{formatNumber(row.value)}
                  {row.secondary ? (
                    <span className="ml-2 text-xs text-[#819083]">₹{formatNumber(row.secondary)} open</span>
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
