"use client";

interface ProcessingControlsProps {
  isProcessing: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  debugMode: boolean;
  onDebugModeChange: (value: boolean) => void;
  overlayEveryNFrames: number;
  onOverlayEveryNFramesChange: (value: number) => void;
}

export default function ProcessingControls({
  isProcessing,
  isPaused,
  onTogglePause,
  debugMode,
  onDebugModeChange,
  overlayEveryNFrames,
  onOverlayEveryNFramesChange,
}: ProcessingControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <button
        type="button"
        disabled={!isProcessing}
        onClick={onTogglePause}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {isPaused ? "Resume" : "Pause"}
      </button>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={debugMode}
          onChange={(event) => onDebugModeChange(event.target.checked)}
        />
        Debug mode (slow down to see detail)
      </label>

      <label className="flex items-center gap-2">
        Overlay every
        <input
          type="number"
          min={1}
          value={overlayEveryNFrames}
          onChange={(event) =>
            onOverlayEveryNFramesChange(Math.max(1, parseInt(event.target.value, 10) || 1))
          }
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        frame(s)
      </label>
    </div>
  );
}
