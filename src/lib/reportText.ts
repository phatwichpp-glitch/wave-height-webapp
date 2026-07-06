import type { WaveStatistics } from "@/types/wave";

/**
 * Plain-text summary report shared by the single-video download
 * (ResultsSummary) and the per-video report inside the batch ZIP
 * (batchExport) — one implementation so the two never drift apart.
 */
export function buildWaveReportText(
  points: Array<{ id: string; label: string }>,
  statsByPoint: Record<string, WaveStatistics>,
  title: string = "Wave Height Analysis Report"
): string {
  const lines: string[] = [title, "=".repeat(40), ""];

  for (const point of points) {
    const stats = statsByPoint[point.id];
    lines.push(`Point: ${point.label}`, "-".repeat(20));
    if (!stats) {
      lines.push("  Not enough waves detected for statistics.", "");
      continue;
    }
    lines.push(`  Number of waves analyzed: ${stats.nWaves}`);
    lines.push(`  Maximum wave height (H_max):        ${stats.hMax.toFixed(2)} cm`);
    lines.push(`  Mean wave height (H_mean):          ${stats.hMean.toFixed(2)} cm`);
    lines.push(`  RMS wave height (H_rms):             ${stats.hRms.toFixed(2)} cm`);
    lines.push(`  Significant wave height (Hs, H1/3):  ${stats.hSignificant.toFixed(2)} cm`);
    lines.push(`  Mean wave period:                    ${stats.periodMeanS.toFixed(2)} s`);
    lines.push(`  Significant wave period:             ${stats.periodSignificantS.toFixed(2)} s`);
    lines.push("");
  }

  return lines.join("\n");
}
