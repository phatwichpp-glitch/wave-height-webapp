import type { WaveDataPoint } from "@/types/wave";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function waveDataToCSV(data: WaveDataPoint[]): string {
  const header = "time_s,elevation_cm,confidence";
  const rows = data.map((d) => `${d.timeS},${d.elevationCm},${d.confidence}`);
  return [header, ...rows].join("\n");
}

export function downloadCSV(csvContent: string, filename: string): void {
  triggerDownload(new Blob([csvContent], { type: "text/csv;charset=utf-8;" }), filename);
}

// Shares the same download mechanism as downloadCSV, for the plain-text summary report.
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string = "text/plain;charset=utf-8;"
): void {
  triggerDownload(new Blob([content], { type: mimeType }), filename);
}
