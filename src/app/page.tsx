"use client";

import { useMemo, useState } from "react";
import type { CalibrationData, WaveDataPoint, WaveStatistics } from "@/types/wave";
import VideoUploader from "@/components/VideoUploader";
import CalibrationCanvas from "@/components/CalibrationCanvas";
import ProcessingPanel from "@/components/ProcessingPanel";
import ElevationChart from "@/components/ElevationChart";
import WaveHeightHistogram from "@/components/WaveHeightHistogram";
import ResultsSummary from "@/components/ResultsSummary";
import { computeWaveStatistics } from "@/lib/waveStatistics";

export default function Home() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [waveData, setWaveData] = useState<WaveDataPoint[] | null>(null);

  function handleVideoLoaded(url: string) {
    setVideoUrl(url);
    setCalibration(null);
    setWaveData(null);
  }

  function handleCalibrated(data: CalibrationData) {
    setCalibration(data);
    setWaveData(null);
  }

  const { stats, statsError } = useMemo((): {
    stats: WaveStatistics | null;
    statsError: string | null;
  } => {
    if (!waveData) {
      return { stats: null, statsError: null };
    }
    try {
      const timeS = waveData.map((d) => d.timeS);
      const elevationCm = waveData.map((d) => d.elevationCm);
      return { stats: computeWaveStatistics(timeS, elevationCm), statsError: null };
    } catch (err) {
      return { stats: null, statsError: err instanceof Error ? err.message : String(err) };
    }
  }, [waveData]);

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
        </header>

        <section className="flex flex-col gap-3">
          <StepLabel step={1} title="Upload a video" />
          <VideoUploader onVideoLoaded={handleVideoLoaded} />
        </section>

        {videoUrl && (
          <section className="flex flex-col gap-3">
            <StepLabel step={2} title="Calibrate against a known distance" />
            <CalibrationCanvas videoUrl={videoUrl} onCalibrated={handleCalibrated} />
          </section>
        )}

        {videoUrl && calibration && (
          <section className="flex flex-col gap-3">
            <StepLabel step={3} title="Configure and run processing" />
            <ProcessingPanel
              videoUrl={videoUrl}
              calibration={calibration}
              onComplete={setWaveData}
            />
          </section>
        )}

        {waveData && (
          <section className="flex flex-col gap-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <StepLabel step={4} title="Results" />

            <ElevationChart data={waveData} />

            {statsError && (
              <p className="text-sm text-red-600">
                Could not compute wave statistics: {statsError}
              </p>
            )}

            {stats && (
              <>
                <WaveHeightHistogram
                  waves={stats.waves}
                  hMean={stats.hMean}
                  hSignificant={stats.hSignificant}
                />
                <ResultsSummary waveData={waveData} stats={stats} />
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
