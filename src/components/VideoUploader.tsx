"use client";

import { useRef, useState } from "react";

interface VideoUploaderProps {
  onVideoLoaded: (videoUrl: string, file: File) => void;
}

export default function VideoUploader({ onVideoLoaded }: VideoUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previousUrlRef = useRef<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (previousUrlRef.current) {
      URL.revokeObjectURL(previousUrlRef.current);
    }

    const videoUrl = URL.createObjectURL(file);
    previousUrlRef.current = videoUrl;
    setPreviewUrl(videoUrl);
    onVideoLoaded(videoUrl, file);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900"
      />
      {previewUrl && (
        <video
          src={previewUrl}
          controls
          className="max-h-64 w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
      )}
    </div>
  );
}
