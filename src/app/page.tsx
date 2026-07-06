"use client";

import { useMemo, useState } from "react";
import type {
  CalibrationData,
  MeasurementPoint,
  RulerCalibration,
  WaveDataPoint,
  WaveStatistics,
} from "@/types/wave";
import Link from "next/link";
import VideoUploader from "@/components/VideoUploader";
import CalibrationCanvas from "@/components/CalibrationCanvas";
import RulerCalibrationPanel from "@/components/RulerCalibrationPanel";
import ProcessingPanel from "@/components/ProcessingPanel";
import ElevationChart from "@/components/ElevationChart";
import WaveHeightHistogram from "@/components/WaveHeightHistogram";
import ResultsSummary from "@/components/ResultsSummary";
import { computeWaveStatistics } from "@/lib/waveStatistics";

type CalibrationMode = "fixed" | "ruler";

/** Derives an equivalent CalibrationData from a ruler calibration, purely for
 * API compatibility with processVideo (which always takes a CalibrationData) —
 * it's immediately superseded frame-by-frame once ruler tracking is active. */
function calibrationFromRuler(ruler: RulerCalibration): CalibrationData {
  const knownDistanceCm = Math.abs(ruler.point2.valueCm - ruler.point1.valueCm);
  const pixelDistance = Math.abs(ruler.point2.y - ruler.point1.y);
  return {
    point1: { x: ruler.point1.x, y: ruler.point1.y },
    point2: { x: ruler.point2.x, y: ruler.point2.y },
    knownDistanceCm,
    pixelsPerCm: pixelDistance / knownDistanceCm,
  };
}

export default function Home() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>("fixed");
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [rulerCalibration, setRulerCalibration] = useState<RulerCalibration | null>(null);
  const [cmPerTick, setCmPerTick] = useState<number | undefined>(undefined);
  const [waveData, setWaveData] = useState<Record<string, WaveDataPoint[]> | null>(null);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);

  function handleVideoLoaded(url: string) {
    setVideoUrl(url);
    setCalibration(null);
    setRulerCalibration(null);
    setWaveData(null);
  }

  function handleModeChange(mode: CalibrationMode) {
    setCalibrationMode(mode);
    setCalibration(null);
    setRulerCalibration(null);
    setWaveData(null);
  }

  function handleCalibrated(data: CalibrationData) {
    setCalibration(data);
    setWaveData(null);
  }

  function handleRulerCalibrated(ruler: RulerCalibration, tickSpacingCm: number) {
    setRulerCalibration(ruler);
    setCmPerTick(tickSpacingCm);
    setCalibration(calibrationFromRuler(ruler));
    setWaveData(null);
  }

  function handleProcessingComplete(
    data: Record<string, WaveDataPoint[]>,
    usedPoints: MeasurementPoint[]
  ) {
    setWaveData(data);
    setPoints(usedPoints);
  }

  const { statsByPoint, statsErrorsByPoint } = useMemo((): {
    statsByPoint: Record<string, WaveStatistics>;
    statsErrorsByPoint: Record<string, string>;
  } => {
    const statsByPoint: Record<string, WaveStatistics> = {};
    const statsErrorsByPoint: Record<string, string> = {};

    if (!waveData) {
      return { statsByPoint, statsErrorsByPoint };
    }

    for (const point of points) {
      const pointData = waveData[point.id];
      if (!pointData) {
        continue;
      }
      try {
        const timeS = pointData.map((d) => d.timeS);
        const elevationCm = pointData.map((d) => d.elevationCm);
        statsByPoint[point.id] = computeWaveStatistics(timeS, elevationCm);
      } catch (err) {
        statsErrorsByPoint[point.id] = err instanceof Error ? err.message : String(err);
      }
    }

    return { statsByPoint, statsErrorsByPoint };
  }, [waveData, points]);

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Wave Height Analyzer
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Analyze wave height from a video, entirely in your browser.
          </p>
          <Link
            href="/batch"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Process multiple videos at once →
          </Link>
        </header>

        <section className="flex flex-col gap-3">
          <StepLabel step={1} title="Upload a video" />
          <VideoUploader onVideoLoaded={handleVideoLoaded} />
        </section>

        {videoUrl && (
          <section className="flex flex-col gap-3">
            <StepLabel step={2} title="Calibrate against a known distance" />

            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => handleModeChange("fixed")}
                className={`rounded-full border px-3 py-1 ${
                  calibrationMode === "fixed"
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                Fixed camera
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("ruler")}
                className={`rounded-full border px-3 py-1 ${
                  calibrationMode === "ruler"
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                Handheld / zooming camera
              </button>
            </div>

            {calibrationMode === "fixed" ? (
              <CalibrationCanvas videoUrl={videoUrl} onCalibrated={handleCalibrated} />
            ) : (
              <RulerCalibrationPanel
                videoUrl={videoUrl}
                onCalibrated={handleRulerCalibrated}
              />
            )}
          </section>
        )}

        {videoUrl && calibration && (
          <section className="flex flex-col gap-3">
            <StepLabel step={3} title="Configure and run processing" />
            <ProcessingPanel
              videoUrl={videoUrl}
              calibration={calibration}
              onComplete={handleProcessingComplete}
              rulerCalibration={rulerCalibration}
              cmPerTick={cmPerTick}
            />
          </section>
        )}

        {waveData && (
          <section className="flex flex-col gap-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <StepLabel step={4} title="Results" />

            <ElevationChart data={waveData} points={points} />

            {Object.entries(statsErrorsByPoint).map(([pointId, message]) => {
              const point = points.find((p) => p.id === pointId);
              return (
                <p key={pointId} className="text-sm text-red-600">
                  {point?.label ?? pointId}: could not compute wave statistics — {message}
                </p>
              );
            })}

            {Object.keys(statsByPoint).length > 0 && (
              <>
                <WaveHeightHistogram points={points} statsByPoint={statsByPoint} />
                <ResultsSummary
                  points={points}
                  waveData={waveData}
                  statsByPoint={statsByPoint}
                />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function StepLabel({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        {step}
      </span>
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
    </div>
  );
}
