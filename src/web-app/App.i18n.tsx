import React, { useCallback, useContext, useEffect } from "react";
import { initReactI18next } from "react-i18next";

import {
  ensureI18nInitialized,
  getCurrentLanguage,
  i18n,
  LANGUAGE_OPTIONS,
  type LanguagePreference,
  setCurrentLanguagePreference,
  TRANSLATIONS,
  t as translate,
} from "@/i18n";

export { getCurrentLanguage, LANGUAGE_OPTIONS, TRANSLATIONS };

export const TRANSLATION_LANGUAGES = LANGUAGE_OPTIONS;

ensureI18nInitialized([initReactI18next]);

export interface II18nContext {
  currentLanguage: string;
  setCurrentLanguage: (language: LanguagePreference) => void;
}

export const I18nContext = React.createContext<II18nContext>({
  currentLanguage: (i18n as any).language,
  setCurrentLanguage: () => {},
});

export const I18nContextProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = React.useState<string>(getCurrentLanguage());
  useEffect(() => {
    const onLanguageChanged = (language: string) => setCurrentLanguage(language);
    (i18n as any).on?.("languageChanged", onLanguageChanged);
    return () => {
      (i18n as any).off?.("languageChanged", onLanguageChanged);
    };
  }, []);
  return (
    <I18nContext.Provider
      value={{
        currentLanguage,
        setCurrentLanguage: (lang: any) => {
          setCurrentLanguagePreference(lang);
          setCurrentLanguage(getCurrentLanguage());
        },
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useSetLocale = () => {
  const { setCurrentLanguage } = useContext(I18nContext);
  return useCallback((lang: LanguagePreference) => setCurrentLanguage(lang), [setCurrentLanguage]);
};

export const useGetLocale = () => {
  const { currentLanguage } = useContext(I18nContext);
  return useCallback(() => currentLanguage, [currentLanguage]);
};

export const useTranslate = () => {
  const { currentLanguage } = useContext(I18nContext);
  return {
    t: (key: string, rest?: any) => (i18n as any).t(key, rest, { lng: currentLanguage }),
    currentLanguage,
    i18n,
  };
};

export const t = translate;

export default { t };
