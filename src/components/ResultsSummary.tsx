"use client";

import type { WaveDataPoint, WaveStatistics } from "@/types/wave";
import { downloadCSV, downloadTextFile, waveDataToCSV } from "@/lib/csvExport";

interface ResultsSummaryProps {
  waveData: WaveDataPoint[];
  stats: WaveStatistics;
  fileNamePrefix?: string;
}

function buildReportText(stats: WaveStatistics): string {
  const lines = [
    "Wave Height Analysis Report",
    "=".repeat(40),
    "",
    `Number of waves analyzed: ${stats.nWaves}`,
    "",
    "Wave Height Statistics:",
    `  Maximum wave height (H_max):        ${stats.hMax.toFixed(2)} cm`,
    `  Mean wave height (H_mean):          ${stats.hMean.toFixed(2)} cm`,
    `  RMS wave height (H_rms):             ${stats.hRms.toFixed(2)} cm`,
    `  Significant wave height (Hs, H1/3):  ${stats.hSignificant.toFixed(2)} cm`,
    "",
    "Wave Period Statistics:",
    `  Mean wave period:                    ${stats.periodMeanS.toFixed(2)} s`,
    `  Significant wave period:             ${stats.periodSignificantS.toFixed(2)} s`,
    "",
  ];
  return lines.join("\n");
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span>}
      </span>
    </div>
  );
}

export default function ResultsSummary({
  waveData,
  stats,
  fileNamePrefix = "wave-analysis",
}: ResultsSummaryProps) {
  function handleDownloadRawCSV() {
    downloadCSV(waveDataToCSV(waveData), `${fileNamePrefix}_raw_data.csv`);
  }

  function handleDownloadReport() {
    downloadTextFile(buildReportText(stats), `${fileNamePrefix}_report.txt`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Waves" value={String(stats.nWaves)} unit="" />
        <StatCard label="Max height" value={stats.hMax.toFixed(1)} unit="cm" />
        <StatCard label="Mean height" value={stats.hMean.toFixed(1)} unit="cm" />
        <StatCard
          label="Significant height"
          value={stats.hSignificant.toFixed(1)}
          unit="cm"
        />
        <StatCard label="Mean period" value={stats.periodMeanS.toFixed(2)} unit="s" />
        <StatCard
          label="Significant period"
          value={stats.periodSignificantS.toFixed(2)}
          unit="s"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownloadRawCSV}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Download raw data (CSV)
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
