import type { MeasurementPoint, WaveDataPoint } from "@/types/wave";

/** Triggers a browser download of an arbitrary Blob (shared by the CSV/report helpers below and the batch ZIP export). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/** RFC 4180 field escaping: quotes a field only when it contains a comma, quote, or line break, so typical fields stay byte-identical. */
export function csvEscapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function waveDataToCSV(data: WaveDataPoint[]): string {
  const header = "time_s,elevation_cm,confidence";
  const rows = data.map((d) => `${d.timeS},${d.elevationCm},${d.confidence}`);
  return [header, ...rows].join("\n");
}

function sanitizeHeaderName(label: string): string {
  const cleaned = label.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "point";
}

/** One row per frame, with a pair of elevation/confidence columns per measurement point. */
export function waveDataToCombinedCSV(
  data: Record<string, WaveDataPoint[]>,
  points: MeasurementPoint[]
): string {
  const header = [
    "time_s",
    ...points.flatMap((point) => {
      const name = sanitizeHeaderName(point.label);
      return [`${name}_elevation_cm`, `${name}_confidence`];
    }),
  ].join(",");

  const rowCount = Math.max(0, ...points.map((point) => data[point.id]?.length ?? 0));

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const timeS =
      points.map((point) => data[point.id]?.[i]?.timeS).find((t) => t !== undefined) ?? "";
    const cells = points.flatMap((point) => {
      const sample = data[point.id]?.[i];
      return sample ? [String(sample.elevationCm), String(sample.confidence)] : ["", ""];
    });
    rows.push([timeS, ...cells].join(","));
  }

  return [header, ...rows].join("\n");
}

export function downloadCSV(csvContent: string, filename: string): void {
  downloadBlob(new Blob([csvContent], { type: "text/csv;charset=utf-8;" }), filename);
}

// Shares the same download mechanism as downloadCSV, for the plain-text summary report.
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string = "text/plain;charset=utf-8;"
): void {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}
