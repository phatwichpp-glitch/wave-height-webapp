import path from "node:path";
import { test, expect, type Locator } from "@playwright/test";

// Playwright transforms .ts test files as CommonJS by default (this project's
// package.json has no "type": "module"), so plain __dirname is used here
// rather than import.meta.url (which isn't valid syntax under CJS).
const VIDEO_PATH = path.join(__dirname, "fixtures", "synthetic-wave.mp4");

// Must match how e2e/fixtures/synthetic-wave.mp4 was generated (see
// scripts/generate-test-video.mjs and package.json's "pretest:e2e" script).
const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 240;
const AMPLITUDE_PX = 20;

// Two arbitrary-but-known points clicked on the calibration canvas below;
// the synthetic video has no printed ruler, so calibration just needs any
// two points with a known pixel distance and a claimed real-world distance.
const CALIBRATION_POINT_1 = { x: 160, y: 50 };
const CALIBRATION_POINT_2 = { x: 160, y: 190 };
const KNOWN_DISTANCE_CM = 10;
const EXPECTED_PIXELS_PER_CM =
  Math.abs(CALIBRATION_POINT_2.y - CALIBRATION_POINT_1.y) / KNOWN_DISTANCE_CM;
const EXPECTED_H_SIGNIFICANT_CM = (2 * AMPLITUDE_PX) / EXPECTED_PIXELS_PER_CM;

async function clickAtCanvasPixel(canvas: Locator, targetX: number, targetY: number) {
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Canvas is not visible");
  }
  // Position is expressed as a fraction of the canvas's rendered CSS box, so
  // this maps to the same native canvas pixel regardless of how the browser
  // has scaled the element for display. Using locator.click({ position })
  // instead of a raw page.mouse.click(x, y) matters here: the raw version
  // skips Playwright's normal actionability checks (scrolled into view,
  // element stable/on top), so a click can silently land on the wrong thing.
  const relativeX = (targetX / VIDEO_WIDTH) * box.width;
  const relativeY = (targetY / VIDEO_HEIGHT) * box.height;
  await canvas.click({ position: { x: relativeX, y: relativeY } });
}

test("upload -> calibrate -> process -> results -> CSV download", async ({ page }) => {
  await page.goto("/auto");

  // Step 1: upload the synthetic video.
  await page.setInputFiles('input[type="file"]', VIDEO_PATH);

  // Step 2: calibrate against two known points.
  const calibrationSection = page.locator("section", {
    hasText: "Calibrate against a known distance",
  });
  const calibrationCanvas = calibrationSection.locator("canvas");
  await expect(calibrationCanvas).toBeVisible({ timeout: 15_000 });
  // Wait for the first frame to actually be drawn (and the canvas resized to
  // the video's native resolution) before computing click positions from it.
  await expect(calibrationSection.getByText(/loading first frame/i)).toHaveCount(0, {
    timeout: 15_000,
  });

  await clickAtCanvasPixel(calibrationCanvas, CALIBRATION_POINT_1.x, CALIBRATION_POINT_1.y);
  await clickAtCanvasPixel(calibrationCanvas, CALIBRATION_POINT_2.x, CALIBRATION_POINT_2.y);

  await calibrationSection.getByLabel(/known distance/i).fill(String(KNOWN_DISTANCE_CM));
  await calibrationSection.getByRole("button", { name: /confirm calibration/i }).click();

  // Step 3: pick a measurement column and run processing.
  const processingSection = page.locator("section", {
    hasText: "Configure and run processing",
  });
  // ProcessingPanel renders two canvases: a hidden one used internally for
  // frame capture, and PointSelector's visible preview canvas for clicking to
  // add measurement points — only the latter should be matched here.
  const processingCanvas = processingSection.locator("canvas:visible");
  await expect(processingCanvas).toBeVisible({ timeout: 15_000 });
  await expect(processingSection.getByText(/loading first frame/i)).toHaveCount(0, {
    timeout: 15_000,
  });

  await clickAtCanvasPixel(processingCanvas, VIDEO_WIDTH / 2, VIDEO_HEIGHT / 2);
  await processingSection.getByRole("button", { name: /start processing/i }).click();

  // Step 4: wait for results — processing an 8s synthetic video for real in a
  // browser (per-frame video seeking) is slow, so allow a generous timeout.
  // Point IDs are generated at runtime, so the Hs cell can't be targeted by a
  // fixed test id — instead find the results row for the point by its default
  // auto-assigned label ("Point 1", the only point added above) and read its
  // Hs cell (marked with a `hs-<pointId>` test id) from within that row.
  const resultsSection = page.locator("section", { hasText: "Results" });
  const pointRow = resultsSection.locator("tr", { hasText: "Point 1" });
  await expect(pointRow).toBeVisible({ timeout: 90_000 });

  const hSignificantStat = pointRow.getByTestId(/^hs-/);
  const hSignificantText = await hSignificantStat.innerText();
  const hSignificant = parseFloat(hSignificantText);

  expect(hSignificant).toBeGreaterThan(0);
  const relativeError =
    Math.abs(hSignificant - EXPECTED_H_SIGNIFICANT_CM) / EXPECTED_H_SIGNIFICANT_CM;
  expect(relativeError).toBeLessThanOrEqual(0.15);

  // Verify the raw-data CSV download actually works.
  const downloadPromise = page.waitForEvent("download");
  await resultsSection.getByRole("button", { name: /download raw data/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
