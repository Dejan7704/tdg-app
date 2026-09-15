"use client";

import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type LineChartPoint = {
  year: number;
  value: number | null;
};

export type LineChartFormat = "placering" | "decimal1" | "integer" | "sek";

function formatValue(v: number, format: LineChartFormat): string {
  switch (format) {
    case "placering":
      return `${Math.round(v)}:a`;
    case "decimal1":
      return v.toFixed(1);
    case "integer":
      return String(Math.round(v));
    case "sek":
      return `${Math.round(v).toLocaleString("sv-SE")} kr`;
  }
}

export const WIDTH = 720;
export const PADDING_LEFT = 44;
export const PADDING_RIGHT = 44;
export const PADDING_TOP = 16;
export const PADDING_BOTTOM = 28;

type Point = { x: number; y: number };

/** Bygger en mjuk kurva (Catmull-Rom -> kubiska Bezier-segment) genom punkterna. */
function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Grupperar punkter (redan sorterade på år) i segment som bryts där data saknas. */
function buildSegments<T extends { value: number | null }>(
  data: T[],
  xFor: (d: T, i: number) => number,
  yFor: (v: number) => number
): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  data.forEach((d, i) => {
    if (d.value == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xFor(d, i), y: yFor(d.value) });
  });
  if (current.length) segments.push(current);
  return segments;
}

function yearDomain(seriesList: LineChartPoint[][]): { minYear: number; maxYear: number } {
  const years = seriesList.flatMap((s) => s.map((d) => d.year));
  return { minYear: Math.min(...years), maxYear: Math.max(...years) };
}

export function yearTicks(minYear: number, maxYear: number): number[] {
  const span = maxYear - minYear;
  if (span <= 0) return [minYear];
  const step = Math.max(1, Math.ceil(span / 10));
  const ticks: number[] = [];
  for (let y = minYear; y < maxYear; y += step) ticks.push(y);
  ticks.push(maxYear);
  return ticks;
}

