import JSZip from "jszip";
import type { BatchResult } from "@/types/wave";
import { csvEscapeField, waveDataToCSV } from "@/lib/csvExport";
import { buildWaveReportText } from "@/lib/reportText";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function folderNameFor(fileName: string): string {
  return sanitizeName(fileName.replace(/\.[^/.]+$/, ""));
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
            // File names and labels are user-controlled free text — escape
            // them so a comma or quote can't shift every column after it.
            csvEscapeField(result.fileName),
            csvEscapeField(point.label),
            stats.hSignificant.toFixed(2),
            stats.hMax.toFixed(2),
            stats.hMean.toFixed(2),
            stats.periodMeanS.toFixed(2),
          ].join(",")
        );
      }
    }

    folder.file(
      "summary_report.txt",
      buildWaveReportText(points, statistics, `Wave Height Analysis Report — ${result.fileName}`)
    );
  }

  zip.file("comparison_summary.csv", comparisonRows.join("\n"));

  return zip.generateAsync({ type: "blob" });
}
