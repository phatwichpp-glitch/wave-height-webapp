"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

interface ProcessingControlsProps {
  isProcessing: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  debugMode: boolean;
  onDebugModeChange: (value: boolean) => void;
  overlayEveryNFrames: number;
  onOverlayEveryNFramesChange: (value: number) => void;
  /** Debug mode's artificial per-frame delay only applies to the seek-based processing path — hide the (otherwise dead) control when frame-callback mode is active. Default true. */
  showDebugMode?: boolean;
}

export default function ProcessingControls({
  isProcessing,
  isPaused,
  onTogglePause,
  debugMode,
  onDebugModeChange,
  overlayEveryNFrames,
  onOverlayEveryNFramesChange,
  showDebugMode = true,
}: ProcessingControlsProps) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <button
        type="button"
        disabled={!isProcessing}
        onClick={onTogglePause}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {isPaused ? t("common.resume") : t("common.pause")}
      </button>

      {showDebugMode && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(event) => onDebugModeChange(event.target.checked)}
          />
          {t("processingControls.debugMode")}
        </label>
      )}

      <label className="flex items-center gap-2">
        {t("processingControls.overlayEvery")}
        <input
          type="number"
          min={1}
          value={overlayEveryNFrames}
          onChange={(event) =>
            onOverlayEveryNFramesChange(Math.max(1, parseInt(event.target.value, 10) || 1))
          }
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {t("processingControls.frames")}
      </label>
    </div>
  );
}
