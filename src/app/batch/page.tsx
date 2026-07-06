"use client";

import Link from "next/link";
import BatchPanel from "@/components/BatchPanel";

export default function BatchPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Batch Processing
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Process multiple videos sequentially from a JSON config, then download all
            results as one ZIP.
          </p>
          <Link
            href="/"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            ← Back to single-video analysis
          </Link>
        </header>

        <BatchPanel />
      </main>
    </div>
  );
}
