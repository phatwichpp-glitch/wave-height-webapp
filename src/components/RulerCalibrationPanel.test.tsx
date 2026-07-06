import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RulerCalibrationPanel from "./RulerCalibrationPanel";

function installCanvasStub() {
  const noop = () => {};
  const contextStub = {
    clearRect: noop,
    drawImage: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    strokeRect: noop,
    arc: noop,
    fill: noop,
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

describe("RulerCalibrationPanel", () => {
  beforeEach(() => {
    installCanvasStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws an ROI by dragging, then two tick clicks, and confirms a full calibration", () => {
    const handleCalibrated = vi.fn();
    const { container } = render(
      <RulerCalibrationPanel videoUrl="blob:test" onCalibrated={handleCalibrated} />
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    makeFrameReady(video);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    // Drag out a ROI box.
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 40, clientY: 100 });

    expect(screen.getByText(/click two tick marks/i)).toBeInTheDocument();

    // Click two tick marks inside the ROI.
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 30 });
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 80 });

    expect(screen.getByText(/ticks selected: 2\/2/i)).toBeInTheDocument();

    const tick1Input = screen.getByLabelText(/real value in cm for tick 1/i);
    const tick2Input = screen.getByLabelText(/real value in cm for tick 2/i);
    fireEvent.change(tick1Input, { target: { value: "10" } });
    fireEvent.change(tick2Input, { target: { value: "20" } });

    const cmPerTickInput = screen.getByLabelText(/spacing between adjacent ticks/i);
    fireEvent.change(cmPerTickInput, { target: { value: "1" } });

    const confirmButton = screen.getByRole("button", { name: /confirm ruler calibration/i });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(handleCalibrated).toHaveBeenCalledTimes(1);
    const [calibration, cmPerTick] = handleCalibrated.mock.calls[0];
    expect(cmPerTick).toBe(1);
    expect(calibration.point1).toMatchObject({ x: 20, y: 30, valueCm: 10 });
    expect(calibration.point2).toMatchObject({ x: 20, y: 80, valueCm: 20 });
    expect(calibration.roi).toMatchObject({ x: 10, y: 20, width: 30, height: 80 });
  });

  it("keeps confirm disabled until both tick values are filled in", () => {
    const handleCalibrated = vi.fn();
    const { container } = render(
      <RulerCalibrationPanel videoUrl="blob:test" onCalibrated={handleCalibrated} />
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    makeFrameReady(video);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 100 });
    fireEvent.mouseUp(canvas, { clientX: 40, clientY: 100 });

    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 30 });
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 80 });

    const confirmButton = screen.getByRole("button", { name: /confirm ruler calibration/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(handleCalibrated).not.toHaveBeenCalled();
  });
});
