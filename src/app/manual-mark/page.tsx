"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { captureFrameAtTime } from "@/lib/videoProcessor";
import { downloadCSV } from "@/lib/csvExport";
import {
  computeExtremaStats,
  fitSineWave,
  generateSineFitCurve,
  type ExtremaPoint,
} from "@/lib/extremaStats";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import ManualMarkChart from "./ManualMarkChart";
import HowToUseModal from "./HowToUseModal";

// Deliberately independent of the auto-detection pipeline (RulerCalibrationPanel,
// MeasurementPoint, worker, SurfaceTracker) — a human reading the ruler by eye
// already *is* the calibration. Only calibration-free helpers are reused:
// captureFrameAtTime (just draws a frame) and downloadCSV (a generic blob
// trigger). computeWaveStatistics doesn't apply here — it assumes a regularly
// sampled time series, but this tool only records sparse crest/trough extrema,
// so extremaStats.ts has its own purpose-built pairing + sine-fit statistics.

type Stage = "setup" | "marking" | "summary";

interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PixelPoint = { x: number; y: number };

interface AnnotatedExtremaPoint extends ExtremaPoint {
  id: number;
}

interface DraftShape {
  extrema: AnnotatedExtremaPoint[];
  expectedFrequencyHz: string;
  savedAt: number;
}

const DRAFT_STORAGE_KEY = "manual-mark-draft";
const DISPLAY_CANVAS_TARGET_WIDTH = 800;
const TIMEUPDATE_THROTTLE_MS = 100;
// Browsers don't expose a reliable, exact video fps, so "one frame" is
// approximated as 1/30s — close enough for nudging to a crest/trough by eye.
const FINE_STEP_S = 1 / 30;
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];
const TOAST_DURATION_MS = 2000;
const SINE_CURVE_SAMPLE_COUNT = 200;

const CREST_COLOR = "#16a34a";
const TROUGH_COLOR = "#2563eb";

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

