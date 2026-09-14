"use client";

import { useId } from "react";
import {
  WIDTH,
  PADDING_LEFT,
  PADDING_RIGHT,
  PADDING_TOP,
  PADDING_BOTTOM,
  mergeYearTicks,
  MISSED_BAND_WIDTH,
  MISSED_TICK_COLOR,
} from "@/components/LineChart";

export type StackedBarPoint = {
  year: number;
  values: Record<string, number>;
  /** Deltog spelaren i den här upplagan alls? Skiljer "missade upplagan" från "deltog men vann inget". */
  participated?: boolean;
};
export type StackedBarCategory = { key: string; label: string; color: string };

type StackedBarChartProps = {
  data: StackedBarPoint[];
  categories: StackedBarCategory[];
  /** Tvinga samma år-spann som ett annat diagram på sidan (se DualAxisLineChart). */
  yearDomain?: { minYear: number; maxYear: number };
  height?: number;
};

const MAX_BAR_WIDTH = 24; // mark-spec: staplar blir aldrig tjockare än så
const SEGMENT_GAP = 2; // 2px "surface gap" mellan staplade segment
const CORNER_RADIUS = 4; // rundad topp på det översta segmentet, fyrkantig botten mot baslinjen
// Samma avtoning som areafyllningen i DualAxisLineChart ovanför - opak närmast
// toppen av respektive segment, helt transparent längst ner.
const FILL_TOP_OPACITY = 0.85;
const FILL_BOTTOM_OPACITY = 0.12;
const MISSED_MARKER_WIDTH = 10;
const MISSED_MARKER_HEIGHT = 3;

/** Rektangel med rundade hörn bara upptill (nedtill fyrkantig mot baslinjen, per mark-spec). */
function roundedTopRectPath(x: number, y: number, width: number, height: number, r: number): string {
  if (height <= 0 || width <= 0) return "";
  const radius = Math.max(0, Math.min(r, height, width / 2));
  if (radius < 0.5) {
    return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
  }
  return `M ${x} ${y + radius}
    A ${radius} ${radius} 0 0 1 ${x + radius} ${y}
    L ${x + width - radius} ${y}
    A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}
    L ${x + width} ${y + height}
    L ${x} ${y + height}
    Z`;
}

function squareRectPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0 || width <= 0) return "";
  return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
}

