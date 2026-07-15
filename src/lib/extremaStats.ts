/**
 * Statistics for the manual crest/trough annotation tool (Phase 18), where a
 * human marks only the peak and trough of each wave cycle instead of a dense
 * time series — computeWaveStatistics (zero up-crossing on a regularly
 * sampled signal) doesn't apply to this kind of sparse, alternating data, so
 * this is a separate, purpose-built pairing method.
 */

export interface ExtremaPoint {
  timeS: number;
  valueCm: number;
  type: "crest" | "trough";
}

export interface WaveHeightPair {
  heightCm: number;
  startTimeS: number;
  endTimeS: number;
}

/** A non-fatal data-quality notice (e.g. two crests marked back-to-back with no trough between). Structured rather than a pre-formatted string so the UI layer can translate/render it — this is a plain data module with no access to the app's i18n system. */
export interface ExtremaWarning {
  type: "consecutiveSameType";
  extremaType: "crest" | "trough";
  time1S: number;
  time2S: number;
}

export interface ExtremaStats {
  nWaves: number;
  hMax: number;
  hMean: number;
  hSignificant: number;
  periodMeanS: number;
  waveHeights: WaveHeightPair[];
  warnings: ExtremaWarning[];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function computeExtremaStats(extrema: ExtremaPoint[]): ExtremaStats {
  const sorted = [...extrema].sort((a, b) => a.timeS - b.timeS);
  const warnings: ExtremaWarning[] = [];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].type === sorted[i - 1].type) {
      warnings.push({
        type: "consecutiveSameType",
        extremaType: sorted[i].type,
        time1S: sorted[i - 1].timeS,
        time2S: sorted[i].timeS,
      });
    }
  }

  // Every adjacent pair (regardless of which type starts) is one half-wave —
  // the height between one extreme and the very next one marked.
  const waveHeights: WaveHeightPair[] = [];
  for (let i = 1; i < sorted.length; i++) {
    waveHeights.push({
      heightCm: Math.abs(sorted[i].valueCm - sorted[i - 1].valueCm),
      startTimeS: sorted[i - 1].timeS,
      endTimeS: sorted[i].timeS,
    });
  }

  const heights = waveHeights.map((w) => w.heightCm);
  const nWaves = waveHeights.length;
  const nThird = Math.ceil(nWaves / 3);
  const topHeights = [...heights].sort((a, b) => b - a).slice(0, nThird);

  // Period is measured crest-to-next-crest and trough-to-next-trough (a full
  // cycle each), pooled together into one mean.
  const crestTimes = sorted.filter((p) => p.type === "crest").map((p) => p.timeS);
  const troughTimes = sorted.filter((p) => p.type === "trough").map((p) => p.timeS);
  const periods: number[] = [];
  for (let i = 1; i < crestTimes.length; i++) {
    periods.push(crestTimes[i] - crestTimes[i - 1]);
  }
  for (let i = 1; i < troughTimes.length; i++) {
    periods.push(troughTimes[i] - troughTimes[i - 1]);
  }

  return {
    nWaves,
    hMax: heights.length > 0 ? Math.max(...heights) : 0,
    hMean: mean(heights),
    hSignificant: mean(topHeights),
    periodMeanS: mean(periods),
    waveHeights,
    warnings,
  };
}

export interface SineFitResult {
  amplitudeCm: number;
  frequencyHz: number;
  periodS: number;
  phaseRad: number;
  /** Fitted still-water level (the sine's vertical offset). */
  offsetCm: number;
  /** Goodness of fit against the marked extrema, 0-1 — how close to a pure sine the marked data is. */
  rSquared: number;
}

/** Solves a 3x3 linear system via Gaussian elimination with partial pivoting. Returns null if the matrix is singular (degenerate input, e.g. every point at the same time). */
function solve3x3(coefficients: number[][], target: number[]): number[] | null {
  const augmented = coefficients.map((row, i) => [...row, target[i]]);

  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][col]) < 1e-10) {
      return null;
    }
    [augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]];

    for (let row = 0; row < 3; row++) {
      if (row === col) {
        continue;
      }
      const factor = augmented[row][col] / augmented[col][col];
      for (let c = col; c < 4; c++) {
        augmented[row][c] -= factor * augmented[col][c];
      }
    }
  }

  return [
    augmented[0][3] / augmented[0][0],
    augmented[1][3] / augmented[1][1],
    augmented[2][3] / augmented[2][2],
  ];
}

