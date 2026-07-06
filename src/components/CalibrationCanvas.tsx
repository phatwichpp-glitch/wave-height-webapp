"use client";

import { useEffect, useRef, useState } from "react";
import type { CalibrationData } from "@/types/wave";
import {
  calculatePixelsPerCm,
  loadCalibrationFromLocalStorage,
  saveCalibrationToLocalStorage,
} from "@/lib/calibration";

interface CalibrationCanvasProps {
  videoUrl: string;
  onCalibrated: (data: CalibrationData) => void;
}

type Point = { x: number; y: number };

export default function CalibrationCanvas({
  videoUrl,
  onCalibrated,
}: CalibrationCanvasProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFrameReady, setIsFrameReady] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [knownDistanceCm, setKnownDistanceCm] = useState("");
  // Lazy initializer (not an effect) so this doesn't trigger an extra render;
  // loadCalibrationFromLocalStorage() safely returns null when localStorage is
  // unavailable (e.g. during server rendering), so it's safe to call eagerly.
  const [savedCalibration] = useState<CalibrationData | null>(() =>
    loadCalibrationFromLocalStorage()
  );

  // Load the video off-screen, seek to the first frame, and draw it to the
  // visible canvas. Both 'loadeddata' and 'seeked' can fire depending on
  // whether the browser considers currentTime=0 a real seek, so we guard
  // with a one-shot flag and let whichever event arrives first win.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let hasDrawnFrame = false;
    setIsFrameReady(false);
    setPoints([]);

    function drawFirstFrame() {
      if (hasDrawnFrame || !video) {
        return;
      }
      const canvas = canvasRef.current;
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

  // Redraw the base frame plus click markers whenever the selected points change.
  useEffect(() => {
    if (!isFrameReady) {
      return;
    }
    const canvas = canvasRef.current;
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

    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
    }

    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [points, isFrameReady]);

  function handleCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (points.length >= 2) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    // The canvas's displayed (CSS) size can differ from its internal pixel
    // resolution, so map the click back to true canvas/video pixel coordinates.
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    const y = Math.round((event.clientY - rect.top) * scaleY);

    setPoints((prev) => [...prev, { x, y }]);
  }

  function handleReset() {
    setPoints([]);
  }

  const parsedDistance = parseFloat(knownDistanceCm);
  const canConfirm =
    points.length === 2 && !Number.isNaN(parsedDistance) && parsedDistance > 0;

  function handleConfirm() {
    if (!canConfirm) {
      return;
    }
    const pixelsPerCm = calculatePixelsPerCm(points[0], points[1], parsedDistance);
    const data: CalibrationData = {
      point1: points[0],
      point2: points[1],
      knownDistanceCm: parsedDistance,
      pixelsPerCm,
    };
    saveCalibrationToLocalStorage(data);
    onCalibrated(data);
  }

  function handleUseSaved() {
    if (savedCalibration) {
      onCalibrated(savedCalibration);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Off-screen source video used only to draw frames onto the canvas. */}
      <video ref={videoRef} className="hidden" muted playsInline />

      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full max-w-full cursor-crosshair rounded-lg border border-zinc-200 dark:border-zinc-800"
      />

      {!isFrameReady && (
        <p className="text-sm text-zinc-500">Loading first frame…</p>
      )}

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Click two points on a reference scale (e.g. a ruler) visible in the frame.
        Points selected: {points.length}/2
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>

        <label className="flex items-center gap-2 text-sm">
          Known distance (cm):
          <input
            type="number"
            min={0}
            step="any"
            value={knownDistanceCm}
            onChange={(event) => setKnownDistanceCm(event.target.value)}
            className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="button"
          disabled={!canConfirm}
          onClick={handleConfirm}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Confirm Calibration
        </button>

        {savedCalibration && (
          <button
            type="button"
            onClick={handleUseSaved}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Use saved calibration ({savedCalibration.pixelsPerCm.toFixed(2)} px/cm)
          </button>
        )}
      </div>
    </div>
  );
}
