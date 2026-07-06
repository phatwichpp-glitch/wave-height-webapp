"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MeasurementPoint, WaveStatistics } from "@/types/wave";

interface WaveHeightHistogramProps {
  points: MeasurementPoint[];
  statsByPoint: Record<string, WaveStatistics>;
  binCount?: number;
}

interface HistogramBin {
  rangeLabel: string;
  rangeStart: number;
  rangeEnd: number;
  count: number;
}

// recharts has no built-in histogram chart, so bin the raw heights ourselves
// into equal-width buckets between min and max before handing them to BarChart.
function binHeights(heights: number[], binCount: number): HistogramBin[] {
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const range = max - min || 1; // avoid a zero-width bin if every height is equal
  const binWidth = range / binCount;

  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => {
    const rangeStart = min + i * binWidth;
    const rangeEnd = rangeStart + binWidth;
    return { rangeLabel: rangeStart.toFixed(1), rangeStart, rangeEnd, count: 0 };
  });

  for (const height of heights) {
    let index = Math.floor((height - min) / binWidth);
    if (index >= binCount) {
      index = binCount - 1; // the max value belongs in the last bin, not a new one
    }
    if (index < 0) {
      index = 0;
    }
    bins[index].count += 1;
  }

  return bins;
}

// Categorical x-axes in recharts can't take an arbitrary continuous x position
// for a ReferenceLine, so anchor it to whichever bin the target value falls in.
function findBinLabelForValue(bins: HistogramBin[], value: number): string {
  const bin = bins.find((b) => value >= b.rangeStart && value < b.rangeEnd);
  return (bin ?? bins[bins.length - 1]).rangeLabel;
}

export default function WaveHeightHistogram({
  points,
  statsByPoint,
  binCount = 15,
}: WaveHeightHistogramProps) {
  const [selectedId, setSelectedId] = useState(points[0]?.id ?? "");
  const activeId = statsByPoint[selectedId] ? selectedId : points[0]?.id ?? "";
  const stats = statsByPoint[activeId];

  if (!stats) {
    return (
      <p className="text-sm text-zinc-500">
        Not enough waves detected to show a histogram.
      </p>
    );
  }

  const heights = stats.waves.map((w) => w.heightCm);
  const bins = binHeights(heights, binCount);

  return (
    <div className="flex flex-col gap-2">
      {points.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {points.map((point) => (
            <button
              key={point.id}
              type="button"
              onClick={() => setSelectedId(point.id)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={
                activeId === point.id
                  ? { backgroundColor: point.color, borderColor: point.color, color: "white" }
                  : { borderColor: point.color, color: point.color }
              }
            >
              {point.label}
            </button>
          ))}
        </div>
      )}

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="rangeLabel"
              label={{ value: "Wave height (cm)", position: "insideBottom", offset: -4 }}
            />
            <YAxis
              allowDecimals={false}
              label={{ value: "Count", angle: -90, position: "insideLeft" }}
            />
            <Tooltip />
            <ReferenceLine
              x={findBinLabelForValue(bins, stats.hMean)}
              stroke="#22c55e"
              label={{ value: "Mean", position: "top", fill: "#22c55e", fontSize: 11 }}
            />
            <ReferenceLine
              x={findBinLabelForValue(bins, stats.hSignificant)}
              stroke="#ef4444"
              label={{ value: "Hs", position: "top", fill: "#ef4444", fontSize: 11 }}
            />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
