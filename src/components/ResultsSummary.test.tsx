import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultsSummary from "./ResultsSummary";
import type { MeasurementPoint, WaveDataPoint, WaveStatistics } from "@/types/wave";

const mockPoints: MeasurementPoint[] = [
  {
    id: "p1",
    xColumn: 50,
    label: "Upstream",
    color: "#3b82f6",
    baselineY: 100,
    baselineValueCm: null,
    xOffsetCm: 0,
    initialGuessPixelY: 100,
    initialSearchMarginPx: null,
  },
  {
    id: "p2",
    xColumn: 200,
    label: "Downstream",
    color: "#ef4444",
    baselineY: 100,
    baselineValueCm: null,
    xOffsetCm: 0,
    initialGuessPixelY: 100,
    initialSearchMarginPx: null,
  },
];

const mockStatsByPoint: Record<string, WaveStatistics> = {
  p1: {
    nWaves: 12,
    hMax: 25.4,
    hMean: 18.2,
    hRms: 19.1,
    hSignificant: 22.7,
    periodMeanS: 1.85,
    periodSignificantS: 2.1,
    waves: [],
  },
  p2: {
    nWaves: 10,
    hMax: 15.0,
    hMean: 9.5,
    hRms: 10.2,
    hSignificant: 13.1,
    periodMeanS: 1.5,
    periodSignificantS: 1.8,
    waves: [],
  },
};

const mockWaveData: Record<string, WaveDataPoint[]> = {
  p1: [
    { timeS: 0, elevationCm: 0, confidence: 3 },
    { timeS: 0.1, elevationCm: 1.2, confidence: 3.2 },
  ],
  p2: [
    { timeS: 0, elevationCm: 0, confidence: 3 },
    { timeS: 0.1, elevationCm: 0.5, confidence: 3.1 },
  ],
};

describe("ResultsSummary", () => {
  it("renders a comparison row with statistics for each point", () => {
    render(
      <ResultsSummary
        points={mockPoints}
        waveData={mockWaveData}
        statsByPoint={mockStatsByPoint}
      />
    );

    expect(screen.getByText("Upstream")).toBeInTheDocument();
    expect(screen.getByText("Downstream")).toBeInTheDocument();

    expect(screen.getByTestId("hs-p1")).toHaveTextContent("22.7");
    expect(screen.getByTestId("hs-p2")).toHaveTextContent("13.1");
  });

  it("shows a fallback message for a point without enough waves", () => {
    render(
      <ResultsSummary
        points={mockPoints}
        waveData={mockWaveData}
        statsByPoint={{ p1: mockStatsByPoint.p1 }}
      />
    );

    expect(screen.getByText(/not enough waves detected/i)).toBeInTheDocument();
  });

  it("renders enabled, clickable download buttons", () => {
    render(
      <ResultsSummary
        points={mockPoints}
        waveData={mockWaveData}
        statsByPoint={mockStatsByPoint}
      />
    );

    const combinedCsvButton = screen.getByRole("button", { name: /download raw data/i });
    const reportButton = screen.getByRole("button", { name: /download summary report/i });
    const perPointCsvButtons = screen.getAllByRole("button", { name: "CSV" });

    expect(combinedCsvButton).toBeEnabled();
    expect(reportButton).toBeEnabled();
    expect(perPointCsvButtons).toHaveLength(mockPoints.length);
    perPointCsvButtons.forEach((button) => expect(button).toBeEnabled());
  });
});
