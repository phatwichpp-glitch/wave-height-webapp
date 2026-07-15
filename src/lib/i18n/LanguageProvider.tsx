"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations } from "./translations";

export type Language = "en" | "th";

const LANGUAGE_STORAGE_KEY = "wave-height-webapp-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Looks up `key` in translations.ts, falling back to English then to the key itself (so a missing entry is visibly obvious instead of blank). `params` does simple {{name}} interpolation for dynamic values (e.g. a saved time/value). */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  // English is the default render on both server and client — this effect
  // only overrides it after mount if the user previously chose Thai, so
  // there's no hydration mismatch (server always renders "en").
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "en" || stored === "th") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a client-only external system (localStorage) after mount; a lazy useState initializer would cause a hydration mismatch instead (see comment above).
        setLanguageState(stored);
      }
    } catch {
      // Storage unavailable — just keep the English default.
    }
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Best-effort only.
    }
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const entry = translations[key];
    let text = entry ? entry[language] ?? entry.en : key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value));
      }
    }
    return text;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
