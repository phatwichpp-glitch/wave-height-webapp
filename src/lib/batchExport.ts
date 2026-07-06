import JSZip from "jszip";
import type { BatchResult } from "@/types/wave";
import { waveDataToCSV } from "@/lib/csvExport";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function folderNameFor(fileName: string): string {
  return sanitizeName(fileName.replace(/\.[^/.]+$/, ""));
}

function buildReportText(result: BatchResult): string {
  const lines: string[] = [`Wave Height Analysis Report — ${result.fileName}`, "=".repeat(40), ""];
  const points = result.points ?? [];
  const statistics = result.statistics ?? {};

  for (const point of points) {
    const stats = statistics[point.id];
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

/**
 * Bundles every video's results into one zip: a per-video subfolder with raw
 * CSVs and a text summary, plus a root-level comparison_summary.csv covering
 * every video and point in a single table.
 */
export async function exportBatchAsZip(results: BatchResult[]): Promise<Blob> {
  const zip = new JSZip();
  const comparisonRows: string[] = ["fileName,pointLabel,hSignificant,hMax,hMean,periodMeanS"];

  for (const result of results) {
    const folder = zip.folder(folderNameFor(result.fileName));
    if (!folder) {
      continue;
    }

    if (result.status === "error") {
      folder.file(
        "error.txt",
        `Error processing ${result.fileName}:\n${result.errorMessage ?? "Unknown error"}`
      );
      continue;
    }

    const points = result.points ?? [];
    const statistics = result.statistics ?? {};
    const rawData = result.rawData ?? {};

    for (const point of points) {
      const pointData = rawData[point.id];
      if (pointData) {
        folder.file(`raw_data_${sanitizeName(point.label)}.csv`, waveDataToCSV(pointData));
      }

      const stats = statistics[point.id];
      if (stats) {
        comparisonRows.push(
          [
            result.fileName,
            point.label,
            stats.hSignificant.toFixed(2),
            stats.hMax.toFixed(2),
            stats.hMean.toFixed(2),
            stats.periodMeanS.toFixed(2),
          ].join(",")
        );
      }
    }

    folder.file("summary_report.txt", buildReportText(result));
  }

  zip.file("comparison_summary.csv", comparisonRows.join("\n"));

  return zip.generateAsync({ type: "blob" });
}
