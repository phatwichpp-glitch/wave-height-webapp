"use client";

import { useState } from "react";
import type { BatchConfig, BatchResult } from "@/types/wave";
import { processBatch, validateBatchConfig } from "@/lib/batchProcessor";
import { exportBatchAsZip } from "@/lib/batchExport";
import { downloadBlob, downloadTextFile } from "@/lib/csvExport";

const SAMPLE_CONFIG: BatchConfig = {
  defaultCalibration: {
    point1: { x: 0, y: 0 },
    point2: { x: 0, y: 100 },
    knownDistanceCm: 10,
    pixelsPerCm: 10,
  },
  defaultPoints: [
    {
      id: "point-1",
      xColumn: 160,
      label: "Point 1",
      color: "#3b82f6",
      baselineY: 120,
      baselineValueCm: null,
      xOffsetCm: 0,
    },
  ],
  videos: [
    { fileNamePattern: "video1.mp4", label: "Trial 1" },
    { fileNamePattern: "video2.mp4", label: "Trial 2" },
  ],
  sampleRateHz: 10,
};

export default function BatchPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [batchConfig, setBatchConfig] = useState<BatchConfig | null>(null);
  const [results, setResults] = useState<Record<string, BatchResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);

  function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setResults({});
    setIsDone(false);
  }

  function handleConfigTextChange(value: string) {
    setConfigText(value);
    setConfigError(null);
    setBatchConfig(null);

    if (value.trim() === "") {
      return;
    }
    try {
      setBatchConfig(validateBatchConfig(JSON.parse(value)));
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDownloadSampleConfig() {
    downloadTextFile(
      JSON.stringify(SAMPLE_CONFIG, null, 2),
      "batch-config.example.json",
      "application/json;charset=utf-8;"
    );
  }

  async function handleStartBatch() {
    if (!batchConfig || files.length === 0) {
      return;
    }

    setIsRunning(true);
    setIsDone(false);
    setResults(
      Object.fromEntries(
        files.map((file) => [file.name, { fileName: file.name, status: "pending" as const }])
      )
    );

    await processBatch(
      files,
      batchConfig,
      (fileName) => {
        setResults((prev) => ({
          ...prev,
          [fileName]: { ...prev[fileName], fileName, status: "processing" },
        }));
      },
      (result) => {
        setResults((prev) => ({ ...prev, [result.fileName]: result }));
      },
      (fileName, error) => {
        setResults((prev) => ({
          ...prev,
          [fileName]: { ...prev[fileName], fileName, status: "error", errorMessage: error.message },
        }));
      }
    );

    setIsRunning(false);
    setIsDone(true);
  }

  async function handleDownloadZip() {
    const zipBlob = await exportBatchAsZip(Object.values(results));
    downloadBlob(zipBlob, "batch-results.zip");
  }

  const canStart = !isRunning && !!batchConfig && files.length > 0;
  const canDownloadZip = isDone && Object.keys(results).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Select video files</label>
        <input type="file" accept="video/*" multiple onChange={handleFilesChange} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Batch config (JSON)</label>
          <button
            type="button"
            onClick={handleDownloadSampleConfig}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Download sample config
          </button>
        </div>
        <textarea
          value={configText}
          onChange={(event) => handleConfigTextChange(event.target.value)}
          rows={10}
          placeholder="Paste your batch config JSON here"
          aria-label="Batch config JSON"
          className="w-full rounded border border-zinc-300 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        {configError && <p className="text-sm text-red-600">{configError}</p>}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canStart}
          onClick={handleStartBatch}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isRunning ? "Processing…" : "Start Batch Processing"}
        </button>
        <button
          type="button"
          disabled={!canDownloadZip}
          onClick={handleDownloadZip}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Download all results (.zip)
        </button>
      </div>

      {files.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4">File</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Details</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const result = results[file.name];
              return (
                <tr key={file.name} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">{file.name}</td>
                  <td className="py-2 pr-4">{result?.status ?? "pending"}</td>
                  <td className="py-2 pr-4 text-red-600">
                    {result?.status === "error" ? result.errorMessage : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
