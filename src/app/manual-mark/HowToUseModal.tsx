"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

interface HowToUseModalProps {
  onClose: () => void;
}

export default function HowToUseModal({ onClose }: HowToUseModalProps) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("manualMark.howToUseTitle")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("manualMark.howToUseTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.howToUseStep1Title")}
            </h3>
            <p>{t("manualMark.howToUseStep1Body")}</p>
          </div>
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.howToUseStep2Title")}
            </h3>
            <p>{t("manualMark.howToUseStep2Body")}</p>
          </div>
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.howToUseStep3Title")}
            </h3>
            <p>{t("manualMark.howToUseStep3Body")}</p>
          </div>
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.howToUseStep4Title")}
            </h3>
            <p>{t("manualMark.howToUseStep4Body")}</p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t("manualMark.howToUseShortcutsTitle")}
            </h3>
            <ul className="mt-1 flex flex-col gap-1">
              <li className="flex justify-between">
                <span>{t("manualMark.crest")}</span>
                <kbd className="font-mono">C</kbd>
              </li>
              <li className="flex justify-between">
                <span>{t("manualMark.trough")}</span>
                <kbd className="font-mono">T</kbd>
              </li>
              <li className="flex justify-between">
                <span>{t("manualMark.shortcutFineStep")}</span>
                <kbd className="font-mono">← →</kbd>
              </li>
              <li className="flex justify-between">
                <span>{t("manualMark.shortcutPlayPause")}</span>
                <kbd className="font-mono">Space</kbd>
              </li>
              <li className="flex justify-between">
                <span>{t("manualMark.undo")}</span>
                <kbd className="font-mono">Ctrl+Z</kbd>
              </li>
            </ul>
          </div>

          <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {t("manualMark.howToUseTip")}
          </p>
        </div>
      </div>
    </div>
  );
}
