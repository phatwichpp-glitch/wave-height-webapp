"use client";

import { useEffect, useRef, useState } from "react";
import type { RulerCalibration } from "@/types/wave";

interface RulerCalibrationPanelProps {
  videoUrl: string;
  /** referenceTimeS is the video's currentTime at the moment calibration was confirmed — see ProcessingPanel's calibrationReferenceTimeS prop for why this matters. */
  onCalibrated: (calibration: RulerCalibration, cmPerTick: number, referenceTimeS: number) => void;
}

type PixelPoint = { x: number; y: number };
type TickClick = PixelPoint & { valueCm: string };
type Roi = { x: number; y: number; width: number; height: number };

// 'timeupdate' fires many times a second during playback; redrawing the
// canvas on every single one is wasted work; this floors the redraw rate.
const TIMEUPDATE_THROTTLE_MS = 100;

export default function RulerCalibrationPanel({
  videoUrl,
  onCalibrated,
}: RulerCalibrationPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTimeUpdateRef = useRef(0);

  const [isFrameReady, setIsFrameReady] = useState(false);
  const [roi, setRoi] = useState<Roi | null>(null);
  const [dragStart, setDragStart] = useState<PixelPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<PixelPoint | null>(null);
  const [tickClicks, setTickClicks] = useState<TickClick[]>([]);
  const [cmPerTick, setCmPerTick] = useState("1");
  const [durationS, setDurationS] = useState(0);
  const [currentTimeS, setCurrentTimeS] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Bumped on every 'seeked'/'timeupdate' so the redraw effect below re-runs
  // even when currentTimeS's *value* happens to land back on something
  // already seen (e.g. scrubbing back and forth across the same frame).
  const [frameVersion, setFrameVersion] = useState(0);

  // Load the video off-screen and draw its first frame, same pattern as the
  // other calibration/selection components. Once ready, the user is free to
  // scrub to any other frame as the calibration reference (Phase 12).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let hasDrawnFrame = false;
    setIsFrameReady(false);
    setRoi(null);
    setTickClicks([]);
    setCurrentTimeS(0);
    setIsPlaying(false);

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
        setDurationS(video.duration || 0);
      }
      drawFirstFrame();
    }

    function handleSeeked() {
      setFrameVersion((v) => v + 1);
    }

    function handleTimeUpdate() {
      if (!video) {
        return;
      }
      const now = Date.now();
      if (now - lastTimeUpdateRef.current < TIMEUPDATE_THROTTLE_MS) {
        return;
      }
      lastTimeUpdateRef.current = now;
      setCurrentTimeS(video.currentTime);
      setFrameVersion((v) => v + 1);
    }

    function handlePlay() {
      setIsPlaying(true);
    }
    function handlePauseOrEnded() {
      setIsPlaying(false);
    }

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("seeked", drawFirstFrame);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePauseOrEnded);
    video.addEventListener("ended", handlePauseOrEnded);

    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("seeked", drawFirstFrame);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePauseOrEnded);
      video.removeEventListener("ended", handlePauseOrEnded);
    };
  }, [videoUrl]);

  // Redraw the base frame plus the ROI box (finalized or mid-drag) and any
  // tick clicks, whenever those change OR the video has moved to a different
  // frame (scrub/play/pause).
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

    const activeRoi: Roi | null =
      roi ??
      (dragStart && dragCurrent
        ? {
            x: Math.min(dragStart.x, dragCurrent.x),
            y: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
          }
        : null);

    if (activeRoi) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.strokeRect(activeRoi.x, activeRoi.y, activeRoi.width, activeRoi.height);
    }

    for (const tick of tickClicks) {
      ctx.beginPath();
      ctx.arc(tick.x, tick.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
    }

    if (tickClicks.length === 2) {
      ctx.beginPath();
      ctx.moveTo(tickClicks[0].x, tickClicks[0].y);
      ctx.lineTo(tickClicks[1].x, tickClicks[1].y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // frameVersion is read only to retrigger this effect on scrub/play — it
    // isn't used in the body itself (the redraw always reads the video
    // element's *current* frame directly).
  }, [roi, dragStart, dragCurrent, tickClicks, isFrameReady, frameVersion]);

  function handleScrub(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const newTimeS = parseFloat(event.target.value);
    video.currentTime = newTimeS;
    // Set eagerly so the slider/number tracks the drag immediately — the
    // 'seeked' listener above re-syncs both once the browser actually gets there.
    setCurrentTimeS(newTimeS);
  }

  function handleTogglePlay() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  }

  function getCanvasPoint(event: React.MouseEvent<HTMLCanvasElement>): PixelPoint {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  }

  function handleMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    if (roi) {
      // ROI already drawn: clicks now add tick points instead of a new box.
      if (tickClicks.length >= 2) {
        return;
      }
      setTickClicks((prev) => [...prev, { ...getCanvasPoint(event), valueCm: "" }]);
      return;
    }
    const point = getCanvasPoint(event);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragStart || roi) {
      return;
    }
    setDragCurrent(getCanvasPoint(event));
  }

  function handleMouseUp() {
    if (!dragStart || !dragCurrent || roi) {
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    if (width < 4 || height < 4) {
      return; // ignore an accidental tiny drag/click
    }
    setRoi({ x, y, width, height });
  }

  function handleReset() {
    setRoi(null);
    setTickClicks([]);
    setDragStart(null);
    setDragCurrent(null);
  }

  function handleTickValueChange(index: number, value: string) {
    setTickClicks((prev) => prev.map((t, i) => (i === index ? { ...t, valueCm: value } : t)));
  }

  const parsedCmPerTick = parseFloat(cmPerTick);
  const parsedTickValues = tickClicks.map((t) => parseFloat(t.valueCm));
  const canConfirm =
    !!roi &&
    tickClicks.length === 2 &&
    parsedTickValues.every((v) => Number.isFinite(v)) &&
    parsedTickValues[0] !== parsedTickValues[1] &&
    Number.isFinite(parsedCmPerTick) &&
    parsedCmPerTick > 0;

  function handleConfirm() {
    if (!canConfirm || !roi) {
      return;
    }
    const calibration: RulerCalibration = {
      point1: { x: tickClicks[0].x, y: tickClicks[0].y, valueCm: parsedTickValues[0] },
      point2: { x: tickClicks[1].x, y: tickClicks[1].y, valueCm: parsedTickValues[1] },
      roi,
    };
    onCalibrated(calibration, parsedCmPerTick, currentTimeS);
  }

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} className="hidden" muted playsInline />

      {!isFrameReady && (
        <p className="text-sm text-zinc-500">Loading first frame…</p>
      )}

      {isFrameReady && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={durationS}
            step={0.1}
            value={currentTimeS}
            onChange={handleScrub}
            aria-label="Video scrubber"
            className="flex-1"
          />
          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {currentTimeS.toFixed(1)}s
          </span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="w-full max-w-full cursor-crosshair rounded-lg border border-zinc-200 dark:border-zinc-800"
      />

      {!roi ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Drag a box around the ruler in the frame above.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Click two tick marks on the ruler inside the box, then enter each one&apos;s
          real value below. Ticks selected: {tickClicks.length}/2.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reset
        </button>

        <label className="flex items-center gap-2 text-sm">
          Spacing between adjacent ticks (cm):
          <input
            type="number"
            min={0}
            step="any"
            value={cmPerTick}
            onChange={(event) => setCmPerTick(event.target.value)}
            className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>

      {tickClicks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tickClicks.map((tick, index) => (
            <li key={index} className="flex items-center gap-2 text-sm">
              <span>
                Tick {index + 1} (x={tick.x}, y={tick.y}) real value (cm):
              </span>
              <input
                type="number"
                step="any"
                value={tick.valueCm}
                onChange={(event) => handleTickValueChange(index, event.target.value)}
                aria-label={`Real value in cm for tick ${index + 1}`}
                className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={!canConfirm}
        onClick={handleConfirm}
        className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Confirm Ruler Calibration
      </button>
    </div>
  );
}
