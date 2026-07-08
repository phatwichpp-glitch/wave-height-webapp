"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WaveDataPoint } from "@/types/wave";

interface ManualMarkChartProps {
  data: WaveDataPoint[];
  /** "compact" is a glance-only live-feedback strip while typing (Part 2) — no axes/tooltip, just "does this look like a wave yet". "full" is the post-marking summary chart (Part 3), matching ElevationChart's look. */
  variant?: "compact" | "full";
}

/**
 * Standalone chart for the manual-mark tool: takes plain {timeS, elevationCm}
 * pairs directly, deliberately NOT reusing ElevationChart.tsx — that
 * component's props are keyed by MeasurementPoint (pixel/calibration data
 * this page must not depend on), and fabricating fake pixel fields just to
 * satisfy that shape would reintroduce exactly the coupling this tool exists
 * to avoid.
 */
export default function ManualMarkChart({ data, variant = "full" }: ManualMarkChartProps) {
  const isCompact = variant === "compact";
  const sorted = [...data].sort((a, b) => a.timeS - b.timeS);

  return (
    <div className={isCompact ? "h-24 w-full" : "h-72 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sorted} margin={{ top: 8, right: 16, bottom: isCompact ? 0 : 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
          <XAxis
            dataKey="timeS"
            tickFormatter={(value: number) => value.toFixed(1)}
            hide={isCompact}
            label={isCompact ? undefined : { value: "Time (s)", position: "insideBottom", offset: -4 }}
          />
          <YAxis
            hide={isCompact}
            width={isCompact ? 0 : undefined}
            label={isCompact ? undefined : { value: "Value (cm)", angle: -90, position: "insideLeft" }}
          />
          {!isCompact && (
            <Tooltip
              formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
              labelFormatter={(label) =>
                typeof label === "number" ? `t = ${label.toFixed(2)}s` : label
              }
            />
          )}
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="elevationCm"
            stroke="#3b82f6"
            strokeWidth={isCompact ? 1.5 : 2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
