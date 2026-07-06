"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { DetectionResult } from "@/lib/videoProcessor";

interface LiveViewerCanvasProps {
  videoCanvasRef: RefObject<HTMLCanvasElement | null>;
  currentDetections: DetectionResult[];
}

export default function LiveViewerCanvas({
  videoCanvasRef,
  currentDetections,
}: LiveViewerCanvasProps) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const videoCanvas = videoCanvasRef.current;
    const overlay = overlayRef.current;
    if (!videoCanvas || !overlay) {
      return;
    }

    // Keep the overlay's pixel resolution in sync with the underlying frame canvas.
    if (overlay.width !== videoCanvas.width || overlay.height !== videoCanvas.height) {
      overlay.width = videoCanvas.width;
      overlay.height = videoCanvas.height;
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) {
      return;
    }

    // Clear before every redraw so stale markers from previous frames don't linger.
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    for (const detection of currentDetections) {
      // Faint vertical line at this point's measured column, full frame height.
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = detection.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(detection.xColumn, 0);
      ctx.lineTo(detection.xColumn, overlay.height);
      ctx.stroke();
      ctx.restore();

      // Fainter horizontal line at this point's still-water baseline.
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = detection.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, detection.baselineY);
      ctx.lineTo(overlay.width, detection.baselineY);
      ctx.stroke();
      ctx.restore();

      // Detected surface position marker.
      ctx.beginPath();
      ctx.arc(detection.xColumn, detection.yPosition, 5, 0, Math.PI * 2);
      ctx.fillStyle = detection.color;
      ctx.fill();

      // Confidence readout next to the marker, to spot suspiciously low-confidence frames.
      ctx.fillStyle = detection.color;
      ctx.font = "10px sans-serif";
      ctx.fillText(
        detection.confidence.toFixed(1),
        detection.xColumn + 8,
        detection.yPosition - 8
      );
    }
  }, [currentDetections, videoCanvasRef]);

  return (
    <canvas
      ref={overlayRef}
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
    />
  );
}
