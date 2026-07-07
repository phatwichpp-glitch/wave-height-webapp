"use client";

import { useEffect, useRef, useState } from "react";
import type { MeasurementPoint, RulerCalibration } from "@/types/wave";

interface PointSelectorProps {
  videoUrl: string;
  onChange: (points: MeasurementPoint[]) => void;
  maxPoints?: number;
  /** When set, clicks are interpreted as an offset (cm) from the ruler's center column instead of a raw pixel column, and each point needs a baseline entered in cm. */
  rulerCalibration?: RulerCalibration | null;
  /**
   * The exact video time (seconds) calibration was performed at (see
   * CalibrationCanvas/RulerCalibrationPanel's own onCalibrated referenceTimeS).
   * Measurement points MUST be clicked on this same frame — a pixel column
   * clicked on any other frame doesn't correspond to the physical location
   * the ruler/fixed-distance calibration was measured against, especially if
   * the camera moved between the two (Phase 15 fix: this component used to
   * always show the video's frame at t=0 regardless of what frame
   * calibration actually used). Defaults to 0 if not supplied.
   */
  referenceTimeS?: number | null;
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
  referenceTimeS = null,
}: PointSelectorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Tracks the last referenceTimeS this component actually seeked to, so a
  // later *change* (as opposed to the first time it's ever set) can be told
  // apart from the initial mount — only a real change should clear points.
  const appliedReferenceTimeSRef = useRef<number | null>(null);

  const [isFrameReady, setIsFrameReady] = useState(false);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [referenceFrameChanged, setReferenceFrameChanged] = useState(false);
  // Bumped on every 'loadeddata'/'seeked' so the redraw effect below re-runs.
  // See the effect's own comment for why there's no one-shot "draw once" path.
  const [frameVersion, setFrameVersion] = useState(0);

  // Load the video off-screen and drive the visible canvas purely off
  // `frameVersion` — there is deliberately no one-shot "draw the first frame
  // once" path here. A browser can fire 'loadeddata' before the frame is
  // genuinely decodable, and drawImage at that instant silently paints
  // blank/placeholder content; a one-shot guard would then permanently lock
  // that bad frame in, even once 'seeked' (or anything else) later had real
  // pixel data ready (Phase 13 fix — this used to require a manual "Reset"
  // click elsewhere on the page to force a redraw after the video had
  // actually caught up). A couple of rAF-deferred bumps after load self-heal
  // even if the browser never fires a follow-up event for an at-rest video.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setIsFrameReady(false);
    setPoints([]);
    setReferenceFrameChanged(false);
    appliedReferenceTimeSRef.current = null;

    let cancelled = false;
    function bumpFrame() {
      if (!cancelled) {
        setFrameVersion((v) => v + 1);
      }
    }

    function handleLoadedData() {
      if (!video) {
        return;
      }
      // No explicit seek here — the reference-frame effect below performs
      // the one seek that actually matters (to referenceTimeS) as soon as
      // isFrameReady flips true, so the video isn't seeked twice on mount.
      setIsFrameReady(true);
      bumpFrame();
      requestAnimationFrame(bumpFrame);
      requestAnimationFrame(() => requestAnimationFrame(bumpFrame));
    }

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("seeked", bumpFrame);

    video.src = videoUrl;
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("seeked", bumpFrame);
    };
  }, [videoUrl]);

  // Seeks to the shared calibration reference frame once the video is ready,
  // and again whenever referenceTimeS itself changes (e.g. the user redid
  // calibration on a different frame after already picking measurement
  // points here). A *change* (not the initial seek on mount) means any
  // existing points were clicked on what may now be a different physical
  // scene — their pixel positions aren't safe to carry over, so they're
  // cleared and the user is warned to re-add them, rather than silently
  // leaving stale positions in place (Phase 15).
  useEffect(() => {
    if (!isFrameReady) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const target = referenceTimeS ?? 0;
    const previouslyApplied = appliedReferenceTimeSRef.current;
    const isRealChange = previouslyApplied !== null && Math.abs(previouslyApplied - target) > 1e-6;

    video.currentTime = target;
    appliedReferenceTimeSRef.current = target;

    if (isRealChange) {
      setPoints((prevPoints) => {
        if (prevPoints.length > 0) {
          setReferenceFrameChanged(true);
        }
        return [];
      });
    }
  }, [referenceTimeS, isFrameReady]);

  // Redraw the frame plus one colored vertical line per point, whenever
  // those change OR the video has settled into its real decoded frame
  // (see frameVersion above).
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

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
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
    // frameVersion is read only to retrigger this effect once the video's
    // real frame is ready — it isn't used in the body itself (the redraw
    // always reads the video element's *current* frame directly).
  }, [points, isFrameReady, frameVersion]);

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
    // Magnitude only: the raw ratio is negative when ruler values increase
    // upward, but xOffsetCm is defined as "positive = right" regardless of the
    // ruler's vertical direction (matching RulerCalibrationTracker.pixelXForOffset).
    const pixelsPerCm = Math.abs(
      (point2.y - point1.y) / (point2.valueCm - point1.valueCm)
    );
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

    setReferenceFrameChanged(false);
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
      {/* Keyed on videoUrl so React fully unmounts/remounts this DOM node on
          every file switch — a defense-in-depth guard (Phase 13) against any
          stale native video/decode state surviving across an upload. */}
      <video ref={videoRef} key={videoUrl} className="hidden" muted playsInline />

      {!isFrameReady && (
        <p className="text-sm text-zinc-500">Loading first frame…</p>
      )}

      {isFrameReady && (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Showing frame at {(referenceTimeS ?? 0).toFixed(1)}s — the same reference frame used
          for calibration, so measurement points line up with it exactly.
        </p>
      )}

      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full max-w-full cursor-crosshair rounded-lg border border-zinc-200 dark:border-zinc-800"
      />

      {referenceFrameChanged && (
        <p className="text-sm text-amber-600">
          The calibration reference frame changed — previous measurement points were cleared
          since they may no longer match this frame. Please re-add them.
        </p>
      )}

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
