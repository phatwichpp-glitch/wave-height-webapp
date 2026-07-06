import { extractColumnProfile, findSurfaceEdge } from "@/lib/surfaceDetector";
import type { EdgeResult } from "@/lib/surfaceDetector";

export interface WorkerRequestMessage {
  imageData: ImageData;
  xColumnRelative: number;
  columnWidth: number;
  searchRange: [number, number] | null;
  smoothSigma: number;
}

export type WorkerResponseMessage = EdgeResult;

// Design trade-off: this worker is intentionally stateless — it does not keep
// its own SurfaceTracker/lastY. The main thread (videoProcessor.ts) owns the
// tracking state and sends the already-computed searchRange with every
// message instead. That keeps this file a pure "compute one frame" step and
// avoids a class of bugs where a reused worker instance carries stale lastY
// state across unrelated processVideo() calls (e.g. re-processing a video, or
// running a second video without creating a fresh worker). The cost is one
// small extra field (searchRange) sent per message instead of letting the
// worker track it internally.

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
  const { imageData, xColumnRelative, columnWidth, searchRange, smoothSigma } = event.data;

  const profile = extractColumnProfile(imageData, xColumnRelative, columnWidth);
  const result = findSurfaceEdge(profile, searchRange, smoothSigma);

  workerSelf.postMessage(result);
};
