import { extractColumnProfile, findSurfaceEdge } from "@/lib/surfaceDetector";

export interface PointRequest {
  pointId: string;
  xColumnRelative: number;
  searchRange: [number, number] | null;
}

export interface WorkerRequestMessage {
  imageData: ImageData;
  points: PointRequest[];
  columnWidth: number;
  smoothSigma: number;
}

export interface PointResult {
  pointId: string;
  yPosition: number;
  confidence: number;
  lowConfidence: boolean;
}

export type WorkerResponseMessage = PointResult[];

// Design trade-off: this worker is intentionally stateless — it does not keep
// its own SurfaceTracker/lastY per point. The main thread (videoProcessor.ts)
// owns the tracking state (one lastY per measurement point) and sends each
// point's already-computed searchRange with every message instead. That keeps
// this file a pure "compute one frame, all points" step and avoids a class of
// bugs where a reused worker instance carries stale lastY state across
// unrelated processVideo() calls. All points for a frame are bundled into a
// single message (one imageData crop covering every point's column) to avoid
// the far larger overhead of a separate postMessage round-trip per point.

// This project's tsconfig includes the "dom" lib (for the rest of the app),
// which is not compatible with also including the "webworker" lib in the same
// program (both declare a conflicting global `self`). So instead of a
// `/// <reference lib="webworker" />` directive, `self` is narrowed locally to
// just the two things this file actually uses.
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void) | null;
  postMessage: (message: WorkerResponseMessage) => void;
};

workerSelf.onmessage = (event) => {
  const { imageData, points, columnWidth, smoothSigma } = event.data;

  const results: PointResult[] = points.map((point) => {
    const profile = extractColumnProfile(imageData, point.xColumnRelative, columnWidth);
    const { yPosition, confidence, lowConfidence } = findSurfaceEdge(
      profile,
      point.searchRange,
      smoothSigma
    );
    return { pointId: point.pointId, yPosition, confidence, lowConfidence };
  });

  workerSelf.postMessage(results);
};
