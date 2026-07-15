"use client";

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ExtremaPoint } from "@/lib/extremaStats";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

interface SineCurvePoint {
  timeS: number;
  valueCm: number;
}

interface ManualMarkChartProps {
  points: ExtremaPoint[];
  sineCurve?: SineCurvePoint[] | null;
  /** "compact" is a glance-only live-feedback strip while marking — no axes/tooltip/legend, just "does this look like a wave yet". "full" is the post-marking summary chart. */
  variant?: "compact" | "full";
}

const CREST_COLOR = "#16a34a";
const TROUGH_COLOR = "#2563eb";
const SINE_COLOR = "#9ca3af";
const LINE_COLOR = "#93c5fd";

/** Crest/trough are distinguished by shape (triangle up/down) as well as color, so the distinction still reads for colorblind users. */
function ExtremaDot(props: { cx?: number; cy?: number; payload?: ExtremaPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) {
    return null;
  }
  const isCrest = payload.type === "crest";
  const color = isCrest ? CREST_COLOR : TROUGH_COLOR;
  const r = 5;
  const points = isCrest
    ? `${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`
    : `${cx},${cy + r} ${cx - r},${cy - r} ${cx + r},${cy - r}`;
  return <polygon points={points} fill={color} stroke="white" strokeWidth={1} />;
}

/**
 * Standalone chart for the manual-mark tool: takes plain crest/trough points
 * directly, deliberately NOT reusing ElevationChart.tsx — that component's
 * props are keyed by MeasurementPoint (pixel/calibration data this page must
 * not depend on).
 *
 * Layered as a ComposedChart with two independently-sampled Line series (the
 * marked points, sparse and irregular; the optional sine fit curve, dense
 * and regular) — recharts supports per-Line `data` overrides for exactly
 * this "two series on different x-grids" case.
 */
export default function ManualMarkChart({ points, sineCurve, variant = "full" }: ManualMarkChartProps) {
  const { t } = useLanguage();
  const isCompact = variant === "compact";
  const sortedPoints = [...points].sort((a, b) => a.timeS - b.timeS);
  const hasSineCurve = Boolean(sineCurve && sineCurve.length > 0);

  return (
    <div className="flex flex-col gap-2">
      {!isCompact && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="5,0 0,10 10,10" fill={CREST_COLOR} />
            </svg>
            {t("manualMark.crest")}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="5,10 0,0 10,0" fill={TROUGH_COLOR} />
            </svg>
            {t("manualMark.trough")}
          </span>
          {hasSineCurve && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="4">
                <line x1="0" y1="2" x2="16" y2="2" stroke={SINE_COLOR} strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              {t("manualMark.sineFit")}
            </span>
          )}
        </div>
      )}
      <div className={isCompact ? "h-28 w-full" : "h-72 w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 16, bottom: isCompact ? 0 : 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="timeS"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value: number) => value.toFixed(1)}
              hide={isCompact}
              label={isCompact ? undefined : { value: t("chart.timeAxis"), position: "insideBottom", offset: -4 }}
            />
            <YAxis
              hide={isCompact}
              width={isCompact ? 0 : undefined}
              label={isCompact ? undefined : { value: t("chart.valueAxis"), angle: -90, position: "insideLeft" }}
            />
            {!isCompact && (
              <Tooltip
                formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
                labelFormatter={(label) =>
                  typeof label === "number" ? t("chart.tooltipTime", { value: label.toFixed(2) }) : label
                }
              />
            )}
            {hasSineCurve && (
              <Line
                data={sineCurve!}
                dataKey="valueCm"
                stroke={SINE_COLOR}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
                type="monotone"
              />
            )}
            <Line
              data={sortedPoints}
              dataKey="valueCm"
              stroke={LINE_COLOR}
              strokeWidth={isCompact ? 1 : 1.5}
              dot={<ExtremaDot />}
              isAnimationActive={false}
              type="linear"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
