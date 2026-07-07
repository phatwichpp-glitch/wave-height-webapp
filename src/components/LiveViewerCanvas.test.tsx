import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { RefObject } from "react";
import LiveViewerCanvas from "./LiveViewerCanvas";
import type { DetectionResult } from "@/lib/videoProcessor";

function createContextSpy() {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
  };
}

describe("LiveViewerCanvas", () => {
  let contextSpy: ReturnType<typeof createContextSpy>;

  beforeEach(() => {
    contextSpy = createContextSpy();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contextSpy as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a marker, baseline, column line, and confidence text for each detection", () => {
    const videoCanvasRef = {
      current: { width: 100, height: 200 } as unknown as HTMLCanvasElement,
    } as RefObject<HTMLCanvasElement | null>;

    const detections: DetectionResult[] = [
      {
        pointId: "p1",
        xColumn: 40,
        yPosition: 120,
        confidence: 3.5,
        lowConfidence: false,
        color: "#3b82f6",
        baselineY: 100,
      },
    ];

    render(
      <LiveViewerCanvas videoCanvasRef={videoCanvasRef} currentDetections={detections} />
    );

    expect(contextSpy.clearRect).toHaveBeenCalledWith(0, 0, 100, 200);

    // Vertical column line at xColumn, spanning the full frame height.
    expect(contextSpy.moveTo).toHaveBeenCalledWith(40, 0);
    expect(contextSpy.lineTo).toHaveBeenCalledWith(40, 200);

    // Horizontal baseline line across the full width.
    expect(contextSpy.moveTo).toHaveBeenCalledWith(0, 100);
    expect(contextSpy.lineTo).toHaveBeenCalledWith(100, 100);

    // Detected surface marker at (xColumn, yPosition).
    expect(contextSpy.arc).toHaveBeenCalledWith(40, 120, 5, 0, Math.PI * 2);
    expect(contextSpy.fill).toHaveBeenCalled();

    // Confidence readout offset from the marker.
    expect(contextSpy.fillText).toHaveBeenCalledWith("3.5", 48, 112);
  });

  it("switches the marker to a warning color instead of the point's own color when lowConfidence is true (Phase 16)", () => {
    const videoCanvasRef = {
      current: { width: 100, height: 200 } as unknown as HTMLCanvasElement,
    } as RefObject<HTMLCanvasElement | null>;

    const fillStyleSets: string[] = [];
    Object.defineProperty(contextSpy, "fillStyle", {
      set(v: string) {
        fillStyleSets.push(v);
      },
    });

    const detections: DetectionResult[] = [
      {
        pointId: "p1",
        xColumn: 40,
        yPosition: 120,
        confidence: 0.2,
        lowConfidence: true,
        color: "#3b82f6",
        baselineY: 100,
      },
    ];

    render(
      <LiveViewerCanvas videoCanvasRef={videoCanvasRef} currentDetections={detections} />
    );

    // The marker/text fill should never be set to the point's own color
    // (#3b82f6) while lowConfidence is true — only the warning color.
    expect(fillStyleSets).not.toContain("#3b82f6");
    expect(fillStyleSets.some((c) => c !== "#3b82f6")).toBe(true);
  });

  it("clears the overlay even when there are no detections", () => {
    const videoCanvasRef = {
      current: { width: 50, height: 60 } as unknown as HTMLCanvasElement,
    } as RefObject<HTMLCanvasElement | null>;

    render(<LiveViewerCanvas videoCanvasRef={videoCanvasRef} currentDetections={[]} />);

    expect(contextSpy.clearRect).toHaveBeenCalledWith(0, 0, 50, 60);
    expect(contextSpy.arc).not.toHaveBeenCalled();
  });
});
