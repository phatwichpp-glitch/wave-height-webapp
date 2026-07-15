"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CalibrationData,
  MeasurementPoint,
  RulerCalibration,
  WaveDataPoint,
} from "@/types/wave";
import { processVideoAuto, type DetectionResult, type ProcessingMode } from "@/lib/videoProcessor";
import { supportsVideoFrameCallback } from "@/lib/frameCallbackProcessor";
import PointSelector from "@/components/PointSelector";
import LiveViewerCanvas from "@/components/LiveViewerCanvas";
import ProcessingControls from "@/components/ProcessingControls";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

interface ProcessingPanelProps {
  videoUrl: string;
  calibration: CalibrationData;
  onComplete: (
    data: Record<string, WaveDataPoint[]>,
    points: MeasurementPoint[],
    sampleRateHz: number,
    /** The user's optional expected-wave-frequency hint (Hz), or null if left blank — used downstream to pick a detrend window and restrict the FFT peak search. */
    expectedFrequencyHz: number | null
  ) => void;
  /** When set (from RulerCalibrationPanel), points track the ruler continuously instead of using a fixed pixel column/baseline. */
  rulerCalibration?: RulerCalibration | null;
  cmPerTick?: number;
  /** The video time (seconds) the user was scrubbed to when they confirmed calibration — compared against analysisStartTimeS below to warn if they've drifted far apart. */
  calibrationReferenceTimeS?: number | null;
}

const MAX_POINTS = 8;
const DEBUG_MODE_DELAY_MS = 75;
const RULER_CHECK_INTERVAL_FRAMES = 10;
const RULER_MAX_FIT_ERROR_PX = 2.0;
const DEFAULT_PLAYBACK_RATE = 4;
// Below this much remaining video after analysisStartTimeS, there may not be
// enough samples left for a statistically meaningful wave analysis.
const MIN_RECOMMENDED_REMAINING_S = 5;
// Beyond this gap between the calibration frame and the analysis start time,
// ROI/point positions from calibration may no longer line up well.
const CALIBRATION_DRIFT_WARNING_S = 10;

