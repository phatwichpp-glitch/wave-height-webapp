import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultsSummary from "./ResultsSummary";
import type { WaveDataPoint, WaveStatistics } from "@/types/wave";

const mockStats: WaveStatistics = {
  nWaves: 12,
  hMax: 25.4,
  hMean: 18.2,
  hRms: 19.1,
  hSignificant: 22.7,
  periodMeanS: 1.85,
  periodSignificantS: 2.1,
  waves: [],
};

const mockWaveData: WaveDataPoint[] = [
  { timeS: 0, elevationCm: 0, confidence: 3 },
  { timeS: 0.1, elevationCm: 1.2, confidence: 3.2 },
];

describe("ResultsSummary", () => {
  it("renders the key statistics from the stats object", () => {
    render(<ResultsSummary waveData={mockWaveData} stats={mockStats} />);

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("25.4")).toBeInTheDocument();
    expect(screen.getByText("18.2")).toBeInTheDocument();
    expect(screen.getByText("22.7")).toBeInTheDocument();
    expect(screen.getByText("1.85")).toBeInTheDocument();
    expect(screen.getByText("2.10")).toBeInTheDocument();
  });

  it("renders enabled, clickable download buttons", () => {
    render(<ResultsSummary waveData={mockWaveData} stats={mockStats} />);

    const csvButton = screen.getByRole("button", { name: /download raw data/i });
    const reportButton = screen.getByRole("button", {
      name: /download summary report/i,
    });

    expect(csvButton).toBeInTheDocument();
    expect(csvButton).toBeEnabled();
    expect(reportButton).toBeInTheDocument();
    expect(reportButton).toBeEnabled();
  });
});
