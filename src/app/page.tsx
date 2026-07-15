"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function HomePage() {
  const { t } = useLanguage();

  const modes = [
    { href: "/auto", title: t("home.autoTitle"), description: t("home.autoDescription") },
    { href: "/manual-mark", title: t("home.manualTitle"), description: t("home.manualDescription") },
    { href: "/batch", title: t("home.batchTitle"), description: t("home.batchDescription") },
  ];

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("home.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("home.subtitle")}</p>
        </header>

        <div className="flex flex-col gap-4">
          {modes.map((mode) => (
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
