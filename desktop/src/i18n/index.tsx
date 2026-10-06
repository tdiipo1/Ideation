import { createContext, useContext, useMemo, type ReactNode } from "react";
import { MESSAGES, type Locale } from "./messages";

export type { Locale };

/** Pick the UI locale from the `ui_language` setting ("auto" = system language). */
export function resolveLocale(setting: string | null | undefined): Locale {
  const source = setting && setting !== "auto" ? setting : navigator.language || "en";
  const two = source.slice(0, 2).toLowerCase();
  if (two === "es") return "es";
  if (two === "zh") return "zh";
  return "en";
}

export function translate(
  locale: Locale,
  key: string,
  subs?: ReadonlyArray<string | number>,
): string {
  const msg = MESSAGES[locale][key] ?? MESSAGES.en[key];
  if (msg === undefined) return key;
  if (!subs) return msg;
  return msg.replace(/\$(\d)/g, (_, i: string) => String(subs[Number(i) - 1] ?? ""));
}

export type TFn = (key: string, subs?: ReadonlyArray<string | number>) => string;

const I18nContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

/** Translation function bound to the current UI locale. */
export function useT(): TFn {
  const locale = useContext(I18nContext);
  return useMemo<TFn>(() => (key, subs) => translate(locale, key, subs), [locale]);
}

/** Name of the custom DOM event Settings dispatches when the UI language changes. */
export const UI_LANGUAGE_EVENT = "ideation:ui-language";
