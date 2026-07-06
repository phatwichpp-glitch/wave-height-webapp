"use client";

import { useEffect, useRef, useState } from "react";
import type { CalibrationData, WaveDataPoint } from "@/types/wave";
import { processVideo } from "@/lib/videoProcessor";

interface ProcessingPanelProps {
  videoUrl: string;
  calibration: CalibrationData;
  onComplete: (data: WaveDataPoint[]) => void;
}

export default function ProcessingPanel({
  videoUrl,
  calibration,
  onComplete,
}: ProcessingPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isMetadataReady, setIsMetadataReady] = useState(false);
  const [xColumn, setXColumn] = useState("");
  const [sampleRateHz, setSampleRateHz] = useState("30");
  const [baselineY, setBaselineY] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setIsMetadataReady(false);

    function handleLoadedMetadata() {
      setIsMetadataReady(true);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [videoUrl]);

  const parsedXColumn = parseInt(xColumn, 10);
  const parsedSampleRate = parseFloat(sampleRateHz);
  const parsedBaselineY = baselineY.trim() === "" ? null : parseInt(baselineY, 10);

  const canStart =
    isMetadataReady &&
    !isProcessing &&
    Number.isFinite(parsedXColumn) &&
    parsedXColumn >= 0 &&
    Number.isFinite(parsedSampleRate) &&
    parsedSampleRate > 0;

  async function handleStart() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !canStart) {
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setResultCount(null);

    try {
      const data = await processVideo(video, canvas, calibration, {
        xColumn: parsedXColumn,
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        baselineY: parsedBaselineY,
        sampleRateHz: parsedSampleRate,
        onProgress: (percent) => setProgress(percent),
      });

      setResultCount(data.length);
      onComplete(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Off-screen video/canvas used only to seek and sample frames. */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {!isMetadataReady && (
        <p className="text-sm text-zinc-500">Loading video metadata…</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          x column (px)
          <input
            type="number"
            min={0}
            value={xColumn}
            onChange={(event) => setXColumn(event.target.value)}
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sample rate (Hz)
          <input
            type="number"
            min={1}
            step="any"
            value={sampleRateHz}
            onChange={(event) => setSampleRateHz(event.target.value)}
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Baseline y (optional)
          <input
            type="number"
            value={baselineY}
            onChange={(event) => setBaselineY(event.target.value)}
            placeholder="auto"
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isProcessing ? "Processing…" : "Start Processing"}
        </button>
      </div>

      {isProcessing && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {resultCount !== null && !isProcessing && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Processed {resultCount} data points.
        </p>
      )}
    </div>
  );
}
