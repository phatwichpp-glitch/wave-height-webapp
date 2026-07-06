"use client";

import type { MeasurementPoint, WaveDataPoint, WaveStatistics } from "@/types/wave";
import {
  downloadCSV,
  downloadTextFile,
  waveDataToCSV,
  waveDataToCombinedCSV,
} from "@/lib/csvExport";
import { buildWaveReportText } from "@/lib/reportText";

interface ResultsSummaryProps {
  points: MeasurementPoint[];
  waveData: Record<string, WaveDataPoint[]>;
  statsByPoint: Record<string, WaveStatistics>;
  fileNamePrefix?: string;
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, "-");
}

export default function ResultsSummary({
  points,
  waveData,
  statsByPoint,
  fileNamePrefix = "wave-analysis",
}: ResultsSummaryProps) {
  function handleDownloadCombinedCSV() {
    downloadCSV(
      waveDataToCombinedCSV(waveData, points),
      `${fileNamePrefix}_raw_data_all_points.csv`
    );
  }

  function handleDownloadPointCSV(point: MeasurementPoint) {
    downloadCSV(
      waveDataToCSV(waveData[point.id] ?? []),
      `${fileNamePrefix}_raw_data_${slugify(point.label)}.csv`
    );
  }

  function handleDownloadReport() {
    downloadTextFile(buildWaveReportText(points, statsByPoint), `${fileNamePrefix}_report.txt`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4">Point</th>
              <th className="py-2 pr-4">Hs (cm)</th>
              <th className="py-2 pr-4">Max (cm)</th>
              <th className="py-2 pr-4">Mean (cm)</th>
              <th className="py-2 pr-4">Period (s)</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {points.map((point) => {
              const stats = statsByPoint[point.id];
              return (
                <tr key={point.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: point.color }}
                        aria-hidden
                      />
                      {point.label}
                    </span>
                  </td>
                  {stats ? (
                    <>
                      <td className="py-2 pr-4" data-testid={`hs-${point.id}`}>
                        {stats.hSignificant.toFixed(1)}
                      </td>
                      <td className="py-2 pr-4">{stats.hMax.toFixed(1)}</td>
                      <td className="py-2 pr-4">{stats.hMean.toFixed(1)}</td>
                      <td className="py-2 pr-4">{stats.periodMeanS.toFixed(2)}</td>
                    </>
                  ) : (
                    <td className="py-2 pr-4 text-zinc-400" colSpan={4}>
                      Not enough waves detected
                    </td>
                  )}
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => handleDownloadPointCSV(point)}
                      className="rounded-full border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      CSV
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownloadCombinedCSV}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Download raw data — all points (CSV)
        </button>
        <button
          type="button"
          onClick={handleDownloadReport}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Download summary report
        </button>
      </div>
    </div>
  );
}