export default function ProcessingPanel({
  videoUrl,
  calibration,
  onComplete,
  rulerCalibration = null,
  cmPerTick,
  calibrationReferenceTimeS = null,
}: ProcessingPanelProps) {
  const { t } = useLanguage();
  // Dedicated hidden video + visible frame canvas for processVideo()'s own
  // captures — separate from PointSelector's own video/canvas used just for
  // the picker UI. The frame canvas is visible (not display:none) so it can
  // double as the live preview underneath LiveViewerCanvas's overlay.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable mutable flag the processing loop polls directly — kept in sync
  // with the `isPaused` state (which exists only to re-render the button label).
  const isPausedRef = useRef({ current: false }).current;
  const frameCounterRef = useRef(0);

  const [isMetadataReady, setIsMetadataReady] = useState(false);
  const [videoDurationS, setVideoDurationS] = useState(0);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [sampleRateHz, setSampleRateHz] = useState("10");
  const [expectedFrequencyHz, setExpectedFrequencyHz] = useState("");
  const [analysisStartTimeS, setAnalysisStartTimeS] = useState("0");
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("auto");
  const [playbackRate, setPlaybackRate] = useState(String(DEFAULT_PLAYBACK_RATE));
  // Lazy initializer: a pure feature check, safe to run once at mount rather
  // than re-checking on every render.
  const [browserSupportsFrameCallback] = useState(() => supportsVideoFrameCallback());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [overlayEveryNFrames, setOverlayEveryNFrames] = useState(1);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [rulerCheckFailures, setRulerCheckFailures] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setIsMetadataReady(false);

    function handleLoadedMetadata() {
      if (!video) {
        return;
      }
      setVideoDurationS(video.duration || 0);
      setIsMetadataReady(true);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.src = videoUrl;
    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [videoUrl]);

  const parsedSampleRate = parseFloat(sampleRateHz);

  // Optional: blank is valid (means "no hint"), but a non-blank value must be
  // a usable positive number or processing is blocked — a silently-ignored
  // typo here would be confusing since it changes detrending/FFT-search behavior.
  const trimmedExpectedFrequency = expectedFrequencyHz.trim();
  const parsedExpectedFrequency =
    trimmedExpectedFrequency === "" ? null : parseFloat(trimmedExpectedFrequency);
  const hasInvalidExpectedFrequency =
    trimmedExpectedFrequency !== "" &&
    (!Number.isFinite(parsedExpectedFrequency) || (parsedExpectedFrequency ?? 0) <= 0);

  const parsedAnalysisStartTime = parseFloat(analysisStartTimeS);
  const hasInvalidAnalysisStartTime =
    !Number.isFinite(parsedAnalysisStartTime) ||
    parsedAnalysisStartTime < 0 ||
    (isMetadataReady && parsedAnalysisStartTime >= videoDurationS);

  // Non-blocking: fewer than this many seconds of usable video remain after
  // the chosen start time — statistics may be unreliable, but the user may
  // still want to proceed (e.g. just to inspect the raw trace).
  const remainingAfterStartS = videoDurationS - parsedAnalysisStartTime;
  const showShortRemainingWarning =
    isMetadataReady &&
    !hasInvalidAnalysisStartTime &&
    remainingAfterStartS < MIN_RECOMMENDED_REMAINING_S;

  // Non-blocking: the frame the user calibrated against is far from the
  // chosen analysis start time, so a fixed-camera ROI/point position may not
  // still line up (ruler tracking mode should self-correct within reason).
  const showCalibrationDriftWarning =
    calibrationReferenceTimeS !== null &&
    !hasInvalidAnalysisStartTime &&
    Math.abs(calibrationReferenceTimeS - parsedAnalysisStartTime) > CALIBRATION_DRIFT_WARNING_S;

  const missingBaselines =
    !!rulerCalibration && points.some((point) => point.baselineValueCm === null);

  // What will actually run once "auto" resolves against this browser —
  // used to decide which mode-specific controls (playbackRate, debug mode)
  // make sense to show.
  const effectiveMode: Exclude<ProcessingMode, "auto"> =
    processingMode === "seek-based"
      ? "seek-based"
      : processingMode === "frame-callback"
        ? "frame-callback"
        : browserSupportsFrameCallback
          ? "frame-callback"
          : "seek-based";

  const parsedPlaybackRate = parseFloat(playbackRate);
  const hasInvalidPlaybackRate =
    effectiveMode === "frame-callback" &&
    (!Number.isFinite(parsedPlaybackRate) || parsedPlaybackRate <= 0);

  // Only blocks start when the user explicitly demands frame-callback on a
  // browser that can't do it — "auto" already falls back silently for
  // exactly this reason, so there's nothing to warn about in that case.
  const showFrameCallbackUnsupportedWarning =
    processingMode === "frame-callback" && !browserSupportsFrameCallback;

  const canStart =
    isMetadataReady &&
    !isProcessing &&
    points.length > 0 &&
    !missingBaselines &&
    !hasInvalidExpectedFrequency &&
    !hasInvalidAnalysisStartTime &&
    !hasInvalidPlaybackRate &&
    !showFrameCallbackUnsupportedWarning &&
    Number.isFinite(parsedSampleRate) &&
    parsedSampleRate > 0;

  function handleTogglePause() {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
  }

  function handleFrameProcessed(detections: DetectionResult[]) {
    frameCounterRef.current += 1;
    if (frameCounterRef.current % overlayEveryNFrames === 0) {
      setCurrentDetections(detections);
    }
  }

  async function handleStart() {
    const video = videoRef.current;
    const canvas = processingCanvasRef.current;
    if (!video || !canvas || !canStart) {
      return;
    }

    isPausedRef.current = false;
    frameCounterRef.current = 0;
    setIsPaused(false);
    setCurrentDetections([]);
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setResultCount(null);
    setRulerCheckFailures(0);

    try {
      const data = await processVideoAuto(video, canvas, calibration, points, {
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        sampleRateHz: parsedSampleRate,
        analysisStartTimeS: parsedAnalysisStartTime,
        mode: processingMode,
        playbackRate: effectiveMode === "frame-callback" ? parsedPlaybackRate : undefined,
        onProgress: (percent) => setProgress(percent),
        onFrameProcessed: handleFrameProcessed,
        onRulerCheckFailed: () => setRulerCheckFailures((count) => count + 1),
        isPausedRef,
        debugDelayMs: debugMode && effectiveMode === "seek-based" ? DEBUG_MODE_DELAY_MS : undefined,
        rulerTracking:
          rulerCalibration && cmPerTick
            ? {
                calibration: rulerCalibration,
                cmPerTick,
                checkIntervalFrames: RULER_CHECK_INTERVAL_FRAMES,
                maxFitError: RULER_MAX_FIT_ERROR_PX,
              }
            : undefined,
      });

      const totalPoints = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
      setResultCount(totalPoints);
      onComplete(data, points, parsedSampleRate, parsedExpectedFrequency);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Off-screen video; the frame canvas below stays visible so it can act as the live preview. */}
      <video ref={videoRef} className="hidden" muted playsInline />

      <PointSelector
        videoUrl={videoUrl}
        onChange={setPoints}
        maxPoints={MAX_POINTS}
        rulerCalibration={rulerCalibration}
        referenceTimeS={calibrationReferenceTimeS}
      />

      {missingBaselines && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.missingBaselines")}
        </p>
      )}

      {hasInvalidExpectedFrequency && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.invalidExpectedFrequency")}
        </p>
      )}

      {hasInvalidAnalysisStartTime && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.invalidAnalysisStartTime", {
            durationSuffix: isMetadataReady ? ` (${videoDurationS.toFixed(1)}s)` : "",
          })}
        </p>
      )}

      {hasInvalidPlaybackRate && (
        <p className="text-sm text-amber-600">{t("processingPanel.invalidPlaybackRate")}</p>
      )}

      {showFrameCallbackUnsupportedWarning && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.frameCallbackUnsupported")}{" "}
          <button
            type="button"
            onClick={() => setProcessingMode("seek-based")}
            className="underline hover:no-underline"
          >
            {t("processingPanel.switchToSeekBased")}
          </button>
          .
        </p>
      )}

      {showShortRemainingWarning && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.shortRemainingWarning")}
        </p>
      )}

      {showCalibrationDriftWarning && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.calibrationDriftWarning")}
        </p>
      )}

      {/* Kept as one persistent element (never unmounted) so processingCanvasRef
          always points to the same node processVideo() is capturing into —
          only its visibility toggles, so the live preview actually shows the
          frames being captured instead of a freshly-mounted blank canvas. */}
      <div
        className={`relative w-full max-w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 ${
          isProcessing ? "" : "hidden"
        }`}
      >
        <canvas ref={processingCanvasRef} className="block w-full max-w-full" />
        <LiveViewerCanvas
          videoCanvasRef={processingCanvasRef}
          currentDetections={currentDetections}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("processingPanel.sampleRateLabel")}
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
          {t("processingPanel.expectedFrequencyLabel")}
          <input
            type="number"
            min={0}
            step="any"
            value={expectedFrequencyHz}
            onChange={(event) => setExpectedFrequencyHz(event.target.value)}
            placeholder={t("processingPanel.expectedFrequencyPlaceholder")}
            aria-label={t("processingPanel.expectedFrequencyAriaLabel")}
            className="w-40 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("processingPanel.analysisStartTimeLabel")}
          <input
            type="number"
            min={0}
            step="any"
            value={analysisStartTimeS}
            onChange={(event) => setAnalysisStartTimeS(event.target.value)}
            aria-label={t("processingPanel.analysisStartTimeAriaLabel")}
            className="w-28 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("processingPanel.processingModeLabel")}
          <select
            value={processingMode}
            onChange={(event) => setProcessingMode(event.target.value as ProcessingMode)}
            aria-label={t("processingPanel.processingModeAriaLabel")}
            className="w-44 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="auto">{t("processingPanel.modeAuto")}</option>
            <option value="seek-based">{t("processingPanel.modeSeekBased")}</option>
            <option value="frame-callback">{t("processingPanel.modeFrameCallback")}</option>
          </select>
        </label>

        {effectiveMode === "frame-callback" && (
          <label className="flex flex-col gap-1 text-sm">
            {t("processingPanel.playbackRateLabel")}
            <input
              type="number"
              min={1}
              max={16}
              step="any"
              value={playbackRate}
              onChange={(event) => setPlaybackRate(event.target.value)}
              aria-label={t("processingPanel.playbackRateAriaLabel")}
              className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        )}

        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isProcessing ? t("processingPanel.processing") : t("processingPanel.startProcessing")}
        </button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {t("processingPanel.analysisStartHint")}
      </p>

      {effectiveMode === "frame-callback" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {t("processingPanel.playbackRateHint")}
        </p>
      )}

      <ProcessingControls
        isProcessing={isProcessing}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        debugMode={debugMode}
        onDebugModeChange={setDebugMode}
        overlayEveryNFrames={overlayEveryNFrames}
        onOverlayEveryNFramesChange={setOverlayEveryNFrames}
        showDebugMode={effectiveMode === "seek-based"}
      />

      {isProcessing && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {rulerCheckFailures > 0 && (
        <p className="text-sm text-amber-600">
          {t("processingPanel.rulerSkipped", {
            count: rulerCheckFailures,
            plural: rulerCheckFailures === 1 ? "" : "s",
          })}
        </p>
      )}

      {resultCount !== null && !isProcessing && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("processingPanel.processedSummary", {
            count: resultCount,
            pointCount: points.length,
            plural: points.length === 1 ? "" : "s",
          })}
        </p>
      )}
    </div>
  );
}
