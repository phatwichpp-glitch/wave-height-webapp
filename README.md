# Wave Height Web App

A browser-based tool for analyzing water wave height from video, entirely client-side
(no server upload needed — video processing runs in the browser, optionally offloaded
to a Web Worker). This is a Next.js companion to the Python `wave_height_analyzer`
CLI/library, aimed at giving the same calibration → surface detection → statistics
pipeline a shareable web UI.

> Under active development. Functionality is being built out in phases; this scaffold
> currently has the project structure, shared types, and test setup in place.

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
npm run test        # run all tests once
npm run test:watch  # watch mode
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