export default function ManualMarkPage() {
  const { t } = useLanguage();
  const [stage, setStage] = useState<Stage>("setup");
  const [showHowToUse, setShowHowToUse] = useState(false);

  // Video / canvas
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFrameReady, setIsFrameReady] = useState(false);
  const [durationS, setDurationS] = useState(0);
  const drawGenerationRef = useRef(0);

  // Playback / scrub (shared by setup ROI-drawing and the marking stage)
  const [scrubTimeS, setScrubTimeS] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const lastTimeUpdateRef = useRef(0);

  // Setup
  const [expectedFrequencyHz, setExpectedFrequencyHz] = useState("");

  // Reading-region ROI — required before marking can start, redrawable later
  // if the camera shifts.
  const [roi, setRoi] = useState<Roi | null>(null);
  const [isAdjustingRoi, setIsAdjustingRoi] = useState(false);
  const [dragStart, setDragStart] = useState<PixelPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<PixelPoint | null>(null);
  // The canvas shows the full (uncropped) frame exactly when there's no ROI
  // yet or the user asked to redraw one — and dragging is only meaningful
  // while the full frame is what's actually on screen.
  const isRoiEditable = !roi || isAdjustingRoi;

  // Reading aids
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  // Data
  const [extrema, setExtrema] = useState<AnnotatedExtremaPoint[]>([]);
  const idCounterRef = useRef(0);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  // Draft restore
  const [draftPreview, setDraftPreview] = useState<DraftShape | null>(null);

  // Deliberately a useEffect, not a lazy useState initializer: this "use
  // client" page still renders once on the server (where localStorage
  // doesn't exist), so reading it synchronously during render would return a
  // different value client-side on first paint than what the server sent,
  // producing a hydration mismatch. Reading browser-only storage after mount
  // is exactly the "synchronize with an external system" case effects are
  // for.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as DraftShape;
      if (Array.isArray(parsed.extrema) && parsed.extrema.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a client-only external system (localStorage) after mount; a lazy useState initializer would cause a hydration mismatch instead (see comment above).
        setDraftPreview(parsed);
      }
    } catch {
      // Corrupt or old-format draft — ignore rather than crash the page.
    }
  }, []);

  const parsedExpectedFrequencyHz = parseFloat(expectedFrequencyHz);
  const hasExpectedFrequency =
    Number.isFinite(parsedExpectedFrequencyHz) && parsedExpectedFrequencyHz > 0;

  const isInputValid = inputValue.trim() !== "" && Number.isFinite(parseFloat(inputValue));

  // --- Draft restore (localStorage) --------------------------------------

  useEffect(() => {
    if (extrema.length === 0) {
      return;
    }
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ extrema, expectedFrequencyHz, savedAt: Date.now() })
      );
    } catch {
      // Storage full/unavailable — best-effort only, marking still works without it.
    }
  }, [extrema, expectedFrequencyHz]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (extrema.length === 0) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [extrema.length]);

  function handleRestoreDraft() {
    if (!draftPreview) {
      return;
    }
    setExtrema(draftPreview.extrema);
    idCounterRef.current = draftPreview.extrema.reduce((max, p) => Math.max(max, p.id), -1) + 1;
    if (draftPreview.expectedFrequencyHz) {
      setExpectedFrequencyHz(draftPreview.expectedFrequencyHz);
    }
    setDraftPreview(null);
  }

  function handleDiscardDraft() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Best-effort.
    }
    setDraftPreview(null);
  }

  // --- Frame drawing -------------------------------------------------------

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

    const showFullFrame = isRoiEditable;
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

  // --- Video loading -------------------------------------------------------

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
    setRoi(null);
    setIsAdjustingRoi(false);
    setScrubTimeS(0);
    // extrema is intentionally NOT reset here — a restored draft (or a
    // camera-shift ROI redraw) should be able to continue against a
    // freshly (re-)uploaded video instead of losing already-marked points.
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

  // Paint the first frame only once the canvas has actually mounted — doing
  // this directly inside the native 'loadeddata' listener above would race
  // the canvas's own mount and can silently lose the first frame. A
  // useEffect keyed on isFrameReady always runs after the DOM commit.
  useEffect(() => {
    if (isFrameReady) {
      redrawFrame(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFrameReady]);

  useEffect(() => {
    if (stage === "marking") {
      redrawFrame(scrubTimeS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, roi, isAdjustingRoi]);

  // --- Playback ------------------------------------------------------------

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

  function handleFineStep(deltaSteps: number) {
    const video = videoRef.current;
    const base = video ? video.currentTime : scrubTimeS;
    const t = Math.max(0, Math.min(durationS, base + deltaSteps * FINE_STEP_S));
    setScrubTimeS(t);
    if (video) {
      video.currentTime = t;
    }
    redrawFrame(t);
  }

  // --- ROI drawing -----------------------------------------------------------

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
    const scaleXToNative = offscreen.width / display.width;
    const scaleYToNative = offscreen.height / display.height;
    return {
      x: Math.round(displayX * scaleXToNative),
      y: Math.round(displayY * scaleYToNative),
    };
  }

  function handleRoiMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isRoiEditable) {
      return;
    }
    const point = getNativeCanvasPoint(event);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handleRoiMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isRoiEditable || !dragStart) {
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
    if (!isRoiEditable || !dragStart || !dragCurrent) {
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

  function handleAdjustRoiAgain() {
    setIsAdjustingRoi(true);
    redrawFrame(scrubTimeS);
  }

  function handleStartMarking() {
    if (!roi) {
      return;
    }
    setStage("marking");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // --- Marking ---------------------------------------------------------------

  function showToast(message: string) {
    setToast(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function refocusInput() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSaveExtreme(type: "crest" | "trough") {
    const parsed = parseFloat(inputValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const video = videoRef.current;
    const timeS = video ? video.currentTime : scrubTimeS;
    const id = idCounterRef.current++;
    setExtrema((prev) => [...prev, { id, timeS, valueCm: parsed, type }]);
    setInputValue("");
    showToast(
      t("manualMark.toastSaved", {
        time: timeS.toFixed(2),
        value: parsed,
        type: type === "crest" ? t("manualMark.crest") : t("manualMark.trough"),
      })
    );
    refocusInput();
  }

  function handleUndo() {
    setExtrema((prev) => prev.slice(0, -1));
  }

  function handleDeleteExtreme(id: number) {
    setExtrema((prev) => prev.filter((p) => p.id !== id));
  }

  function handleSeekTo(timeS: number) {
    const video = videoRef.current;
    if (video) {
      video.currentTime = timeS;
    }
    setScrubTimeS(timeS);
    redrawFrame(timeS);
  }

  // Global keyboard shortcuts — only while marking, and always disabled
  // while focus is in the value input so they never fight with typing.
  useEffect(() => {
    if (stage !== "marking") {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      // C/T are safe even while the value input has focus — a type="number"
      // field can't accept letters as content anyway, and this is exactly
      // where focus naturally sits right after typing a value, which is the
      // tool's core "type, then save" rhythm. Arrow keys/space/Ctrl+Z do
      // conflict with genuine in-field editing (cursor movement, undoing a
      // keystroke), so those stay gated on focus.
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        handleSaveExtreme("crest");
        return;
      }
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        handleSaveExtreme("trough");
        return;
      }
      if (document.activeElement === inputRef.current) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleFineStep(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleFineStep(1);
      } else if (event.key === " ") {
        event.preventDefault();
        handleTogglePlay();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, inputValue, isPlaying, playbackSpeed, scrubTimeS]);

  const sortedExtrema = useMemo(() => [...extrema].sort((a, b) => a.timeS - b.timeS), [extrema]);

  const extremaStats = useMemo(() => computeExtremaStats(extrema), [extrema]);

  const sineFit = useMemo(() => {
    if (extrema.length < 4) {
      return null;
    }
    const initialFrequencyHz = hasExpectedFrequency ? parsedExpectedFrequencyHz : undefined;
    return fitSineWave(extrema, initialFrequencyHz);
  }, [extrema, hasExpectedFrequency, parsedExpectedFrequencyHz]);

  const sineCurve = useMemo(() => {
    if (!sineFit || sortedExtrema.length === 0) {
      return null;
    }
    const startTimeS = sortedExtrema[0].timeS;
    const endTimeS = sortedExtrema[sortedExtrema.length - 1].timeS;
    if (startTimeS === endTimeS) {
      return null;
    }
    return generateSineFitCurve(sineFit, startTimeS, endTimeS, SINE_CURVE_SAMPLE_COUNT);
  }, [sineFit, sortedExtrema]);

  function handleDownloadCSV() {
    const header = "time_s,value_cm,type";
    const rows = sortedExtrema.map((p) => `${p.timeS},${p.valueCm},${p.type}`);
    downloadCSV([header, ...rows].join("\n"), "manual-mark_extrema.csv");
  }

  const containerMaxWidthClass = stage === "marking" ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className={`flex w-full ${containerMaxWidthClass} flex-col gap-8 px-6 py-16`}>
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("manualMark.title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t("manualMark.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHowToUse(true)}
            aria-label={t("common.howToUse")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ?
          </button>
        </header>

        {showHowToUse && <HowToUseModal onClose={() => setShowHowToUse(false)} />}

        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={offscreenCanvasRef} className="hidden" />

        {stage === "setup" && (
          <section className="flex flex-col gap-4">
            {draftPreview && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950">
                <span className="text-amber-900 dark:text-amber-200">
                  {t("manualMark.draftFound", {
                    count: draftPreview.extrema.length,
                    savedAt: new Date(draftPreview.savedAt).toLocaleString(),
                  })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRestoreDraft}
                    className="rounded-full bg-amber-900 px-3 py-1 text-xs font-medium text-white dark:bg-amber-100 dark:text-amber-950"
                  >
                    {t("manualMark.restoreDraft")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200"
                  >
                    {t("manualMark.discardDraft")}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("manualMark.uploadVideo")}</label>
              <input type="file" accept="video/*" onChange={handleFileChange} />
            </div>

            <label className="flex flex-col gap-1 text-sm">
              {t("manualMark.expectedFrequencyLabel")}
              <input
                type="number"
                min={0}
                step="any"
                value={expectedFrequencyHz}
                onChange={(event) => setExpectedFrequencyHz(event.target.value)}
                placeholder={t("manualMark.expectedFrequencyPlaceholder")}
                className="w-40 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>

            {videoUrl && !isFrameReady && (
              <p className="text-sm text-zinc-500">{t("common.loadingFirstFrame")}</p>
            )}

            {videoUrl && isFrameReady && (
              <>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {roi ? t("manualMark.readingRegionSet") : t("manualMark.dragReadingRegion")}
                </p>
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handleRoiMouseDown}
                  onMouseMove={handleRoiMouseMove}
                  onMouseUp={handleRoiMouseUp}
                  className={`w-full max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800 ${
                    isRoiEditable ? "cursor-crosshair" : ""
                  }`}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={durationS}
                    step={0.01}
                    value={scrubTimeS}
                    onChange={handleScrub}
                    aria-label={t("common.videoScrubber")}
                    className="flex-1"
                  />
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                    {t("common.timeSuffix", { value: scrubTimeS.toFixed(1) })}
                  </span>
                </div>

                {roi && (
                  <button
                    type="button"
                    onClick={handleAdjustRoiAgain}
                    className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {t("manualMark.redrawRegion")}
                  </button>
                )}

                <button
                  type="button"
                  disabled={!roi}
                  onClick={handleStartMarking}
                  className="w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {t("manualMark.startMarking")}
                </button>
              </>
            )}
          </section>
        )}

        {stage === "marking" && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handleRoiMouseDown}
                  onMouseMove={handleRoiMouseMove}
                  onMouseUp={handleRoiMouseUp}
                  style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
                  className={`w-full max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800 ${
                    isRoiEditable ? "cursor-crosshair" : ""
                  }`}
                />
                {toast && (
                  <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-1.5 text-sm text-white shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900">
                    {toast}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={durationS}
                  step={0.01}
                  value={scrubTimeS}
                  onChange={handleScrub}
                  aria-label={t("common.videoScrubber")}
                  className="flex-1 min-w-32"
                />
                <button
                  type="button"
                  onClick={() => handleFineStep(-1)}
                  aria-label={t("manualMark.stepBack")}
                  className="rounded-full border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ◀◀
                </button>
                <button
                  type="button"
                  onClick={() => handleFineStep(1)}
                  aria-label={t("manualMark.stepForward")}
                  className="rounded-full border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ▶▶
                </button>
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {isPlaying ? t("common.pause") : t("common.play")}
                </button>
                <select
                  value={playbackSpeed}
                  onChange={(event) => setPlaybackSpeed(parseFloat(event.target.value))}
                  aria-label={t("manualMark.playbackSpeed")}
                  className="rounded border border-zinc-300 px-1 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {PLAYBACK_SPEEDS.map((speed) => (
                    <option key={speed} value={speed}>
                      {t("manualMark.speedOption", { value: speed })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAdjustRoiAgain}
                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t("manualMark.redrawRegion")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  {t("manualMark.brightness")}
                  <input
                    type="range"
                    min={50}
                    max={200}
                    value={brightness}
                    onChange={(event) => setBrightness(Number(event.target.value))}
                    aria-label={t("manualMark.brightness")}
                  />
                  {t("manualMark.percentValue", { value: brightness })}
                </label>
                <label className="flex items-center gap-2">
                  {t("manualMark.contrast")}
                  <input
                    type="range"
                    min={50}
                    max={200}
                    value={contrast}
                    onChange={(event) => setContrast(Number(event.target.value))}
                    aria-label={t("manualMark.contrast")}
                  />
                  {t("manualMark.percentValue", { value: contrast })}
                </label>
              </div>

              <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {t("manualMark.currentTime", { value: formatSeconds(scrubTimeS) })}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={inputRef}
                  type="number"
                  step="0.01"
                  autoFocus
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  aria-label={t("manualMark.valueAriaLabel")}
                  placeholder={t("manualMark.valuePlaceholder")}
                  className="w-40 rounded border border-zinc-300 px-3 py-2 text-lg dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  disabled={!isInputValid}
                  onClick={() => handleSaveExtreme("crest")}
                  className="flex h-12 items-center gap-2 rounded-full px-5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: CREST_COLOR }}
                >
                  {t("manualMark.saveCrest")}
                </button>
                <button
                  type="button"
                  disabled={!isInputValid}
                  onClick={() => handleSaveExtreme("trough")}
                  className="flex h-12 items-center gap-2 rounded-full px-5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: TROUGH_COLOR }}
                >
                  {t("manualMark.saveTrough")}
                </button>
                <button
                  type="button"
                  disabled={extrema.length === 0}
                  onClick={handleUndo}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t("manualMark.undo")}
                </button>
              </div>

              <ManualMarkChart points={extrema} sineCurve={sineCurve} variant="compact" />

              <div className="flex flex-wrap gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <span>
                  {t("manualMark.wavesLabel")}
                  <strong>{extremaStats.nWaves}</strong>
                </span>
                <span>
                  {t("manualMark.hMeanLabel")}
                  <strong>{extremaStats.hMean.toFixed(2)}</strong> {t("manualMark.cm")}
                </span>
                {sineFit && (
                  <span>
                    {t("manualMark.sineFitR2Label")}
                    <strong>{sineFit.rSquared.toFixed(3)}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="sticky top-4 z-10 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStage("summary")}
                  className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {t("manualMark.stopMarking")}
                </button>
              </div>

              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("manualMark.markedPoints", { count: sortedExtrema.length })}
              </p>

              {sortedExtrema.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
                  {t("manualMark.emptyStateInstructions")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sortedExtrema.map((point) => (
                    <li key={point.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSeekTo(point.timeS)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            handleSeekTo(point.timeS);
                          }
                        }}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="flex items-center gap-2">
                          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
                            {point.type === "crest" ? (
                              <polygon points="5,0 0,10 10,10" fill={CREST_COLOR} />
                            ) : (
                              <polygon points="5,10 0,0 10,0" fill={TROUGH_COLOR} />
                            )}
                          </svg>
                          <span className="tabular-nums text-zinc-500">
                            {t("common.timeSuffix", { value: formatSeconds(point.timeS) })}
                          </span>
                          <span className="tabular-nums font-medium">
                            {point.valueCm}
                            {t("manualMark.cm")}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={t("manualMark.deletePoint")}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteExtreme(point.id);
                          }}
                          className="text-zinc-400 hover:text-red-600"
                        >
                          🗑
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {stage === "summary" && (
          <section className="flex flex-col gap-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.results")}
            </h2>

            {extrema.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("manualMark.noPointsYet")}</p>
            ) : (
              <>
                {extremaStats.warnings.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {extremaStats.warnings.map((warning, i) => (
                      <p key={i}>
                        {t("manualMark.consecutiveSameTypeWarning", {
                          type:
                            warning.extremaType === "crest"
                              ? t("manualMark.crest")
                              : t("manualMark.trough"),
                          time1: warning.time1S.toFixed(2),
                          time2: warning.time2S.toFixed(2),
                        })}
                      </p>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-sm">
                    <tbody>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-4 text-zinc-500">{t("manualMark.wavesDetected")}</td>
                        <td className="py-1 font-medium">{extremaStats.nWaves}</td>
                      </tr>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-4 text-zinc-500">{t("manualMark.hMax")}</td>
                        <td className="py-1 font-medium">{extremaStats.hMax.toFixed(2)}</td>
                      </tr>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-4 text-zinc-500">{t("manualMark.hMean")}</td>
                        <td className="py-1 font-medium">{extremaStats.hMean.toFixed(2)}</td>
                      </tr>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-4 text-zinc-500">{t("manualMark.hSignificant")}</td>
                        <td className="py-1 font-medium">{extremaStats.hSignificant.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-4 text-zinc-500">{t("manualMark.meanPeriodPairing")}</td>
                        <td className="py-1 font-medium">{extremaStats.periodMeanS.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {hasExpectedFrequency && extremaStats.periodMeanS > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                          <th className="py-2 pr-4">{t("manualMark.method")}</th>
                          <th className="py-2 pr-4">{t("manualMark.setHz")}</th>
                          <th className="py-2 pr-4">{t("manualMark.measuredHz")}</th>
                          <th className="py-2 pr-4">{t("manualMark.difference")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-zinc-100 dark:border-zinc-900">
                          <td className="py-2 pr-4">{t("manualMark.pairing")}</td>
                          <td className="py-2 pr-4">{parsedExpectedFrequencyHz.toFixed(3)}</td>
                          <td className="py-2 pr-4">{(1 / extremaStats.periodMeanS).toFixed(3)}</td>
                          <td className="py-2 pr-4">
                            {(
                              (Math.abs(1 / extremaStats.periodMeanS - parsedExpectedFrequencyHz) /
                                parsedExpectedFrequencyHz) *
                              100
                            ).toFixed(1)}
                            %
                          </td>
                        </tr>
                        {sineFit && (
                          <tr>
                            <td className="py-2 pr-4">{t("manualMark.sineFit")}</td>
                            <td className="py-2 pr-4">{parsedExpectedFrequencyHz.toFixed(3)}</td>
                            <td className="py-2 pr-4">{sineFit.frequencyHz.toFixed(3)}</td>
                            <td className="py-2 pr-4">
                              {(
                                (Math.abs(sineFit.frequencyHz - parsedExpectedFrequencyHz) /
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

                <div>
                  <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {t("manualMark.sineWaveFit")}
                  </h3>
                  {!sineFit ? (
                    <p className="text-sm text-zinc-500">{t("manualMark.needMorePointsForFit")}</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse text-sm">
                          <tbody>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                              <td className="py-1 pr-4 text-zinc-500">{t("manualMark.amplitude")}</td>
                              <td className="py-1 font-medium">{sineFit.amplitudeCm.toFixed(2)}</td>
                            </tr>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                              <td className="py-1 pr-4 text-zinc-500">{t("manualMark.period")}</td>
                              <td className="py-1 font-medium">{sineFit.periodS.toFixed(3)}</td>
                            </tr>
                            <tr className="border-b border-zinc-100 dark:border-zinc-800">
                              <td className="py-1 pr-4 text-zinc-500">{t("manualMark.frequency")}</td>
                              <td className="py-1 font-medium">{sineFit.frequencyHz.toFixed(3)}</td>
                            </tr>
                            <tr>
                              <td className="py-1 pr-4 text-zinc-500">{t("manualMark.rSquared")}</td>
                              <td className="py-1 font-medium">{sineFit.rSquared.toFixed(3)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {sineFit.rSquared < 0.8 && (
                        <p className="mt-2 text-sm text-amber-600">{t("manualMark.lowR2Warning")}</p>
                      )}
                    </>
                  )}
                </div>

                <ManualMarkChart points={extrema} sineCurve={sineCurve} variant="full" />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadCSV}
                    className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {t("manualMark.downloadCsv")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStage("marking");
                      refocusInput();
                    }}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {t("manualMark.continueMarking")}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {stage === "marking" && (
          <div className="fixed bottom-4 right-4 z-20">
            <button
              type="button"
              onClick={() => setShowKeyboardHelp((v) => !v)}
              aria-label={t("manualMark.keyboardShortcuts")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
            >
              ⌨
            </button>
            {showKeyboardHelp && (
              <div className="mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-1 flex justify-between">
                  <span>{t("manualMark.crest")}</span> <kbd className="font-mono">C</kbd>
                </p>
                <p className="mb-1 flex justify-between">
                  <span>{t("manualMark.trough")}</span> <kbd className="font-mono">T</kbd>
                </p>
                <p className="mb-1 flex justify-between">
                  <span>{t("manualMark.shortcutFineStep")}</span>{" "}
                  <kbd className="font-mono">← →</kbd>
                </p>
                <p className="mb-1 flex justify-between">
                  <span>{t("manualMark.shortcutPlayPause")}</span>{" "}
                  <kbd className="font-mono">Space</kbd>
                </p>
                <p className="flex justify-between">
                  <span>{t("manualMark.undo")}</span> <kbd className="font-mono">Ctrl+Z</kbd>
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
