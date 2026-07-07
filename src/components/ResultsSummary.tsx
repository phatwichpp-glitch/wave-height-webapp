"use client";

import { useState } from "react";
import type { MeasurementPoint, WaveDataPoint, WaveStatistics } from "@/types/wave";
import {
  downloadCSV,
  downloadTextFile,
  waveDataToCSV,
  waveDataToCombinedCSV,
} from "@/lib/csvExport";
import { buildWaveReportText } from "@/lib/reportText";
import type { SpectralPeriodResult } from "@/lib/waveStatistics";
import SpectrumChart from "@/components/SpectrumChart";

interface ResultsSummaryProps {
  points: MeasurementPoint[];
  waveData: Record<string, WaveDataPoint[]>;
  statsByPoint: Record<string, WaveStatistics>;
  /** FFT-based dominant period per point, for cross-checking against the zero up-crossing period in the table below and the spectrum chart. */
  spectralByPoint?: Record<string, SpectralPeriodResult>;
  fileNamePrefix?: string;
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, "-");
}

// Above this relative difference between the two independent period
// estimates, at least one of them is probably compromised by noise/drift —
// worth flagging so the user knows to double check rather than silently
// trusting whichever number they happen to look at first.
const PERIOD_MISMATCH_WARNING_THRESHOLD = 0.2;

export default function ResultsSummary({
  points,
  waveData,
  statsByPoint,
  spectralByPoint = {},
  fileNamePrefix = "wave-analysis",
}: ResultsSummaryProps) {
  const [spectrumPointId, setSpectrumPointId] = useState<string | null>(null);
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

  const activeSpectrumPoint =
    points.find((p) => p.id === spectrumPointId && spectralByPoint[p.id]) ??
    points.find((p) => spectralByPoint[p.id]);
  const activeSpectral = activeSpectrumPoint ? spectralByPoint[activeSpectrumPoint.id] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4">Point</th>
              <th className="py-2 pr-4">Hs (cm)</th>
              <th className="py-2 pr-4">Max (cm)</th>
              <th className="py-2 pr-4">Mean (cm)</th>
              <th className="py-2 pr-4">Period — zero up-crossing (s)</th>
              <th className="py-2 pr-4">Period — FFT (s)</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {points.map((point) => {
              const stats = statsByPoint[point.id];
              const spectral = spectralByPoint[point.id];
              const periodMismatch =
                stats && spectral
                  ? Math.abs(stats.periodMeanS - spectral.dominantPeriodS) /
                    Math.min(stats.periodMeanS, spectral.dominantPeriodS)
                  : null;
              const showMismatchWarning =
                periodMismatch !== null && periodMismatch > PERIOD_MISMATCH_WARNING_THRESHOLD;

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
                      <td className="py-2 pr-4" data-testid={`period-crossing-${point.id}`}>
                        {stats.periodMeanS.toFixed(2)}
                      </td>
                    </>
                  ) : (
                    <td className="py-2 pr-4 text-zinc-400" colSpan={4}>
                      Not enough waves detected
                    </td>
                  )}
                  <td className="py-2 pr-4" data-testid={`period-fft-${point.id}`}>
                    {spectral ? (
                      <span className={showMismatchWarning ? "text-amber-600" : undefined}>
                        {spectral.dominantPeriodS.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
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

      {points.some((point) => {
        const stats = statsByPoint[point.id];
        const spectral = spectralByPoint[point.id];
        if (!stats || !spectral) {
          return false;
        }
        const mismatch =
          Math.abs(stats.periodMeanS - spectral.dominantPeriodS) /
          Math.min(stats.periodMeanS, spectral.dominantPeriodS);
        return mismatch > PERIOD_MISMATCH_WARNING_THRESHOLD;
      }) && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          ค่าคาบจาก 2 วิธีต่างกันมาก อาจมี noise หรือ drift รบกวนสัญญาณอยู่ แนะนำตรวจสอบตำแหน่งจุดวัดหรือลด noise เพิ่มเติม
        </p>
      )}

      {activeSpectrumPoint && activeSpectral && (
        <div className="flex flex-col gap-2">
          {points.filter((p) => spectralByPoint[p.id]).length > 1 && (
            <div className="flex flex-wrap gap-2">
              {points
                .filter((p) => spectralByPoint[p.id])
                .map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => setSpectrumPointId(point.id)}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={
                      activeSpectrumPoint.id === point.id
                        ? { backgroundColor: point.color, borderColor: point.color, color: "white" }
                        : { borderColor: point.color, color: point.color }
                    }
                  >
                    {point.label}
                  </button>
                ))}
            </div>
          )}
          <SpectrumChart point={activeSpectrumPoint} spectral={activeSpectral} />
        </div>
      )}

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
