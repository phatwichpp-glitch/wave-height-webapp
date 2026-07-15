"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MeasurementPoint, WaveDataPoint } from "@/types/wave";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

interface ElevationChartProps {
  data: Record<string, WaveDataPoint[]>;
  points: MeasurementPoint[];
}

function mergeDataForChart(
  data: Record<string, WaveDataPoint[]>,
  points: MeasurementPoint[]
): Array<Record<string, number>> {
  const referenceData = points.length > 0 ? data[points[0].id] ?? [] : [];

  return referenceData.map((referenceSample, i) => {
    const row: Record<string, number> = { timeS: referenceSample.timeS };
    for (const point of points) {
      const sample = data[point.id]?.[i];
      if (sample) {
        row[point.id] = sample.elevationCm;
      }
    }
    return row;
  });
}

export default function ElevationChart({ data, points }: ElevationChartProps) {
  const { t } = useLanguage();
  const [hiddenPointIds, setHiddenPointIds] = useState<Set<string>>(new Set());
  const chartData = mergeDataForChart(data, points);

  function handleLegendClick(entry: { dataKey?: unknown }) {
    if (typeof entry.dataKey !== "string") {
      return;
    }
    const pointId = entry.dataKey;
    setHiddenPointIds((prev) => {
      const next = new Set(prev);
      if (next.has(pointId)) {
        next.delete(pointId);
      } else {
        next.add(pointId);
      }
      return next;
    });
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
          <XAxis
            dataKey="timeS"
            tickFormatter={(value: number) => value.toFixed(1)}
            label={{ value: t("chart.timeAxis"), position: "insideBottom", offset: -4 }}
          />
          <YAxis
            label={{ value: t("chart.elevationAxis"), angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
            labelFormatter={(label) =>
              typeof label === "number" ? t("chart.tooltipTime", { value: label.toFixed(2) }) : label
            }
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
          {points.length > 1 && (
            <Legend onClick={handleLegendClick} cursor="pointer" />
          )}
          {points.map((point) => (
            <Line
              key={point.id}
              type="monotone"
              dataKey={point.id}
              name={point.label}
              stroke={point.color}
              hide={hiddenPointIds.has(point.id)}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
