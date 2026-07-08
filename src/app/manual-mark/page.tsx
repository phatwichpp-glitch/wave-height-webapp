"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WaveDataPoint, WaveStatistics } from "@/types/wave";
import { captureFrameAtTime } from "@/lib/videoProcessor";
import {
  computeWaveStatistics,
  estimateDominantPeriod,
  type SpectralPeriodResult,
} from "@/lib/waveStatistics";
import { resampleToUniformGrid } from "@/lib/resample";
import { downloadCSV, waveDataToCSV } from "@/lib/csvExport";
import ManualMarkChart from "./ManualMarkChart";

// This whole page is deliberately independent of the auto-detection pipeline
// (RulerCalibrationPanel, MeasurementPoint, the worker, SurfaceTracker) — a
// human reading the ruler by eye already *is* the calibration, so there is no
// pixel/calibration state to track here at all. Only pure, calibration-free
// helpers are reused: captureFrameAtTime (just draws a frame), the wave
// statistics/FFT functions, resampleToUniformGrid, and the CSV export helpers.

type Stage = "setup" | "marking" | "summary";
type StepMode = "interval" | "frame";

interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PixelPoint = { x: number; y: number };

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
const DEFAULT_INTERVAL_S = 0.5;
const DEFAULT_VIDEO_FPS = 30;
const RECENT_ENTRIES_SHOWN = 10;
const DISPLAY_CANVAS_TARGET_WIDTH = 800;
const TIMEUPDATE_THROTTLE_MS = 100;

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

