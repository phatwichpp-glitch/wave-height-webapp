import type { WaveDataPoint } from "@/types/wave";

/**
 * Resamples irregularly-timestamped data (as produced by
 * processVideoWithFrameCallback, where rVFC delivers whatever frames the
 * browser actually decoded) onto a uniform `1/targetSampleRateHz` grid from
 * 0 to durationS, so it can feed into the rest of the pipeline (wave
 * statistics, charts) exactly like seek-based processVideo()'s output.
 *
 * Uses linear interpolation between the two real samples straddling each
 * grid point. confidence is taken from whichever of the two straddling
 * samples is closer in time, rather than interpolated — confidence is a
 * detection-quality score, not a physical quantity, so blending two
 * detections' confidences produces a number with no clear meaning; "closest
 * real measurement's own confidence" is a more honest answer.
 *
 * Grid points before the first sample or after the last are clamped to that
 * nearest edge sample rather than extrapolated, to avoid fabricating trend
 * beyond the range actual data ever covered.
 */
export function resampleToUniformGrid(
  data: WaveDataPoint[],
  targetSampleRateHz: number,
  durationS: number
): WaveDataPoint[] {
  if (data.length === 0) {
    return [];
  }

  const sorted = [...data].sort((a, b) => a.timeS - b.timeS);
  const n = Math.floor(durationS * targetSampleRateHz) + 1;
  const result: WaveDataPoint[] = [];

  let searchIndex = 0;

  for (let i = 0; i < n; i++) {
    const gridTimeS = i / targetSampleRateHz;

    // Clamp to the edges instead of extrapolating past real data.
    if (gridTimeS <= sorted[0].timeS) {
      result.push({ timeS: gridTimeS, elevationCm: sorted[0].elevationCm, confidence: sorted[0].confidence });
      continue;
    }
    if (gridTimeS >= sorted[sorted.length - 1].timeS) {
      const last = sorted[sorted.length - 1];
      result.push({ timeS: gridTimeS, elevationCm: last.elevationCm, confidence: last.confidence });
      continue;
    }

    // Advance the two-pointer search forward only — grid points are visited
    // in increasing time order, so the straddling pair never needs to move
    // backward, keeping the whole resample O(n + m) instead of O(n * m).
    while (
      searchIndex < sorted.length - 2 &&
      sorted[searchIndex + 1].timeS < gridTimeS
    ) {
      searchIndex += 1;
    }

    const before = sorted[searchIndex];
    const after = sorted[searchIndex + 1];
    const span = after.timeS - before.timeS;
    const frac = span > 0 ? (gridTimeS - before.timeS) / span : 0;

    result.push({
      timeS: gridTimeS,
      elevationCm: before.elevationCm + frac * (after.elevationCm - before.elevationCm),
      confidence: frac < 0.5 ? before.confidence : after.confidence,
    });
  }

  return result;
}
