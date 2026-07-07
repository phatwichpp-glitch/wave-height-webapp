import type {
  BatchConfig,
  BatchResult,
  BatchVideoConfig,
  CalibrationData,
  MeasurementPoint,
  WaveStatistics,
} from "@/types/wave";
import { processVideo } from "@/lib/videoProcessor";
import { computeWaveStatistics } from "@/lib/waveStatistics";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Invalid batch config: "${path}" must be a finite number, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Invalid batch config: "${path}" must be a non-empty string, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function assertNullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return assertNumber(value, path);
}

function parseXY(value: unknown, path: string): { x: number; y: number } {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid batch config: "${path}" must be an object with x/y, got ${JSON.stringify(value)}`
    );
  }
  return { x: assertNumber(value.x, `${path}.x`), y: assertNumber(value.y, `${path}.y`) };
}

function parseCalibrationData(value: unknown, path: string): CalibrationData {
  if (!isRecord(value)) {
    throw new Error(`Invalid batch config: "${path}" must be an object, got ${JSON.stringify(value)}`);
  }
  return {
    point1: parseXY(value.point1, `${path}.point1`),
    point2: parseXY(value.point2, `${path}.point2`),
    knownDistanceCm: assertNumber(value.knownDistanceCm, `${path}.knownDistanceCm`),
    pixelsPerCm: assertNumber(value.pixelsPerCm, `${path}.pixelsPerCm`),
  };
}

function parseMeasurementPoint(value: unknown, path: string): MeasurementPoint {
  if (!isRecord(value)) {
    throw new Error(`Invalid batch config: "${path}" must be an object, got ${JSON.stringify(value)}`);
  }
  return {
    id: assertString(value.id, `${path}.id`),
    xColumn: assertNumber(value.xColumn, `${path}.xColumn`),
    label: assertString(value.label, `${path}.label`),
    color: assertString(value.color, `${path}.color`),
    baselineY: assertNullableNumber(value.baselineY, `${path}.baselineY`),
    baselineValueCm: assertNullableNumber(value.baselineValueCm, `${path}.baselineValueCm`),
    xOffsetCm: value.xOffsetCm === undefined ? 0 : assertNumber(value.xOffsetCm, `${path}.xOffsetCm`),
  };
}

function parseMeasurementPoints(value: unknown, path: string): MeasurementPoint[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid batch config: "${path}" must be an array, got ${JSON.stringify(value)}`);
  }
  return value.map((item, index) => parseMeasurementPoint(item, `${path}[${index}]`));
}

function parseBatchVideoConfig(value: unknown, path: string): BatchVideoConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid batch config: "${path}" must be an object, got ${JSON.stringify(value)}`);
  }
  return {
    fileNamePattern: assertString(value.fileNamePattern, `${path}.fileNamePattern`),
    label: value.label === undefined ? undefined : assertString(value.label, `${path}.label`),
    overridePoints:
      value.overridePoints === undefined
        ? undefined
        : parseMeasurementPoints(value.overridePoints, `${path}.overridePoints`),
    overrideCalibration:
      value.overrideCalibration === undefined
        ? undefined
        : parseCalibrationData(value.overrideCalibration, `${path}.overrideCalibration`),
  };
}

/** Validates a parsed JSON value against the BatchConfig shape, throwing a specific, field-pinpointing Error on the first problem found (batch configs are hand-written, so a vague error is much harder to fix). */
export function validateBatchConfig(config: unknown): BatchConfig {
  if (!isRecord(config)) {
    throw new Error("Invalid batch config: expected a JSON object at the top level");
  }

  const defaultCalibration = parseCalibrationData(config.defaultCalibration, "defaultCalibration");
  const defaultPoints = parseMeasurementPoints(config.defaultPoints, "defaultPoints");

  if (!Array.isArray(config.videos)) {
    throw new Error(`Invalid batch config: "videos" must be an array, got ${JSON.stringify(config.videos)}`);
  }
  const videos = config.videos.map((item, index) => parseBatchVideoConfig(item, `videos[${index}]`));

  const sampleRateHz = assertNumber(config.sampleRateHz, "sampleRateHz");
  if (sampleRateHz <= 0) {
    throw new Error(`Invalid batch config: "sampleRateHz" must be greater than 0, got ${sampleRateHz}`);
  }

  return { defaultCalibration, defaultPoints, videos, sampleRateHz };
}

/** Finds the BatchVideoConfig whose fileNamePattern exactly matches fileName, or null if none matches (caller should fall back to the batch's defaults). */
export function matchVideoToConfig(
  fileName: string,
  batchConfig: BatchConfig
): BatchVideoConfig | null {
  return batchConfig.videos.find((video) => video.fileNamePattern === fileName) ?? null;
}

function loadVideoMetadata(video: HTMLVideoElement, objectUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    }
    function handleLoadedMetadata() {
      cleanup();
      resolve();
    }
    function handleError() {
      cleanup();
      reject(new Error(`Could not load video metadata (file may be corrupt or unsupported)`));
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);
    video.src = objectUrl;
    video.load();
  });
}

/**
 * Processes each file sequentially (never in parallel — multiple videos
 * decoding at once would blow up memory). A single file's error is caught and
 * reported via onVideoError/onVideoComplete without stopping the rest of the
 * batch.
 */
export async function processBatch(
  files: File[],
  batchConfig: BatchConfig,
  onVideoStart: (fileName: string) => void,
  onVideoComplete: (result: BatchResult) => void,
  onVideoError: (fileName: string, error: Error) => void
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const file of files) {
    onVideoStart(file.name);

    const videoConfig = matchVideoToConfig(file.name, batchConfig);
    const points = videoConfig?.overridePoints ?? batchConfig.defaultPoints;
    const calibration = videoConfig?.overrideCalibration ?? batchConfig.defaultCalibration;

    const objectUrl = URL.createObjectURL(file);

    try {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      const canvas = document.createElement("canvas");

      await loadVideoMetadata(video, objectUrl);

      const rawData = await processVideo(video, canvas, calibration, {
        points,
        columnWidth: 3,
        searchMarginPx: 40,
        smoothSigma: 2.0,
        sampleRateHz: batchConfig.sampleRateHz,
      });

      const statistics: Record<string, WaveStatistics> = {};
      for (const point of points) {
        const pointData = rawData[point.id];
        if (!pointData) {
          continue;
        }
        try {
          const timeS = pointData.map((d) => d.timeS);
          const elevationCm = pointData.map((d) => d.elevationCm);
          statistics[point.id] = computeWaveStatistics(timeS, elevationCm, {
            sampleRateHz: batchConfig.sampleRateHz,
          });
        } catch {
          // Not enough waves detected for this point — omit it from
          // statistics but keep its raw data so it's still exportable.
        }
      }

      const result: BatchResult = {
        fileName: file.name,
        status: "done",
        statistics,
        rawData,
        points,
      };
      results.push(result);
      onVideoComplete(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const result: BatchResult = {
        fileName: file.name,
        status: "error",
        errorMessage: error.message,
        points,
      };
      results.push(result);
      onVideoError(file.name, error);
      onVideoComplete(result);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return results;
}
