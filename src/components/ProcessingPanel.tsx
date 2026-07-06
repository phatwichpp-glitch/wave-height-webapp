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
  // Hidden canvas used internally by processVideo() to capture frames.
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Visible canvas showing the first frame, for click-to-select column picking.
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFrameReady, setIsFrameReady] = useState(false);
  const [xColumn, setXColumn] = useState<number | null>(null);
  const [sampleRateHz, setSampleRateHz] = useState("10");
  const [baselineY, setBaselineY] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);

  // Load the video and draw its first frame onto the preview canvas, the same
  // way CalibrationCanvas does, so the user can click a column instead of
  // guessing a pixel x-coordinate.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let hasDrawnFrame = false;
    setIsFrameReady(false);
    setXColumn(null);

    function drawFirstFrame() {
      if (hasDrawnFrame || !video) {
        return;
      }
      const canvas = previewCanvasRef.current;
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      hasDrawnFrame = true;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setIsFrameReady(true);
    }

    function handleLoadedData() {
      if (video) {
        video.currentTime = 0;
      }
      drawFirstFrame();
    }

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("seeked", drawFirstFrame);

    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("seeked", drawFirstFrame);
    };
  }, [videoUrl]);

  // Redraw the frame plus a vertical marker line whenever the selected column changes.
  useEffect(() => {
    if (!isFrameReady) {
      return;
    }
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (xColumn !== null) {
      ctx.beginPath();
      ctx.moveTo(xColumn, 0);
      ctx.lineTo(xColumn, canvas.height);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [xColumn, isFrameReady]);

  function handlePreviewClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }

    // Map the click back to true canvas pixel coordinates, same as CalibrationCanvas.
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    setXColumn(x);
  }

  const parsedSampleRate = parseFloat(sampleRateHz);
  const parsedBaselineY = baselineY.trim() === "" ? null : parseInt(baselineY, 10);

  const canStart =
    isFrameReady &&
    !isProcessing &&
    xColumn !== null &&
    Number.isFinite(parsedSampleRate) &&
    parsedSampleRate > 0;

  async function handleStart() {
    const video = videoRef.current;
    const canvas = processingCanvasRef.current;
    if (!video || !canvas || !canStart || xColumn === null) {
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setResultCount(null);

    try {
      const data = await processVideo(video, canvas, calibration, {
        xColumn,
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
      {/* Off-screen video/canvas used only to seek and sample frames during processing. */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={processingCanvasRef} className="hidden" />

      {!isFrameReady && (
        <p className="text-sm text-zinc-500">Loading first frame…</p>
      )}

      <canvas
        ref={previewCanvasRef}
        onClick={handlePreviewClick}
        className="w-full max-w-full cursor-crosshair rounded-lg border border-zinc-200 dark:border-zinc-800"
      />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Click on the frame above at the point where you want to measure the water
        surface (e.g. along the ruler, where the water line will cross).
        {xColumn !== null && ` Selected column: x = ${xColumn}px.`}
      </p>

      <div className="flex flex-wrap items-end gap-3">
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
