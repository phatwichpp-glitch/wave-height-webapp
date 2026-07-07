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
import type { MeasurementPoint } from "@/types/wave";
import type { SpectralPeriodResult } from "@/lib/waveStatistics";

interface SpectrumChartProps {
  point: MeasurementPoint;
  spectral: SpectralPeriodResult;
}

/**
 * Power spectrum for a single measurement point — a single-series chart, so
 * it inherits the point's own color (matching ElevationChart) rather than
 * needing a categorical palette, and skips a legend (the title already names
 * the one series). A sharp, isolated peak means a clean signal; a broad or
 * multi-peaked spectrum means noise/drift is still competing with the real
 * wave frequency.
 */
export default function SpectrumChart({ point, spectral }: SpectrumChartProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Power spectrum — {point.label}
      </p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spectral.spectrum} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="frequencyHz"
              type="number"
              tickFormatter={(value: number) => value.toFixed(2)}
              label={{ value: "Frequency (Hz)", position: "insideBottom", offset: -4 }}
            />
            <YAxis
              tickFormatter={(value: number) => value.toExponential(1)}
              label={{ value: "Power", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              formatter={(value) => (typeof value === "number" ? value.toExponential(2) : value)}
              labelFormatter={(label) =>
                typeof label === "number" ? `${label.toFixed(3)} Hz` : label
              }
            />
            <ReferenceLine
              x={spectral.dominantFrequencyHz}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              label={{ value: "Peak", position: "top", fill: "#9ca3af", fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey="power"
              stroke={point.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
