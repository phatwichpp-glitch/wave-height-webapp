import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PointSelector from "./PointSelector";
import type { RulerCalibration } from "@/types/wave";

// jsdom implements neither real canvas 2D rendering nor real video decoding,
// so both are stubbed: a no-op 2D context (just enough for drawFirstFrame to
// consider the frame "ready") and a fixed bounding rect (so click-position
// math has a real width/height to scale against instead of jsdom's all-zero
// default layout).
function installCanvasStub() {
  const noop = () => {};
  const contextStub = {
    clearRect: noop,
    drawImage: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
  };

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    contextStub as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    top: 0,
    left: 0,
    right: 320,
    bottom: 240,
    toJSON: () => ({}),
  });
}

function makeFrameReady(video: HTMLVideoElement) {
  Object.defineProperty(video, "videoWidth", { value: 320, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 240, configurable: true });
  fireEvent(video, new Event("loadeddata"));
  fireEvent(video, new Event("seeked"));
}

describe("PointSelector", () => {
  beforeEach(() => {
    installCanvasStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds points on click, up to maxPoints, and reports them via onChange", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <PointSelector videoUrl="blob:test" onChange={handleChange} maxPoints={2} />
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    makeFrameReady(video);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    fireEvent.click(canvas, { clientX: 100, clientY: 50 });
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();

    fireEvent.click(canvas, { clientX: 200, clientY: 50 });
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
    expect(screen.getByText(/maximum of 2/i)).toBeInTheDocument();

    // A third click should be ignored once maxPoints is reached.
    fireEvent.click(canvas, { clientX: 250, clientY: 50 });
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();

    expect(handleChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: "Point 1" }),
        expect.objectContaining({ label: "Point 2" }),
      ])
    );
  });

  it("allows editing a point's label and removing a point", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <PointSelector videoUrl="blob:test" onChange={handleChange} maxPoints={8} />
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    makeFrameReady(video);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.click(canvas, { clientX: 100, clientY: 50 });

    const labelInput = screen.getByLabelText(/label for measurement point/i);
    fireEvent.change(labelInput, { target: { value: "Upstream" } });
    expect(screen.getByDisplayValue("Upstream")).toBeInTheDocument();

    const removeButton = screen.getByRole("button", { name: /remove upstream/i });
    fireEvent.click(removeButton);

    expect(screen.queryByDisplayValue("Upstream")).not.toBeInTheDocument();
    expect(screen.getByText(/0\/8/)).toBeInTheDocument();
  });

  it("derives xOffsetCm from the click position and asks for a cm baseline when a ruler calibration is supplied", () => {
    const handleChange = vi.fn();
    const rulerCalibration: RulerCalibration = {
      point1: { x: 10, y: 0, valueCm: 0 },
      point2: { x: 10, y: 200, valueCm: 10 }, // 20 px/cm
      roi: { x: 0, y: 0, width: 20, height: 240 }, // centerX = 10
    };

    const { container } = render(
      <PointSelector
        videoUrl="blob:test"
        onChange={handleChange}
        rulerCalibration={rulerCalibration}
      />
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    makeFrameReady(video);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    // Click at x=50 -> offsetCm = (50 - 10) / 20 = 2.
    fireEvent.click(canvas, { clientX: 50, clientY: 50 });

    expect(handleChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ xOffsetCm: 2, baselineValueCm: null }),
    ]);

    const baselineInput = screen.getByLabelText(/baseline in cm for point 1/i);
    fireEvent.change(baselineInput, { target: { value: "5" } });

    expect(handleChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ xOffsetCm: 2, baselineValueCm: 5 }),
    ]);
  });
});
