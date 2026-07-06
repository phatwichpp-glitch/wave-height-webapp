# Wave Height Web App

A browser-based tool for analyzing water wave height from video, entirely client-side
(no server upload needed — video processing runs in the browser, optionally offloaded
to a Web Worker). This is a Next.js companion to the Python `wave_height_analyzer`
CLI/library, aimed at giving the same calibration → surface detection → statistics
pipeline a shareable web UI.

Features:

- **Fixed-camera mode** — calibrate once against a known distance, click measurement
  columns, and extract an elevation time series per point via edge detection.
- **Handheld/zooming-camera mode** — continuously re-calibrates against a ruler's
  tick marks to correct vertical drift and zoom (horizontal panning is not corrected;
  keep the ruler inside its selected region).
- **Wave statistics** — zero up-crossing analysis (with linear detrending) producing
  H_max, H_mean, H_rms, H_1/3 (significant height), and mean/significant periods,
  plus an elevation chart and wave-height histogram.
- **Exports** — per-point and combined CSVs, a plain-text summary report, and batch
  processing of multiple videos from a JSON config with a ZIP of all results.

## Tech Stack

- **Next.js** (App Router, TypeScript, Tailwind CSS, ESLint)
- **Recharts** for plotting wave elevation / statistics
- **Vitest** for testing, with two environments:
  - `node` — for pure logic (`src/lib/**`, `src/types/**`, `src/workers/**`)
  - `jsdom` — for component tests (`src/components/**`, `src/app/**`)

## Project Structure

```
wave-height-webapp/
├── src/
│   ├── app/                    # Next.js App Router pages/layout
│   ├── lib/                    # Pure logic: calibration, detection, pipeline, stats, CSV export
│   ├── workers/                # Web Worker for off-main-thread video processing
│   ├── components/             # React components
│   └── types/
│       └── wave.ts             # Shared TypeScript interfaces used across all phases
├── vitest.config.ts            # Dual-environment Vitest setup (node + jsdom)
└── vitest.setup.ts             # jest-dom matchers setup
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Testing

```bash
npm run test        # unit + component tests (Vitest), run once
npm run test:watch  # unit + component tests, watch mode
npm run test:e2e    # end-to-end (Playwright): builds, starts, and drives a real browser
```

`npm run test:e2e` regenerates its synthetic test video first (`pretest:e2e` runs
`scripts/generate-test-video.mjs`), then builds and starts the app in production mode
and runs `e2e/wave-analysis.spec.ts` against it — this is what actually verifies the
Web Worker still works correctly in a real production build (dev and prod bundle
workers differently). You can also generate a custom test video by hand:

```bash
npm run generate-test-video -- --amplitude-px 20 --period-s 1 --duration-s 8 \
  --fps 30 --width 320 --height 240 --output my-test-video.mp4
```

## Build & Lint

```bash
npm run build
npm run lint
```

## Deploying to Vercel

This is a standard Next.js app, so no `vercel.json` is required — Vercel auto-detects
the framework and build/output settings from `package.json`/`next.config.ts`.

Using the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npm i -g vercel

# first-time setup / preview deployment
vercel

# production deployment
vercel --prod
```
