"use client";

import { useEffect, useRef, useState } from "react";
import type { MeasurementPoint, RulerCalibration } from "@/types/wave";

interface PointSelectorProps {
  videoUrl: string;
  onChange: (points: MeasurementPoint[]) => void;
  maxPoints?: number;
  /** When set, clicks are interpreted as an offset (cm) from the ruler's center column instead of a raw pixel column, and each point needs a baseline entered in cm. */
  rulerCalibration?: RulerCalibration | null;
}

const DEFAULT_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
];

let pointIdCounter = 0;
function generatePointId(): string {
  pointIdCounter += 1;
  return `point-${Date.now()}-${pointIdCounter}`;
}

export default function PointSelector({
  videoUrl,
  onChange,
  maxPoints = 8,
  rulerCalibration = null,
}: PointSelectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFrameReady, setIsFrameReady] = useState(false);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);

  // Load the video off-screen and draw its first frame, same pattern as
  // CalibrationCanvas/ProcessingPanel.
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

  // Redraw the frame plus one colored vertical line per point.
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
      ctx.moveTo(point.xColumn, 0);
      ctx.lineTo(point.xColumn, canvas.height);
      ctx.strokeStyle = point.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [points, isFrameReady]);

  // Notify the parent whenever the point list changes.
  useEffect(() => {
    onChange(points);
    // Only re-sync when the points themselves change, not when the parent
    // passes a new `onChange` function identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Only used to place a new point's initial xOffsetCm/xColumn preview — the
  // *live* pixel position during actual processing always comes from
  // RulerCalibrationTracker, which is re-derived every frame.
  function getRulerInfo() {
    if (!rulerCalibration) {
      return null;
    }
    const { point1, point2, roi } = rulerCalibration;
    const pixelsPerCm = (point2.y - point1.y) / (point2.valueCm - point1.valueCm);
    const centerX = roi.x + roi.width / 2;
    return { pixelsPerCm, centerX };
  }

  function handleCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (points.length >= maxPoints) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = Math.round((event.clientX - rect.left) * scaleX);

    const rulerInfo = getRulerInfo();
    const xOffsetCm = rulerInfo ? (x - rulerInfo.centerX) / rulerInfo.pixelsPerCm : 0;

    const newPoint: MeasurementPoint = {
      id: generatePointId(),
      xColumn: x,
      label: `Point ${points.length + 1}`,
      color: DEFAULT_COLORS[points.length % DEFAULT_COLORS.length],
      baselineY: null,
      baselineValueCm: null,
      xOffsetCm,
    };

    setPoints((prev) => [...prev, newPoint]);
  }

  function handleRemove(id: string) {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }

  function handleLabelChange(id: string, label: string) {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)));
  }

  function handleBaselineValueChange(id: string, value: string) {
    const parsed = value.trim() === "" ? null : parseFloat(value);
    setPoints((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, baselineValueCm: parsed !== null && Number.isFinite(parsed) ? parsed : null }
          : p
      )
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} className="hidden" muted playsInline />

      {!isFrameReady && (
        <p className="text-sm text-zinc-500">Loading first frame…</p>
      )}

      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full max-w-full cursor-crosshair rounded-lg border border-zinc-200 dark:border-zinc-800"
      />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Click on the frame to add a measurement point ({points.length}/{maxPoints}).
        {rulerCalibration &&
          " Each point also needs its still-water level entered in cm below."}
      </p>

      {points.length >= maxPoints && (
        <p className="text-sm text-amber-600">
          Maximum of {maxPoints} measurement points reached. Remove one to add another.
        </p>
      )}

      {points.length > 0 && (
        <ul className="flex flex-col gap-2">
          {points.map((point) => (
            <li key={point.id} className="flex flex-wrap items-center gap-2">
              <span
                className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: point.color }}
                aria-hidden
              />
              <input
                type="text"
                value={point.label}
                onChange={(event) => handleLabelChange(point.id, event.target.value)}
                aria-label={`Label for measurement point at x=${point.xColumn}`}
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              {rulerCalibration ? (
                <label className="flex items-center gap-1 text-xs">
                  Baseline (cm):
                  <input
                    type="number"
                    step="any"
                    value={point.baselineValueCm ?? ""}
                    onChange={(event) =>
                      handleBaselineValueChange(point.id, event.target.value)
                    }
                    aria-label={`Baseline in cm for ${point.label}`}
                    className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              ) : (
                <span className="text-xs text-zinc-500">x={point.xColumn}px</span>
              )}
              <button
                type="button"
                onClick={() => handleRemove(point.id)}
                aria-label={`Remove ${point.label}`}
                className="rounded-full border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