/** Least-squares fit of v(t) = offset + a*cos(2*pi*f*t) + b*sin(2*pi*f*t) at a fixed frequency f (linear regression, since f is held constant this is just 3 unknowns). */
function fitAtFrequency(
  extrema: ExtremaPoint[],
  frequencyHz: number
): { offsetCm: number; a: number; b: number; ssRes: number } | null {
  let s01 = 0;
  let s02 = 0;
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;

  const cosVals: number[] = [];
  const sinVals: number[] = [];
  for (const p of extrema) {
    const theta = 2 * Math.PI * frequencyHz * p.timeS;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    cosVals.push(c);
    sinVals.push(s);
    s01 += c;
    s02 += s;
    s11 += c * c;
    s12 += c * s;
    s22 += s * s;
    t0 += p.valueCm;
    t1 += p.valueCm * c;
    t2 += p.valueCm * s;
  }

  const n = extrema.length;

  // Guard against near-degenerate candidate frequencies: if the marked
  // sample times happen to fall (at this particular frequency) at almost
  // regular half-period offsets, the cos or sin column carries almost no
  // independent signal even though the 3x3 matrix isn't exactly singular —
  // solve3x3 still returns an answer, but it's wildly sensitive/blown-up
  // (e.g. a "fitted" amplitude of thousands of cm), and its artificially low
  // residual can make the grid search prefer it over a well-conditioned,
  // physically sane candidate nearby. A well-conditioned frequency should
  // carry roughly n/2 of "energy" in each of cos²/sin² on average; require
  // at least 10% of that as a cheap, scale-free sanity floor.
  if (s11 < 0.1 * n || s22 < 0.1 * n) {
    return null;
  }

  const solved = solve3x3(
    [
      [n, s01, s02],
      [s01, s11, s12],
      [s02, s12, s22],
    ],
    [t0, t1, t2]
  );
  if (!solved) {
    return null;
  }
  const [offsetCm, a, b] = solved;

  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = offsetCm + a * cosVals[i] + b * sinVals[i];
    const residual = extrema[i].valueCm - predicted;
    ssRes += residual * residual;
  }

  return { offsetCm, a, b, ssRes };
}

/**
 * Fits v(t) = offsetCm + amplitudeCm * sin(2*pi*frequencyHz*t + phaseRad) to
 * the marked crest/trough points via a frequency grid search (each candidate
 * frequency reduces to an ordinary 3-unknown linear regression, since a·cos +
 * b·sin is linear once f is fixed — only f itself is nonlinear).
 *
 * Requires at least 4 points (2 full half-cycles) — fewer than that
 * under-determines a 3-parameter fit and null is returned rather than a
 * meaningless result.
 */
export function fitSineWave(
  extrema: ExtremaPoint[],
  initialFrequencyHz?: number,
  searchRangeFactor: number = 0.4
): SineFitResult | null {
  if (extrema.length < 4) {
    return null;
  }

  let f0 = initialFrequencyHz;
  if (!f0 || !Number.isFinite(f0) || f0 <= 0) {
    const stats = computeExtremaStats(extrema);
    if (Number.isFinite(stats.periodMeanS) && stats.periodMeanS > 0) {
      f0 = 1 / stats.periodMeanS;
    } else {
      // No same-type adjacent pair to measure a period from directly (e.g.
      // strictly alternating with only one crest and one trough) — fall
      // back to "half a cycle per gap between consecutive extrema".
      const sorted = [...extrema].sort((a, b) => a.timeS - b.timeS);
      const durationS = sorted[sorted.length - 1].timeS - sorted[0].timeS;
      const halfPeriods = sorted.length - 1;
      const avgHalfPeriodS = halfPeriods > 0 && durationS > 0 ? durationS / halfPeriods : 1;
      f0 = 1 / (avgHalfPeriodS * 2);
    }
  }

  const lo = Math.max(1e-6, f0 * (1 - searchRangeFactor));
  const hi = Math.max(lo + 1e-6, f0 * (1 + searchRangeFactor));
  const numCandidates = 200;

  let best:
    | { offsetCm: number; a: number; b: number; ssRes: number; frequencyHz: number }
    | null = null;

  for (let i = 0; i < numCandidates; i++) {
    const frequencyHz = lo + ((hi - lo) * i) / (numCandidates - 1);
    const fit = fitAtFrequency(extrema, frequencyHz);
    if (fit && (!best || fit.ssRes < best.ssRes)) {
      best = { ...fit, frequencyHz };
    }
  }

  if (!best) {
    return null;
  }

  const { offsetCm, a, b, ssRes, frequencyHz } = best;
  const amplitudeCm = Math.sqrt(a * a + b * b);
  // v(t) = offset + a*cos(theta) + b*sin(theta) must equal
  // offset + amplitude*sin(theta + phase) = offset + (amplitude*cos(phase))*sin(theta) + (amplitude*sin(phase))*cos(theta),
  // so amplitude*cos(phase) = b and amplitude*sin(phase) = a, i.e. phase = atan2(a, b).
  const phaseRad = Math.atan2(a, b);

  const meanValue = mean(extrema.map((p) => p.valueCm));
  const ssTot = extrema.reduce((sum, p) => sum + (p.valueCm - meanValue) ** 2, 0);
  const rSquared = ssTot > 1e-12 ? 1 - ssRes / ssTot : ssRes < 1e-9 ? 1 : 0;

  return {
    amplitudeCm,
    frequencyHz,
    periodS: 1 / frequencyHz,
    phaseRad,
    offsetCm,
    rSquared,
  };
}

export function generateSineFitCurve(
  fit: SineFitResult,
  startTimeS: number,
  endTimeS: number,
  numPoints: number = 200
): { timeS: number; valueCm: number }[] {
  const n = Math.max(2, numPoints);
  const points: { timeS: number; valueCm: number }[] = [];
  for (let i = 0; i < n; i++) {
    const timeS = startTimeS + ((endTimeS - startTimeS) * i) / (n - 1);
    const valueCm =
      fit.offsetCm + fit.amplitudeCm * Math.sin(2 * Math.PI * fit.frequencyHz * timeS + fit.phaseRad);
    points.push({ timeS, valueCm });
  }
  return points;
}
