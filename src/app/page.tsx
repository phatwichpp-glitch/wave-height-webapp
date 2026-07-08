import Link from "next/link";

const MODES = [
  {
    href: "/auto",
    title: "Auto Detection",
    description:
      "Upload a video, calibrate against a ruler, and let the app automatically track the water surface and compute wave height statistics.",
  },
  {
    href: "/manual-mark",
    title: "Manual Annotation",
    description:
      "Read a ruler by eye and type values in as you watch the video — no pixel calibration needed. Useful for footage the automatic detector struggles with.",
  },
  {
    href: "/batch",
    title: "Batch Processing",
    description:
      "Process multiple videos sequentially from a JSON config, then download all results as one ZIP.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Wave Height Analyzer
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Analyze wave height from a video, entirely in your browser.
          </p>
        </header>

        <div className="flex flex-col gap-4">
          {MODES.map((mode) => (
            <Link
              key={mode.href}
              href={mode.href}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                {mode.title}
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {mode.description}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