export default function ManualMarkPage() {
  const [stage, setStage] = useState<Stage>("setup");

  // Video
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFrameReady, setIsFrameReady] = useState(false);
  const [durationS, setDurationS] = useState(0);
  const drawGenerationRef = useRef(0);

  // Setup: scrub + preview playback
  const [scrubTimeS, setScrubTimeS] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const lastTimeUpdateRef = useRef(0);

  // Setup: reference time, expected frequency, step mode
  const [referenceTimeS, setReferenceTimeS] = useState<number | null>(null);
  const [expectedFrequencyHz, setExpectedFrequencyHz] = useState("");
  const [stepMode, setStepMode] = useState<StepMode>("interval");
  const [intervalS, setIntervalS] = useState(String(DEFAULT_INTERVAL_S));
  const intervalManuallyEditedRef = useRef(false);
  const [videoFps, setVideoFps] = useState(String(DEFAULT_VIDEO_FPS));

  // ROI (reading aid — Part 4.1)
  const [roi, setRoi] = useState<Roi | null>(null);
  const [isAdjustingRoi, setIsAdjustingRoi] = useState(false);
  const [dragStart, setDragStart] = useState<PixelPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<PixelPoint | null>(null);

  // Reading aids — Part 4.2
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  // Marking
  const [currentAnnotationTimeS, setCurrentAnnotationTimeS] = useState(0);
  const [dataPoints, setDataPoints] = useState<WaveDataPoint[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const parsedExpectedFrequencyHz = parseFloat(expectedFrequencyHz);
  const hasExpectedFrequency = Number.isFinite(parsedExpectedFrequencyHz) && parsedExpectedFrequencyHz > 0;
  const suggestedIntervalS = hasExpectedFrequency ? 1 / parsedExpectedFrequencyHz / 10 : null;

  // Auto-fill the suggested interval once a usable expected frequency is
  // entered, but only until the user actually types their own value — never
  // clobber a manual edit.
  useEffect(() => {
    if (suggestedIntervalS !== null && !intervalManuallyEditedRef.current) {
      setIntervalS(suggestedIntervalS.toFixed(3));
    }
  }, [suggestedIntervalS]);

  const parsedIntervalS = parseFloat(intervalS);
  const parsedVideoFps = parseFloat(videoFps);
  const stepS =
    stepMode === "interval"
      ? Number.isFinite(parsedIntervalS) && parsedIntervalS > 0
        ? parsedIntervalS
        : DEFAULT_INTERVAL_S
      : Number.isFinite(parsedVideoFps) && parsedVideoFps > 0
        ? 1 / parsedVideoFps
        : 1 / DEFAULT_VIDEO_FPS;

  // --- Frame drawing -------------------------------------------------------

  /** Paints the display canvas from whatever's currently in the offscreen canvas (no seeking) — cheap and synchronous, safe to call on every drag mousemove. */
  function paintDisplayFromOffscreen(dragRectNative?: Roi | null) {
    const display = displayCanvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!display || !offscreen || offscreen.width === 0) {
      return;
    }
    const ctx = display.getContext("2d");
    if (!ctx) {
      return;
    }

    const showFullFrame = isAdjustingRoi || !roi;
    const src: Roi = showFullFrame
      ? { x: 0, y: 0, width: offscreen.width, height: offscreen.height }
      : roi!;

    const targetWidth = DISPLAY_CANVAS_TARGET_WIDTH;
    const targetHeight = Math.max(1, Math.round(targetWidth * (src.height / src.width)));
    if (display.width !== targetWidth || display.height !== targetHeight) {
      display.width = targetWidth;
      display.height = targetHeight;
    }

    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(offscreen, src.x, src.y, src.width, src.height, 0, 0, display.width, display.height);

    if (dragRectNative) {
      // Drag rectangles are always drawn against the full (unscaled-crop) frame.
      const scaleX = display.width / offscreen.width;
      const scaleY = display.height / offscreen.height;
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        dragRectNative.x * scaleX,
        dragRectNative.y * scaleY,
        dragRectNative.width * scaleX,
        dragRectNative.height * scaleY
      );
    }
  }

  /** Seeks to timeS (via captureFrameAtTime — the one auto-pipeline helper this page reuses, purely to paint a frame) and repaints the display canvas. */
  async function redrawFrame(timeS: number) {
    const video = videoRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!video || !offscreen) {
      return;
    }
    const myGeneration = ++drawGenerationRef.current;
    try {
      await captureFrameAtTime(video, offscreen, timeS);
    } catch {
      return; // seek failed entirely — leave whatever was last shown
    }
    if (myGeneration !== drawGenerationRef.current) {
      return; // superseded by a newer redraw request
    }
    paintDisplayFromOffscreen();
  }

  // --- Video loading ---------------------------------------------------------

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    videoUrlRef.current = url;
    setVideoUrl(url);
    setStage("setup");
    setReferenceTimeS(null);
    setRoi(null);
    setIsAdjustingRoi(false);
    setDataPoints([]);
    setScrubTimeS(0);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      return;
    }

    setIsFrameReady(false);

    function handleLoadedMetadata() {
      if (video) {
        setDurationS(video.duration || 0);
      }
    }
    function handleLoadedData() {
      setIsFrameReady(true);
      setScrubTimeS(0);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleLoadedData);
    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
    };
  }, [videoUrl]);

  // Paint the first frame once the canvas has actually mounted. Doing this
  // directly inside the native 'loadeddata' listener above would race the
  // display canvas's own mount (it only renders once isFrameReady flips
  // true), silently losing the first frame if the paint lands before React
  // commits the canvas — a useEffect keyed on isFrameReady always runs after
  // the DOM commit, so the ref is guaranteed to exist here.
  useEffect(() => {
    if (isFrameReady) {
      redrawFrame(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFrameReady]);

  // --- Setup-stage preview playback (Part 4.3 — speed control only applies here) --

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    function handleTimeUpdate() {
      if (!isPlaying || !video) {
        return;
      }
      const now = Date.now();
      if (now - lastTimeUpdateRef.current < TIMEUPDATE_THROTTLE_MS) {
        return;
      }
      lastTimeUpdateRef.current = now;
      setScrubTimeS(video.currentTime);
      redrawFrame(video.currentTime);
    }
    function handlePauseOrEnded() {
      setIsPlaying(false);
    }
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("pause", handlePauseOrEnded);
    video.addEventListener("ended", handlePauseOrEnded);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("pause", handlePauseOrEnded);
      video.removeEventListener("ended", handlePauseOrEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  function handleTogglePlay() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.playbackRate = playbackSpeed;
      video.play();
      setIsPlaying(true);
    }
  }

  function handleScrub(event: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(event.target.value);
    setScrubTimeS(t);
    const video = videoRef.current;
    if (video) {
      video.currentTime = t;
    }
    redrawFrame(t);
  }

  function handleSetReferenceTime() {
    setReferenceTimeS(scrubTimeS);
    setIsAdjustingRoi(true);
    redrawFrame(scrubTimeS);
  }

  // --- ROI drawing (Part 4.1) ------------------------------------------------

  function getNativeCanvasPoint(event: React.MouseEvent<HTMLCanvasElement>): PixelPoint {
    const display = displayCanvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!display || !offscreen || display.width === 0) {
      return { x: 0, y: 0 };
    }
    const rect = display.getBoundingClientRect();
    const scaleXToDisplay = display.width / rect.width;
    const scaleYToDisplay = display.height / rect.height;
    const displayX = (event.clientX - rect.left) * scaleXToDisplay;
    const displayY = (event.clientY - rect.top) * scaleYToDisplay;
    // The display canvas shows the *full* frame (scaled) while adjusting the
    // ROI, so one more scale step recovers true native video pixel coordinates.
    const scaleXToNative = offscreen.width / display.width;
    const scaleYToNative = offscreen.height / display.height;
    return {
      x: Math.round(displayX * scaleXToNative),
      y: Math.round(displayY * scaleYToNative),
    };
  }

  function handleRoiMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isAdjustingRoi) {
      return;
    }
    const point = getNativeCanvasPoint(event);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handleRoiMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isAdjustingRoi || !dragStart) {
      return;
    }
    const point = getNativeCanvasPoint(event);
    setDragCurrent(point);
    const rect: Roi = {
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    };
    paintDisplayFromOffscreen(rect);
  }

  function handleRoiMouseUp() {
    if (!isAdjustingRoi || !dragStart || !dragCurrent) {
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    if (width < 8 || height < 8) {
      return; // ignore an accidental tiny drag/click
    }
    setRoi({ x, y, width, height });
    setIsAdjustingRoi(false);
  }

  function handleClearRoi() {
    setRoi(null);
    setIsAdjustingRoi(false);
    paintDisplayFromOffscreen();
  }

  function handleAdjustRoiAgain() {
    setIsAdjustingRoi(true);
    // Show the frame currently being annotated, full, ready to redraw the box.
    redrawFrame(stage === "marking" ? currentAnnotationTimeS : scrubTimeS);
  }

  // --- Marking stage -----------------------------------------------------

  function handleStartMarking() {
    if (referenceTimeS === null) {
      return;
    }
    setCurrentAnnotationTimeS(referenceTimeS);
    setIsAdjustingRoi(false);
    setStage("marking");
    redrawFrame(referenceTimeS);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  useEffect(() => {
    if (stage !== "marking" || isAdjustingRoi) {
      return;
    }
    redrawFrame(currentAnnotationTimeS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAnnotationTimeS, stage, isAdjustingRoi, roi]);

  function refocusInput() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commitValue() {
    const parsed = parseFloat(inputValue);
    if (!Number.isFinite(parsed)) {
      refocusInput();
      return;
    }

    if (editingIndex !== null) {
      const index = editingIndex;
      setDataPoints((prev) =>
        prev.map((d, i) => (i === index ? { ...d, elevationCm: parsed } : d))
      );
      setEditingIndex(null);
    } else {
      const relativeTimeS = currentAnnotationTimeS - (referenceTimeS ?? 0);
      setDataPoints((prev) => [...prev, { timeS: relativeTimeS, elevationCm: parsed, confidence: 1 }]);
      setCurrentAnnotationTimeS((t) => Math.min(durationS, t + stepS));
    }
    setInputValue("");
    refocusInput();
  }

  function handleStepTime(deltaSteps: number) {
    setCurrentAnnotationTimeS((t) => Math.max(0, Math.min(durationS, t + deltaSteps * stepS)));
    refocusInput();
  }

  function handleUndo() {
    setDataPoints((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      return prev.slice(0, -1);
    });
    setCurrentAnnotationTimeS((t) => Math.max(0, t - stepS));
    setEditingIndex(null);
    setInputValue("");
    refocusInput();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitValue();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      handleStepTime(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      handleStepTime(-1);
    }
  }

  function handleEditEntry(index: number) {
    setEditingIndex(index);
    setInputValue(String(dataPoints[index].elevationCm));
    refocusInput();
  }

  const recentStartIndex = Math.max(0, dataPoints.length - RECENT_ENTRIES_SHOWN);
  const recentEntries = dataPoints
    .slice(recentStartIndex)
    .map((d, i) => ({ ...d, index: recentStartIndex + i }));

  // --- Summary stage -------------------------------------------------------

  const summary = useMemo(() => {
    if (dataPoints.length === 0) {
      return null;
    }
    const timeS = dataPoints.map((d) => d.timeS);
    const elevationCm = dataPoints.map((d) => d.elevationCm);
    const estimatedSampleRateHz = 1 / stepS;
    const detrendWindowSeconds = hasExpectedFrequency ? 3 / parsedExpectedFrequencyHz : undefined;
    const frequencyRangeHz: [number, number] | undefined = hasExpectedFrequency
      ? [parsedExpectedFrequencyHz * 0.5, parsedExpectedFrequencyHz * 1.5]
      : undefined;

    let stats: WaveStatistics | null = null;
    let statsError: string | null = null;
    try {
      stats = computeWaveStatistics(timeS, elevationCm, {
        sampleRateHz: estimatedSampleRateHz,
        detrendWindowSeconds,
      });
    } catch (err) {
      statsError = err instanceof Error ? err.message : String(err);
    }

    let spectral: SpectralPeriodResult | null = null;
    let spectralError: string | null = null;
    // Manual entries may be unevenly spaced (prev/next mixed in with real
    // marks) — always resample onto a uniform grid before FFT, same as the
    // frame-callback processing mode does (Phase 14).
    if (dataPoints.length > 20) {
      try {
        const sortedTimeS = [...timeS].sort((a, b) => a - b);
        const spanS = sortedTimeS[sortedTimeS.length - 1] - sortedTimeS[0];
        const resampled = resampleToUniformGrid(dataPoints, estimatedSampleRateHz, spanS);
        spectral = estimateDominantPeriod(
          resampled.map((d) => d.elevationCm),
          estimatedSampleRateHz,
          detrendWindowSeconds,
          frequencyRangeHz
        );
      } catch (err) {
        spectralError = err instanceof Error ? err.message : String(err);
      }
    }

    return { stats, statsError, spectral, spectralError, estimatedSampleRateHz };
  }, [dataPoints, stepS, hasExpectedFrequency, parsedExpectedFrequencyHz]);

  function handleDownloadCSV() {
    downloadCSV(waveDataToCSV(dataPoints), "manual-mark_raw_data.csv");
  }

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Manual Annotation Tool
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Read a ruler by eye and type values in as you watch the video — completely
            independent of the automatic detection pipeline (no pixel calibration needed).
          </p>
        </header>

        {/* Hidden video + offscreen capture canvas, shared by every stage. */}
        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={offscreenCanvasRef} className="hidden" />

        {stage === "setup" && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Upload a video</label>
              <input type="file" accept="video/*" onChange={handleFileChange} />
            </div>

            {videoUrl && !isFrameReady && (
              <p className="text-sm text-zinc-500">Loading first frame…</p>
            )}

            {videoUrl && isFrameReady && (
              <>
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handleRoiMouseDown}
                  onMouseMove={handleRoiMouseMove}
                  onMouseUp={handleRoiMouseUp}
                  className={`w-full max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800 ${
                    isAdjustingRoi ? "cursor-crosshair" : ""
                  }`}
                />

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
                    step={0.01}
                    value={scrubTimeS}
                    onChange={handleScrub}
                    aria-label="Video scrubber"
                    className="flex-1"
                  />
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                    {scrubTimeS.toFixed(1)}s
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    Speed
                    <select
                      value={playbackSpeed}
                      onChange={(event) => setPlaybackSpeed(parseFloat(event.target.value))}
                      aria-label="Preview playback speed"
                      className="rounded border border-zinc-300 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <option key={speed} value={speed}>
                          {speed}x
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleSetReferenceTime}
                  className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Set as start time (t=0)
                </button>

                {referenceTimeS !== null && (
                  <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Start time set to {referenceTimeS.toFixed(2)}s.
                      {isAdjustingRoi
                        ? " Drag a box around the ruler + water surface to zoom into it while marking (optional)."
                        : roi
                          ? " A reading region is set."
                          : " No reading region set — the full frame will be shown while marking."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleAdjustRoiAgain}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {roi ? "Redraw reading region" : "Draw reading region"}
                      </button>
                      {roi && (
                        <button
                          type="button"
                          onClick={handleClearRoi}
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Clear (use full frame)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Expected wave frequency (Hz, optional)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={expectedFrequencyHz}
                      onChange={(event) => setExpectedFrequencyHz(event.target.value)}
                      placeholder="e.g. 0.4"
                      className="w-40 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setStepMode("interval")}
                      className={`rounded-full border px-3 py-1 ${
                        stepMode === "interval"
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                          : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                      }`}
                    >
                      Fixed interval
                    </button>
                    <button
                      type="button"
                      onClick={() => setStepMode("frame")}
                      className={`rounded-full border px-3 py-1 ${
                        stepMode === "frame"
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                          : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                      }`}
                    >
                      Real frame-by-frame
                    </button>
                  </div>

                  {stepMode === "interval" ? (
                    <label className="flex flex-col gap-1 text-sm">
                      Step interval (s)
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={intervalS}
                        onChange={(event) => {
                          intervalManuallyEditedRef.current = true;
                          setIntervalS(event.target.value);
                        }}
                        className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      {suggestedIntervalS !== null && (
                        <span className="text-xs text-zinc-500">
                          Suggested from expected frequency: {suggestedIntervalS.toFixed(3)}s
                        </span>
                      )}
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1 text-sm">
                      Video frame rate (fps)
                      <input
                        type="number"
                        min={1}
                        step="any"
                        value={videoFps}
                        onChange={(event) => setVideoFps(event.target.value)}
                        className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      {/* Browsers don't expose a reliable, precise fps reading via any
                          standard API, so this is an estimate the user supplies — close
                          enough for manual annotation, not frame-exact. */}
                      <span className="text-xs text-zinc-500">
                        Approximate — browsers don&apos;t expose the video&apos;s exact fps.
                      </span>
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  disabled={referenceTimeS === null}
                  onClick={handleStartMarking}
                  className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Start marking
                </button>
              </>
            )}
          </section>
        )}

        {stage === "marking" && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="flex flex-1 flex-col gap-2">
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handleRoiMouseDown}
                  onMouseMove={handleRoiMouseMove}
                  onMouseUp={handleRoiMouseUp}
                  style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
                  className={`w-full max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800 ${
                    isAdjustingRoi ? "cursor-crosshair" : ""
                  }`}
                />

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    Brightness
                    <input
                      type="range"
                      min={50}
                      max={200}
                      value={brightness}
                      onChange={(event) => setBrightness(Number(event.target.value))}
                      aria-label="Brightness"
                    />
                    {brightness}%
                  </label>
                  <label className="flex items-center gap-2">
                    Contrast
                    <input
                      type="range"
                      min={50}
                      max={200}
                      value={contrast}
                      onChange={(event) => setContrast(Number(event.target.value))}
                      aria-label="Contrast"
                    />
                    {contrast}%
                  </label>
                  <button
                    type="button"
                    onClick={handleAdjustRoiAgain}
                    className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Redraw reading region
                  </button>
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 lg:w-64">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Recent entries
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {recentEntries.length === 0 && (
                    <li className="text-zinc-400">No entries yet.</li>
                  )}
                  {[...recentEntries].reverse().map((entry) => (
                    <li key={entry.index}>
                      <button
                        type="button"
                        onClick={() => handleEditEntry(entry.index)}
                        className={`flex w-full justify-between rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          editingIndex === entry.index ? "bg-zinc-100 dark:bg-zinc-800" : ""
                        }`}
                      >
                        <span className="tabular-nums text-zinc-500">
                          t={formatSeconds(entry.timeS)}s
                        </span>
                        <span className="tabular-nums font-medium">{entry.elevationCm}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <ManualMarkChart data={dataPoints} variant="compact" />
              </div>
            </div>

            <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              t = {formatSeconds(currentAnnotationTimeS - (referenceTimeS ?? 0))}s
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleStepTime(-1)}
                className="rounded-full border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                ◀ Previous
              </button>

              <input
                ref={inputRef}
                type="number"
                step="0.01"
                autoFocus
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleInputKeyDown}
                aria-label="Reading value in cm"
                placeholder="Value (cm)"
                className="w-32 rounded border border-zinc-300 px-3 py-2 text-lg dark:border-zinc-700 dark:bg-zinc-900"
              />

              <button
                type="button"
                onClick={() => handleStepTime(1)}
                className="rounded-full border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next ▶
              </button>

              <button
                type="button"
                onClick={handleUndo}
                disabled={dataPoints.length === 0}
                className="rounded-full border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                ↩ Undo last
              </button>

              <button
                type="button"
                onClick={() => setStage("summary")}
                className="ml-auto rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                ■ Stop marking / view results
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Press Enter to save and move to the next point ({stepS.toFixed(3)}s step) — the
              input refocuses automatically. Arrow keys move the frame without saving.
            </p>
          </section>
        )}

        {stage === "summary" && (
          <section className="flex flex-col gap-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Results</h2>

            {dataPoints.length === 0 ? (
              <p className="text-sm text-zinc-500">No data points marked yet.</p>
            ) : (
              <>
                {summary?.statsError && (
                  <p className="text-sm text-red-600">
                    Could not compute wave statistics — {summary.statsError}
                  </p>
                )}

                {summary?.stats && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] border-collapse text-sm">
                      <tbody>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-zinc-500">Waves detected</td>
                          <td className="py-1 font-medium">{summary.stats.nWaves}</td>
                        </tr>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-zinc-500">H max (cm)</td>
                          <td className="py-1 font-medium">{summary.stats.hMax.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-zinc-500">H mean (cm)</td>
                          <td className="py-1 font-medium">{summary.stats.hMean.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-zinc-500">H significant (cm)</td>
                          <td className="py-1 font-medium">{summary.stats.hSignificant.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-4 text-zinc-500">
                            Mean period — zero up-crossing (s)
                          </td>
                          <td className="py-1 font-medium">{summary.stats.periodMeanS.toFixed(3)}</td>
                        </tr>
                        {summary.spectral && (
                          <tr>
                            <td className="py-1 pr-4 text-zinc-500">Dominant period — FFT (s)</td>
                            <td className="py-1 font-medium">
                              {summary.spectral.dominantPeriodS.toFixed(3)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {summary?.spectralError && dataPoints.length > 20 && (
                  <p className="text-sm text-amber-600">
                    Could not compute an FFT period estimate — {summary.spectralError}
                  </p>
                )}

                {hasExpectedFrequency && summary?.stats && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                          <th className="py-2 pr-4">Method</th>
                          <th className="py-2 pr-4">Set (Hz)</th>
                          <th className="py-2 pr-4">Measured (Hz)</th>
                          <th className="py-2 pr-4">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-zinc-100 dark:border-zinc-900">
                          <td className="py-2 pr-4">Zero up-crossing</td>
                          <td className="py-2 pr-4">{parsedExpectedFrequencyHz.toFixed(3)}</td>
                          <td className="py-2 pr-4">
                            {(1 / summary.stats.periodMeanS).toFixed(3)}
                          </td>
                          <td className="py-2 pr-4">
                            {(
                              (Math.abs(1 / summary.stats.periodMeanS - parsedExpectedFrequencyHz) /
                                parsedExpectedFrequencyHz) *
                              100
                            ).toFixed(1)}
                            %
                          </td>
                        </tr>
                        {summary.spectral && (
                          <tr>
                            <td className="py-2 pr-4">FFT</td>
                            <td className="py-2 pr-4">{parsedExpectedFrequencyHz.toFixed(3)}</td>
                            <td className="py-2 pr-4">
                              {summary.spectral.dominantFrequencyHz.toFixed(3)}
                            </td>
                            <td className="py-2 pr-4">
                              {(
                                (Math.abs(
                                  summary.spectral.dominantFrequencyHz - parsedExpectedFrequencyHz
                                ) /
                                  parsedExpectedFrequencyHz) *
                                100
                              ).toFixed(1)}
                              %
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                <ManualMarkChart data={dataPoints} variant="full" />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadCSV}
                    className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Download raw data (CSV)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStage("marking");
                      refocusInput();
                    }}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Continue marking
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
