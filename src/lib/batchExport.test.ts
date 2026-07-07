// @vitest-environment jsdom
// This file needs jsdom (not the project's default `node` environment)
// because exportBatchAsZip() generates a real Blob via JSZip, which expects
// browser-like Blob/File API support.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { exportBatchAsZip } from "./batchExport";
import type { BatchResult } from "@/types/wave";

describe("exportBatchAsZip", () => {
  it("includes a per-video folder with raw CSVs + summary, plus a root comparison CSV", async () => {
    const results: BatchResult[] = [
      {
        fileName: "video1.mp4",
        status: "done",
        points: [
          {
            id: "p1",
            xColumn: 50,
            label: "Point A",
            color: "#3b82f6",
            baselineY: 100,
            baselineValueCm: null,
            xOffsetCm: 0,
            initialGuessPixelY: 100,
            initialSearchMarginPx: null,
          },
        ],
        rawData: {
          p1: [
            { timeS: 0, elevationCm: 1, confidence: 3 },
            { timeS: 0.1, elevationCm: -1, confidence: 3 },
          ],
        },
        statistics: {
          p1: {
            nWaves: 5,
            hMax: 4,
            hMean: 3,
            hRms: 3.1,
            hSignificant: 3.8,
            periodMeanS: 1.0,
            periodSignificantS: 1.1,
            waves: [],
          },
        },
      },
      {
        fileName: "video2.mp4",
        status: "error",
        errorMessage: "Simulated failure",
      },
    ];

    const blob = await exportBatchAsZip(results);
    const zip = await JSZip.loadAsync(blob);

    const fileNames = Object.keys(zip.files);
    expect(fileNames).toContain("comparison_summary.csv");
    // Spaces in labels are sanitized to underscores for filesystem safety.
    expect(fileNames).toContain("video1/raw_data_Point_A.csv");
    expect(fileNames).toContain("video1/summary_report.txt");
    expect(fileNames).toContain("video2/error.txt");

    const comparisonCsv = await zip.file("comparison_summary.csv")?.async("string");
    expect(comparisonCsv).toContain("video1.mp4,Point A,3.80,4.00,3.00,1.00");

    const rawCsv = await zip.file("video1/raw_data_Point_A.csv")?.async("string");
    expect(rawCsv).toContain("time_s,elevation_cm,confidence");
    expect(rawCsv).toContain("0,1,3");

    const report = await zip.file("video1/summary_report.txt")?.async("string");
    expect(report).toContain("Point A");
    expect(report).toContain("3.80 cm");

    const errorTxt = await zip.file("video2/error.txt")?.async("string");
    expect(errorTxt).toContain("Simulated failure");
  });

  it("escapes commas and quotes in file names and point labels in the comparison CSV", async () => {
    const results: BatchResult[] = [
      {
        fileName: "trial 3, run 2.mp4",
        status: "done",
        points: [
          {
            id: "p1",
            xColumn: 50,
            label: 'Point "A", left',
            color: "#3b82f6",
            baselineY: 100,
            baselineValueCm: null,
            xOffsetCm: 0,
            initialGuessPixelY: 100,
            initialSearchMarginPx: null,
          },
        ],
        rawData: { p1: [{ timeS: 0, elevationCm: 1, confidence: 3 }] },
        statistics: {
          p1: {
            nWaves: 5,
            hMax: 4,
            hMean: 3,
            hRms: 3.1,
            hSignificant: 3.8,
            periodMeanS: 1.0,
            periodSignificantS: 1.1,
            waves: [],
          },
        },
      },
    ];

    const blob = await exportBatchAsZip(results);
    const zip = await JSZip.loadAsync(blob);
    const comparisonCsv = await zip.file("comparison_summary.csv")?.async("string");

    // RFC 4180: fields containing commas/quotes are quoted, inner quotes doubled —
    // so the row still parses into exactly 6 columns.
    expect(comparisonCsv).toContain(
      '"trial 3, run 2.mp4","Point ""A"", left",3.80,4.00,3.00,1.00'
    );
  });

  it("still produces a (empty) comparison CSV header when given no results", async () => {
    const blob = await exportBatchAsZip([]);
    const zip = await JSZip.loadAsync(blob);
    const comparisonCsv = await zip.file("comparison_summary.csv")?.async("string");
    expect(comparisonCsv).toBe("fileName,pointLabel,hSignificant,hMax,hMean,periodMeanS");
  });
});