export function StackedBarChart({ data, categories, yearDomain, height = 260 }: StackedBarChartProps) {
  const uid = useId();
  const domain =
    yearDomain ?? {
      minYear: Math.min(...data.map((d) => d.year)),
      maxYear: Math.max(...data.map((d) => d.year)),
    };

  const innerW = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const innerH = height - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = PADDING_TOP + innerH;

  const totals = data.map((d) => categories.reduce((sum, c) => sum + (d.values[c.key] ?? 0), 0));
  const rawMax = Math.max(1, ...totals);
  const niceMax = Math.ceil(rawMax);
  const pxPerUnit = innerH / niceMax;

  const yearCount = Math.max(1, domain.maxYear - domain.minYear + 1);
  const stepWidth = yearCount > 1 ? innerW / (yearCount - 1) : innerW;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(4, stepWidth - SEGMENT_GAP * 2));

  const xForYear = (year: number) =>
    PADDING_LEFT +
    (domain.maxYear === domain.minYear ? innerW / 2 : ((year - domain.minYear) / (domain.maxYear - domain.minYear)) * innerW);

  const tickStep = niceMax <= 4 ? 1 : Math.ceil(niceMax / 4);
  const yTicks: number[] = [];
  for (let v = 0; v <= niceMax; v += tickStep) yTicks.push(v);
  if (yTicks[yTicks.length - 1] !== niceMax) yTicks.push(niceMax);

  // Alla (år, kategori)-segment som faktiskt ska rita en stapel, så vi kan
  // bygga en gradient-def per segment (måste vara kända innan <defs> renderas).
  const bars = data.map((d) => {
    const segs = categories.map((c) => ({ ...c, value: d.values[c.key] ?? 0 })).filter((s) => s.value > 0);
    let cursorY = bottomY;
    const placed = segs.map((s, i) => {
      const rawHeight = s.value * pxPerUnit;
      const isFirst = i === 0; // närmast baslinjen
      const isLast = i === segs.length - 1; // överst i stapeln
      const gapBottom = isFirst ? 0 : SEGMENT_GAP / 2;
      const gapTop = isLast ? 0 : SEGMENT_GAP / 2;
      const segTop = cursorY - rawHeight + gapTop;
      const segHeight = Math.max(0, rawHeight - gapTop - gapBottom);
      cursorY -= rawHeight;
      return { ...s, isLast, segTop, segHeight, gradId: `sb-grad-${uid}-${d.year}-${s.key}` };
    });
    return { year: d.year, participated: d.participated !== false, segs: placed };
  });

  const missedYears = bars.filter((b) => !b.participated).map((b) => b.year);

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label="Stapeldiagram per kategori">
        <defs>
          {bars.flatMap((bar) =>
            bar.segs.map((s) => (
              <linearGradient
                key={s.gradId}
                id={s.gradId}
                x1={0}
                y1={s.segTop}
                x2={0}
                y2={s.segTop + s.segHeight}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={FILL_TOP_OPACITY} />
                <stop offset="100%" stopColor={s.color} stopOpacity={FILL_BOTTOM_OPACITY} />
              </linearGradient>
            ))
          )}
        </defs>

        {/* Missade upplagor - samma ljusa band som i DualAxisLineChart ovanför, så det syns tydligt vilket år som gäller. */}
        {missedYears.map((y) => (
          <rect
            key={`missed-${y}`}
            x={xForYear(y) - MISSED_BAND_WIDTH / 2}
            y={PADDING_TOP}
            width={MISSED_BAND_WIDTH}
            height={innerH}
            fill="#78716c"
            fillOpacity={0.08}
          >
            <title>{`${y}: Deltog inte`}</title>
          </rect>
        ))}

        {yTicks.map((t, i) => {
          const y = bottomY - t * pxPerUnit;
          return (
            <g key={i}>
              <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={y} y2={y} stroke="#e7e5e4" strokeWidth={1} />
              <text x={PADDING_LEFT - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#a8a29e">
                {t}
              </text>
            </g>
          );
        })}

        {bars.map((bar) => {
          const cx = xForYear(bar.year);
          const x = cx - barWidth / 2;
          return (
            <g key={bar.year}>
              {bar.segs.map((s) => {
                const path = s.isLast
                  ? roundedTopRectPath(x, s.segTop, barWidth, s.segHeight, CORNER_RADIUS)
                  : squareRectPath(x, s.segTop, barWidth, s.segHeight);
                return (
                  <path key={s.key} d={path} fill={`url(#${s.gradId})`}>
                    <title>{`${bar.year} · ${s.label}: ${s.value}`}</title>
                  </path>
                );
              })}
              {!bar.participated && (
                <rect
                  x={cx - MISSED_MARKER_WIDTH / 2}
                  y={bottomY - MISSED_MARKER_HEIGHT / 2}
                  width={MISSED_MARKER_WIDTH}
                  height={MISSED_MARKER_HEIGHT}
                  rx={MISSED_MARKER_HEIGHT / 2}
                  fill="#c3c2b7"
                >
                  <title>{`${bar.year}: Deltog inte`}</title>
                </rect>
              )}
            </g>
          );
        })}

        {mergeYearTicks(domain.minYear, domain.maxYear, missedYears).map((y) => {
          const missed = missedYears.includes(y);
          return (
            <text
              key={y}
              x={xForYear(y)}
              y={height - PADDING_BOTTOM + 16}
              textAnchor="middle"
              fontSize={10}
              fontWeight={missed ? 700 : 400}
              fill={missed ? MISSED_TICK_COLOR : "#a8a29e"}
            >
              {y}
            </text>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-stone-500">
        {categories.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
            {c.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-2.5 rounded-full bg-stone-300" />
          Deltog inte
        </span>
      </div>
    </div>
  );
}
