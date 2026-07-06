#!/usr/bin/env node
/**
 * Generates a synthetic test video with a horizontal air/water edge that
 * oscillates as a sine wave, for exercising the wave-height-webapp pipeline
 * end-to-end (Playwright tests) without needing a real recorded video.
 *
 * Frames are rendered with @napi-rs/canvas, which ships prebuilt native
 * binaries for every platform — unlike the older "canvas" (node-canvas)
 * package, it needs no Cairo/system build tools, which matters most on
 * Windows where node-gyp compilation is often the thing that breaks.
 *
 * Encoding raw frames into an actual .mp4 in pure JavaScript would be a large
 * undertaking on its own, so instead this pipes PNG frames into the prebuilt
 * ffmpeg binary from "ffmpeg-static" (no system-wide ffmpeg install needed).
 * If that binary isn't available for some reason on the current platform, or
 * the encode fails, this falls back to writing a PNG sequence to disk plus
 * printing the ffmpeg command needed to assemble it by hand.
 *
 * Usage:
 *   node scripts/generate-test-video.mjs --amplitude-px 20 --period-s 2 \
 *     --duration-s 8 --fps 30 --width 320 --height 240 \
 *     --output e2e/fixtures/synthetic-wave.mp4
 */

import { createCanvas } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "amplitude-px": { type: "string", default: "20" },
    "period-s": { type: "string", default: "2" },
    "duration-s": { type: "string", default: "8" },
    fps: { type: "string", default: "30" },
    width: { type: "string", default: "320" },
    height: { type: "string", default: "240" },
    output: { type: "string", default: "e2e/fixtures/synthetic-wave.mp4" },
  },
});

const amplitudePx = parseFloat(values["amplitude-px"]);
const periodS = parseFloat(values["period-s"]);
const durationS = parseFloat(values["duration-s"]);
const fps = parseFloat(values.fps);
const width = parseInt(values.width, 10);
const height = parseInt(values.height, 10);
const output = values.output;

const AIR_COLOR = "rgb(210, 210, 210)";
const WATER_COLOR = "rgb(70, 70, 70)";

function edgeYForFrame(frameIndex) {
  const t = frameIndex / fps;
  const baselineY = height / 2;
  const edgeY = Math.round(baselineY - amplitudePx * Math.sin((2 * Math.PI * t) / periodS));
  return Math.max(0, Math.min(height, edgeY));
}

function drawFrame(ctx, edgeY) {
  ctx.fillStyle = AIR_COLOR;
  ctx.fillRect(0, 0, width, edgeY);
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, edgeY, width, height - edgeY);
}

async function encodeWithFfmpeg(canvas, ctx, nFrames) {
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const ffmpeg = spawn(ffmpegPath, [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-i",
    "-",
    "-pix_fmt",
    "yuv420p",
    "-vcodec",
    "libx264",
    output,
  ]);

  let ffmpegStderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    ffmpegStderr += chunk.toString();
  });

  const ffmpegDone = new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}\n${ffmpegStderr}`));
      }
    });
    ffmpeg.on("error", reject);
  });

  for (let i = 0; i < nFrames; i++) {
    drawFrame(ctx, edgeYForFrame(i));
    const buffer = canvas.toBuffer("image/png");
    const canWriteMore = ffmpeg.stdin.write(buffer);
    if (!canWriteMore) {
      await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
  }

  ffmpeg.stdin.end();
  await ffmpegDone;
}

function writePngFallback(canvas, ctx, nFrames) {
  const outputDir = output.replace(/\.[^/.]+$/, "") + "_frames";
  fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < nFrames; i++) {
    drawFrame(ctx, edgeYForFrame(i));
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(path.join(outputDir, `frame_${String(i).padStart(5, "0")}.png`), buffer);
  }

  console.log(`Wrote ${nFrames} PNG frame(s) to ${outputDir}`);
  console.log("Assemble them into a video yourself with:");
  console.log(
    `  ffmpeg -y -framerate ${fps} -i "${outputDir}/frame_%05d.png" -pix_fmt yuv420p "${output}"`
  );
}

async function main() {
  const nFrames = Math.round(durationS * fps);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (!ffmpegPath) {
    console.warn("ffmpeg-static has no binary for this platform; falling back to PNG frames.");
    writePngFallback(canvas, ctx, nFrames);
    return;
  }

  try {
    await encodeWithFfmpeg(canvas, ctx, nFrames);
    console.log(`Wrote ${nFrames} frame(s) to ${output}`);
  } catch (err) {
    console.warn(`ffmpeg encoding failed (${err.message}); falling back to PNG frames.`);
    writePngFallback(canvas, ctx, nFrames);
    return;
  }

  console.log(
    `amplitude=${amplitudePx}px, period=${periodS}s, duration=${durationS}s, ` +
      `fps=${fps}, size=${width}x${height}`
  );
}

main().catch((err) => {
  console.error("Failed to generate test video:", err);
  process.exitCode = 1;
});