function areaPath(line: string, seg: Point[], bottomY: number): string {
  const first = seg[0];
  const last = seg[seg.length - 1];
  return `${line} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
}

/** Grov uppskattning av textbredd i pixlar (ingen canvas-mätning tillgänglig
 * i SVG utan ref-trick) - används för att ge axlarna tillräckligt med
 * vänster-/högerutrymme åt breda etiketter som "21 600 kr" (annars klipps
 * siffrorna av mot diagrammets kant, se buggen med kronbelopp 2026-09-15). */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

// ---------- Enkelserie-diagram (t.ex. antal betting-vinster per år) ----------

type LineChartProps = {
  data: LineChartPoint[];
  color?: string;
  /** Lägre värde = bättre (t.ex. placering). Ritar 1:an högst upp i diagrammet. */
  invert?: boolean;
  height?: number;
  format?: LineChartFormat;
};

export function LineChart({ data, color = "#065f46", invert = false, height = 220, format = "integer" }: LineChartProps) {
  const uid = useId();
  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  if (values.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-sm text-stone-400">Ingen data ännu.</div>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;

  const { minYear, maxYear } = yearDomain([data]);
  const innerW = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const innerH = height - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = PADDING_TOP + innerH;

  const xFor = (d: LineChartPoint) =>
    PADDING_LEFT + (maxYear === minYear ? innerW / 2 : ((d.year - minYear) / (maxYear - minYear)) * innerW);
  const yFor = (v: number) => {
    const t = (v - min) / (max - min);
    return PADDING_TOP + (invert ? t : 1 - t) * innerH;
  };

  const segments = buildSegments(data, xFor, yFor);
  const yTicks = [rawMin, (rawMin + rawMax) / 2, rawMax];
  const gradId = `lc-grad-${uid}`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label="Linjediagram">
      <defs>
        <linearGradient id={gradId} x1={0} y1={PADDING_TOP} x2={0} y2={bottomY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={yFor(t)} y2={yFor(t)} stroke="#e7e5e4" strokeWidth={1} />
          <text x={PADDING_LEFT - 8} y={yFor(t) + 3} textAnchor="end" fontSize={10} fill="#a8a29e">
            {formatValue(t, format)}
          </text>
        </g>
      ))}

      {segments.map((seg, i) => (
        <path key={`area-${i}`} d={areaPath(smoothPath(seg), seg, bottomY)} fill={`url(#${gradId})`} stroke="none" />
      ))}
      {segments.map((seg, i) => (
        <path key={`line-${i}`} d={smoothPath(seg)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {data.map((d, i) =>
        d.value == null ? null : (
          <circle key={i} cx={xFor(d)} cy={yFor(d.value)} r={3} fill={color}>
            <title>{`${d.year}: ${formatValue(d.value, format)}`}</title>
          </circle>
        )
      )}

      {yearTicks(minYear, maxYear).map((y) => (
        <text key={y} x={xFor({ year: y, value: 0 })} y={height - PADDING_BOTTOM + 16} textAnchor="middle" fontSize={10} fill="#a8a29e">
          {y}
        </text>
      ))}
    </svg>
  );
}

// ---------- Diagram med två serier på varsin y-axel (t.ex. placering + snitt nettoslag) ----------

type AxisSeries = {
  data: LineChartPoint[];
  color: string;
  label: string;
  invert?: boolean;
  format: LineChartFormat;
};

type DualAxisLineChartProps = {
  left: AxisSeries;
  right: AxisSeries;
  height?: number;
  /** Tvinga ett fast år-spann (t.ex. 2004–2025) så x-axeln linjerar med andra diagram på samma sida. */
  yearDomain?: { minYear: number; maxYear: number };
  /** År spelaren inte deltog (se getPlayerMissedYears) - markeras med ett ljust streck och en tydlig, fetstilad årsetikett. */
  missedYears?: number[];
};

// Delad av DualAxisLineChart och StackedBarChart så de två diagrammen märker
// missade år på exakt samma sätt (samma bandbredd, samma etikettfärg).
export const MISSED_BAND_WIDTH = 14;
export const MISSED_TICK_COLOR = "#78716c"; // stone-500, mörkare än den vanliga axel-grå (#a8a29e)

/** Slår ihop de vanliga år-ticksen med eventuella missade år, så ett missat år alltid syns som siffra på x-axeln (annars kan tick-utglesningen råka hoppa över just det året). */
export function mergeYearTicks(minYear: number, maxYear: number, missedYears: number[] = []): number[] {
  const relevant = missedYears.filter((y) => y >= minYear && y <= maxYear);
  return Array.from(new Set([...yearTicks(minYear, maxYear), ...relevant])).sort((a, b) => a - b);
}

function buildScale(series: AxisSeries, innerH: number) {
  const values = series.data.map((d) => d.value).filter((v): v is number => v != null);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;
  const invert = !!series.invert;
  return {
    rawMin,
    rawMax,
    yFor: (v: number) => {
      const t = (v - min) / (max - min);
      return PADDING_TOP + (invert ? t : 1 - t) * innerH;
    },
  };
}

// Fontstorlek/vikt för axelvärdena (kronbelopp, placering, snittslag) - gjorda
// fetstilade och lite större 2026-09-15 på Davids begäran, så de syns
// tydligare mot den tunna rutnätslinjen.
const AXIS_VALUE_FONT_SIZE = 11;
const AXIS_VALUE_FONT_WEIGHT = 700;

export function DualAxisLineChart({ left, right, height = 260, yearDomain: forcedDomain, missedYears = [] }: DualAxisLineChartProps) {
  const uid = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const innerH = height - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = PADDING_TOP + innerH;

  const { minYear, maxYear } = forcedDomain ?? yearDomain([left.data, right.data]);

  const leftScale = buildScale(left, innerH);
  const rightScale = buildScale(right, innerH);

  const leftTicks = [leftScale.rawMin, (leftScale.rawMin + leftScale.rawMax) / 2, leftScale.rawMax];
  const rightTicks = [rightScale.rawMin, (rightScale.rawMin + rightScale.rawMax) / 2, rightScale.rawMax];

  // Dynamisk vänster-/högerpadding: beräknad utifrån de faktiska
  // axeletiketternas textbredd (t.ex. "21 600 kr" är mycket bredare än
  // "22:a"), så breda kronbelopp inte klipps av mot diagrammets kant.
  const padLeft = Math.max(
    PADDING_LEFT,
    Math.max(...leftTicks.map((t) => estimateTextWidth(formatValue(t, left.format), AXIS_VALUE_FONT_SIZE))) + 16
  );
  const padRight = Math.max(
    PADDING_RIGHT,
    Math.max(...rightTicks.map((t) => estimateTextWidth(formatValue(t, right.format), AXIS_VALUE_FONT_SIZE))) + 16
  );
  const innerW = WIDTH - padLeft - padRight;

  const xForYear = (year: number) =>
    padLeft + (maxYear === minYear ? innerW / 2 : ((year - minYear) / (maxYear - minYear)) * innerW);
  const xFor = (d: LineChartPoint) => xForYear(d.year);

  const leftSegments = buildSegments(left.data, xFor, leftScale.yFor);
  const rightSegments = buildSegments(right.data, xFor, rightScale.yFor);

  const gradLeft = `lc-grad-${uid}-l`;
  const gradRight = `lc-grad-${uid}-r`;

  // --- Interaktiv "scrubbing"-linje (mus/finger) -----------------------
  // Räknar om en klient-x-koordinat (från pointer-eventet) till närmaste år
  // i diagrammets skala, oavsett hur diagrammet faktiskt är skalat på
  // skärmen (viewBox kan vara nedskalad från 720px till t.ex. mobilbredd).
  function yearFromClientX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const viewBoxX = ((clientX - rect.left) / rect.width) * WIDTH;
    const t = innerW === 0 ? 0 : (viewBoxX - padLeft) / innerW;
    const clampedT = Math.min(1, Math.max(0, t));
    return Math.round(minYear + clampedT * (maxYear - minYear));
  }

  function handlePointerMove(e: ReactPointerEvent<SVGRectElement>) {
    setHoverYear(yearFromClientX(e.clientX));
  }
  function handlePointerLeave() {
    setHoverYear(null);
  }

  const hoverX = hoverYear != null ? xForYear(hoverYear) : null;
  const hoverLeftPoint = hoverYear != null ? left.data.find((d) => d.year === hoverYear) : undefined;
  const hoverRightPoint = hoverYear != null ? right.data.find((d) => d.year === hoverYear) : undefined;
  const hoverLeftVal = hoverLeftPoint?.value ?? null;
  const hoverRightVal = hoverRightPoint?.value ?? null;
  const hoverLeftY = hoverLeftVal != null ? leftScale.yFor(hoverLeftVal) : null;
  const hoverRightY = hoverRightVal != null ? rightScale.yFor(hoverRightVal) : null;

  // Etikettens innehåll byggs som separata segment (istället för en enda
  // sträng) så varje serie kan färgas i sin egen kurvfärg i pop-up-rutan -
  // neutralt grått bara för årtalet och skiljetecknen mellan serierna.
  const NEUTRAL_LABEL_COLOR = "#57534e"; // stone-600
  type LabelSegment = { text: string; color: string };
  let hoverLabel: { x: number; y: number; segments: LabelSegment[]; anchor: "start" | "middle" | "end" } | null =
    null;
  if (hoverYear != null && hoverX != null) {
    const candidateYs = [hoverLeftY, hoverRightY].filter((y): y is number => y != null);
    const topY = candidateYs.length ? Math.min(...candidateYs) : PADDING_TOP + 10;
    const labelY = Math.max(PADDING_TOP + 10, topY - 14);
    const valueSegments: LabelSegment[] = [];
    if (hoverLeftVal != null) {
      valueSegments.push({ text: `${left.label}: ${formatValue(hoverLeftVal, left.format)}`, color: left.color });
    }
    if (hoverRightVal != null) {
      valueSegments.push({ text: `${right.label}: ${formatValue(hoverRightVal, right.format)}`, color: right.color });
    }
    const segments: LabelSegment[] = valueSegments.length
      ? [
          { text: `${hoverYear}  ·  `, color: NEUTRAL_LABEL_COLOR },
          ...valueSegments.flatMap((seg, i) =>
            i === 0 ? [seg] : [{ text: "   ·   ", color: NEUTRAL_LABEL_COLOR }, seg]
          ),
        ]
      : [{ text: `${hoverYear}: Ingen data`, color: NEUTRAL_LABEL_COLOR }];
    const anchor = hoverX < padLeft + 100 ? "start" : hoverX > WIDTH - padRight - 100 ? "end" : "middle";
    hoverLabel = { x: hoverX, y: labelY, segments, anchor };
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label="Linjediagram med två axlar"
      >
        <defs>
          <linearGradient id={gradLeft} x1={0} y1={PADDING_TOP} x2={0} y2={bottomY} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={left.color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={left.color} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={gradRight} x1={0} y1={PADDING_TOP} x2={0} y2={bottomY} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={right.color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={right.color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Missade upplagor - ett ljust band över hela diagrammets höjd, så det syns tydligt vilket år spelaren inte var med. */}
        {missedYears
          .filter((y) => y >= minYear && y <= maxYear)
          .map((y) => (
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

        {/* Mittlinje för referens - visar inte siffror, bara ett neutralt rutnät. */}
        {[0, 0.5, 1].map((t, i) => (
          <line key={i} x1={padLeft} x2={WIDTH - padRight} y1={PADDING_TOP + t * innerH} y2={PADDING_TOP + t * innerH} stroke="#e7e5e4" strokeWidth={1} />
        ))}

        {leftTicks.map((t, i) => (
          <text
            key={`lt-${i}`}
            x={padLeft - 8}
            y={leftScale.yFor(t) + 4}
            textAnchor="end"
            fontSize={AXIS_VALUE_FONT_SIZE}
            fontWeight={AXIS_VALUE_FONT_WEIGHT}
            fill={left.color}
          >
            {formatValue(t, left.format)}
          </text>
        ))}
        {rightTicks.map((t, i) => (
          <text
            key={`rt-${i}`}
            x={WIDTH - padRight + 8}
            y={rightScale.yFor(t) + 4}
            textAnchor="start"
            fontSize={AXIS_VALUE_FONT_SIZE}
            fontWeight={AXIS_VALUE_FONT_WEIGHT}
            fill={right.color}
          >
            {formatValue(t, right.format)}
          </text>
        ))}

        {rightSegments.map((seg, i) => (
          <path key={`ra-${i}`} d={areaPath(smoothPath(seg), seg, bottomY)} fill={`url(#${gradRight})`} stroke="none" />
        ))}
        {leftSegments.map((seg, i) => (
          <path key={`la-${i}`} d={areaPath(smoothPath(seg), seg, bottomY)} fill={`url(#${gradLeft})`} stroke="none" />
        ))}

        {rightSegments.map((seg, i) => (
          <path key={`rl-${i}`} d={smoothPath(seg)} fill="none" stroke={right.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {leftSegments.map((seg, i) => (
          <path key={`ll-${i}`} d={smoothPath(seg)} fill="none" stroke={left.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {right.data.map((d, i) =>
          d.value == null ? null : (
            <circle key={`rc-${i}`} cx={xFor(d)} cy={rightScale.yFor(d.value)} r={3} fill={right.color}>
              <title>{`${d.year} · ${right.label}: ${formatValue(d.value, right.format)}`}</title>
            </circle>
          )
        )}
        {left.data.map((d, i) =>
          d.value == null ? null : (
            <circle key={`lc-${i}`} cx={xFor(d)} cy={leftScale.yFor(d.value)} r={3} fill={left.color}>
              <title>{`${d.year} · ${left.label}: ${formatValue(d.value, left.format)}`}</title>
            </circle>
          )
        )}

        {mergeYearTicks(minYear, maxYear, missedYears).map((y) => {
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

        {/* Scrubbing-linje: dämpar (mörkar ner) allt till höger om markören,
            så vänster sida (redan "passerad") känns ljusare/mer aktiv. */}
        {hoverX != null && (
          <g pointerEvents="none">
            <rect
              x={hoverX}
              y={PADDING_TOP}
              width={Math.max(0, WIDTH - padRight - hoverX)}
              height={innerH}
              fill="#1c1917"
              fillOpacity={0.05}
            />
            <line x1={hoverX} x2={hoverX} y1={PADDING_TOP} y2={bottomY} stroke="#78716c" strokeWidth={1} />
            {hoverLeftY != null && (
              <circle cx={hoverX} cy={hoverLeftY} r={4.5} fill={left.color} stroke="white" strokeWidth={1.5} />
            )}
            {hoverRightY != null && (
              <circle cx={hoverX} cy={hoverRightY} r={4.5} fill={right.color} stroke="white" strokeWidth={1.5} />
            )}
          </g>
        )}

        {/* Flytande etikett rakt ovanför den för tillfället högsta kurvpunkten -
            uppdaterar löpande summorna för det år man för muspekaren/fingret över. */}
        {hoverLabel && (
          <g pointerEvents="none">
            {(() => {
              const fullText = hoverLabel.segments.map((s) => s.text).join("");
              const bgWidth = estimateTextWidth(fullText, AXIS_VALUE_FONT_SIZE) + 20;
              const bgHeight = 20;
              let bgX =
                hoverLabel.anchor === "middle"
                  ? hoverLabel.x - bgWidth / 2
                  : hoverLabel.anchor === "start"
                    ? hoverLabel.x - 6
                    : hoverLabel.x - bgWidth + 6;
              bgX = Math.min(WIDTH - bgWidth - 2, Math.max(2, bgX));
              return (
                <>
                  <rect
                    x={bgX}
                    y={hoverLabel.y - 14}
                    width={bgWidth}
                    height={bgHeight}
                    rx={5}
                    fill="white"
                    fillOpacity={0.96}
                    stroke="#e7e5e4"
                  />
                  <text
                    x={bgX + bgWidth / 2}
                    y={hoverLabel.y}
                    textAnchor="middle"
                    fontSize={AXIS_VALUE_FONT_SIZE}
                    fontWeight={AXIS_VALUE_FONT_WEIGHT}
                    fill="#292524"
                  >
                    {hoverLabel.segments.map((seg, i) => (
                      <tspan key={i} fill={seg.color}>
                        {seg.text}
                      </tspan>
                    ))}
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* Osynlig fångstyta för mus/pekare/finger, ovanpå allt annat. */}
        <rect
          x={padLeft}
          y={PADDING_TOP}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ touchAction: "none", cursor: "crosshair" }}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        />
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5" style={{ color: left.color }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: left.color }} />
          {left.label}
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: right.color }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: right.color }} />
          {right.label}
        </span>
        {missedYears.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-normal text-stone-500">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: MISSED_TICK_COLOR, opacity: 0.35 }} />
            Deltog inte
          </span>
        )}
      </div>
    </div>
  );
}
