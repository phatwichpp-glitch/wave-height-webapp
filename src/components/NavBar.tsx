"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function NavBar() {
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();

  const navLinks = [
    { href: "/", label: t("nav.home") },
    { href: "/auto", label: t("nav.auto") },
    { href: "/manual-mark", label: t("nav.manual") },
    { href: "/batch", label: t("nav.batch") },
  ];

  return (
    <nav className="flex justify-center border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex w-full max-w-3xl items-center justify-between gap-1 px-6 py-3">
        <div className="flex gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div
          className="flex items-center gap-0.5 rounded-full border border-zinc-300 p-0.5 text-xs font-medium dark:border-zinc-700"
          role="group"
          aria-label={t("nav.language")}
        >
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`rounded-full px-2.5 py-1 transition ${
              language === "en"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLanguage("th")}
            className={`rounded-full px-2.5 py-1 transition ${
              language === "th"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            ไทย
          </button>
        </div>
      </div>
    </nav>
  );
}
