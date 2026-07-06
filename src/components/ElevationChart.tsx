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

interface ElevationChartProps {
  data: WaveDataPoint[];
}

export default function ElevationChart({ data }: ElevationChartProps) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
          <XAxis
            dataKey="timeS"
            tickFormatter={(value: number) => value.toFixed(1)}
            label={{ value: "Time (s)", position: "insideBottom", offset: -4 }}
          />
          <YAxis
            label={{ value: "Elevation (cm)", angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
            labelFormatter={(label) =>
              typeof label === "number" ? `t = ${label.toFixed(2)}s` : label
            }
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="elevationCm"
            name="Elevation (cm)"
            stroke="#3b82f6"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
