"use client";

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
import type { WaveEvent } from "@/types/wave";

interface WaveHeightHistogramProps {
  waves: WaveEvent[];
  hMean: number;
  hSignificant: number;
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
  waves,
  hMean,
  hSignificant,
  binCount = 15,
}: WaveHeightHistogramProps) {
  const heights = waves.map((w) => w.heightCm);
  const bins = binHeights(heights, binCount);

  return (
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
            x={findBinLabelForValue(bins, hMean)}
            stroke="#22c55e"
            label={{ value: "Mean", position: "top", fill: "#22c55e", fontSize: 11 }}
          />
          <ReferenceLine
            x={findBinLabelForValue(bins, hSignificant)}
            stroke="#ef4444"
            label={{ value: "Hs", position: "top", fill: "#ef4444", fontSize: 11 }}
          />
          <Bar dataKey="count" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
