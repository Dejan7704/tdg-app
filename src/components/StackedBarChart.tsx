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
  AXIS_VALUE_FONT_SIZE,
  AXIS_VALUE_FONT_WEIGHT,
  AXIS_YEAR_FONT_SIZE,
  formatValue,
  smoothPath,
  type Point,
} from "@/components/LineChart";

/** Grov uppskattning av textbredd i pixlar (samma metod som i LineChart.tsx) -
 * används för att räkna ut hur mycket extra högermarginal den ackumulerade
 * kronsumman/antalet på höger axel behöver. */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

// Neutral, mörk färg för den ackumulerade kurvan - avsiktligt inte grön/orange
// (som de betting-/utläggsfärgade diagrammen ovanför) så den inte konkurrerar
// med kategoristaplarnas färger, men syns tydligt ovanpå dem.
const CUMULATIVE_LINE_COLOR = "#292524"; // stone-800

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

  const innerH = height - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = PADDING_TOP + innerH;

  const totals = data.map((d) => categories.reduce((sum, c) => sum + (d.values[c.key] ?? 0), 0));
  const rawMax = Math.max(1, ...totals);
  const niceMax = Math.ceil(rawMax);
  const pxPerUnit = innerH / niceMax;

  // Ackumulerad kurva (höger axel): löpande summa av totalt antal vinster,
  // år för år över hela diagrammets spann.
  const cumulative = totals.reduce<number[]>((acc, t) => {
    acc.push((acc[acc.length - 1] ?? 0) + t);
    return acc;
  }, []);
  const cumulativeMax = Math.max(1, ...cumulative);
  const cumulativePxPerUnit = innerH / cumulativeMax;
  const yForCumulative = (v: number) => bottomY - v * cumulativePxPerUnit;
  const cumulativeTickStep = cumulativeMax <= 4 ? 1 : Math.ceil(cumulativeMax / 3);
  const cumulativeTicks: number[] = [0];
  for (let v = cumulativeTickStep; v < cumulativeMax; v += cumulativeTickStep) cumulativeTicks.push(v);
  if (cumulativeTicks[cumulativeTicks.length - 1] !== cumulativeMax) cumulativeTicks.push(cumulativeMax);

  // Provisorisk innerW (med bas-paddingen) bara för att räkna fram stapelbredden -
  // stapelbredden i sin tur avgör hur mycket den sista stapeln (vid maxYear)
  // sticker ut förbi själva plotytan, vilket högermarginalen måste kompensera
  // för (annars hamnar de högra axelsiffrorna delvis inne i stapeln, se bugg
  // 2026-09-18).
  const provisionalInnerW = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const yearCount = Math.max(1, domain.maxYear - domain.minYear + 1);
  const provisionalStepWidth = yearCount > 1 ? provisionalInnerW / (yearCount - 1) : provisionalInnerW;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(4, provisionalStepWidth - SEGMENT_GAP * 2));

  // Dynamisk högermarginal: bas-paddingen, plus stapelns halva bredd (den
  // sista stapelns överhäng förbi maxYear-positionen), plus utrymme för den
  // bredaste ackumulerade axeletiketten (t.ex. "37").
  const padRight = Math.max(
    PADDING_RIGHT,
    barWidth / 2 + 8 + Math.max(...cumulativeTicks.map((t) => estimateTextWidth(formatValue(t, "integer"), AXIS_VALUE_FONT_SIZE))) + 8
  );
  const innerW = WIDTH - PADDING_LEFT - padRight;

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
              <line x1={PADDING_LEFT} x2={WIDTH - padRight} y1={y} y2={y} stroke="#e7e5e4" strokeWidth={1} />
              <text
                x={PADDING_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={AXIS_VALUE_FONT_SIZE}
                fontWeight={AXIS_VALUE_FONT_WEIGHT}
                fill="#78716c"
              >
                {t}
              </text>
            </g>
          );
        })}
        {cumulativeTicks.map((t, i) => (
          <text
            key={`ct-${i}`}
            x={WIDTH - padRight + barWidth / 2 + 8}
            y={yForCumulative(t) + 4}
            textAnchor="start"
            fontSize={AXIS_VALUE_FONT_SIZE}
            fontWeight={AXIS_VALUE_FONT_WEIGHT}
            fill={CUMULATIVE_LINE_COLOR}
          >
            {formatValue(t, "integer")}
          </text>
        ))}

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

        {/* Ackumulerad kurva (höger axel) - ritad ovanpå staplarna, ofylld och i en
            neutral mörk färg så den syns tydligt utan att konkurrera med
            kategoristaplarnas färger. */}
        <path
          d={smoothPath(bars.map((bar, i): Point => ({ x: xForYear(bar.year), y: yForCumulative(cumulative[i]) })))}
          fill="none"
          stroke={CUMULATIVE_LINE_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {bars.map((bar, i) => (
          <circle key={`cum-${bar.year}`} cx={xForYear(bar.year)} cy={yForCumulative(cumulative[i])} r={2.5} fill={CUMULATIVE_LINE_COLOR}>
            <title>{`${bar.year} · Ackumulerat: ${cumulative[i]}`}</title>
          </circle>
        ))}

        {mergeYearTicks(domain.minYear, domain.maxYear, missedYears).map((y) => {
          const missed = missedYears.includes(y);
          return (
            <text
              key={y}
              x={xForYear(y)}
              y={height - PADDING_BOTTOM + 16}
              textAnchor="middle"
              fontSize={AXIS_YEAR_FONT_SIZE}
              fontWeight={missed ? 700 : 500}
              fill={missed ? MISSED_TICK_COLOR : "#78716c"}
            >
              {y}
            </text>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-sm font-semibold text-stone-600">
        {categories.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5" style={{ color: c.color }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
            {c.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5" style={{ color: CUMULATIVE_LINE_COLOR }}>
          <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: CUMULATIVE_LINE_COLOR }} />
          Ackumulerat totalt
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-normal text-stone-500">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: MISSED_TICK_COLOR, opacity: 0.35 }} />
          Deltog inte
        </span>
      </div>
    </div>
  );
}
