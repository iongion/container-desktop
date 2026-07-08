import React, { useCallback, useContext } from "react";
import { initReactI18next } from "react-i18next";

import {
  ensureI18nInitialized,
  getCurrentLanguage,
  i18n,
  storeCurrentLanguage,
  TRANSLATIONS,
  t as translate,
} from "@/i18n";
import { Languages } from "@/web-app/App.resources";

export { getCurrentLanguage, TRANSLATIONS };

export const TRANSLATION_LANGUAGES = Languages.filter((it) => TRANSLATIONS.includes(it["639-1"]));

ensureI18nInitialized([initReactI18next]);

export interface II18nContext {
  currentLanguage: string;
  setCurrentLanguage: React.Dispatch<React.SetStateAction<string>>;
}

export const I18nContext = React.createContext<II18nContext>({
  currentLanguage: (i18n as any).language,
  setCurrentLanguage: () => {},
});

export const I18nContextProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = React.useState((i18n as any).language);
  return (
    <I18nContext.Provider
      value={{
        currentLanguage,
        setCurrentLanguage: (lang: any) => {
          storeCurrentLanguage(lang);
          (i18n as any).changeLanguage(lang);
          setCurrentLanguage(lang);
        },
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useSetLocale = () => {
  const { setCurrentLanguage } = useContext(I18nContext);
  return useCallback((lang: string) => setCurrentLanguage(lang), [setCurrentLanguage]);
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
