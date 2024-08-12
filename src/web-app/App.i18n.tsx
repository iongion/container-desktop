import i18n from "i18next";
import React, { useCallback, useContext } from "react";
import { initReactI18next } from "react-i18next";
//
import { DEFAULT_LANGUAGE } from "@/web-app/App.config";
import { Languages } from "@/web-app/App.resources";
import en from "./translations/en.json";

// module

export const TRANSLATIONS = ["en", "ro"];
export const TRANSLATION_LANGUAGES = Languages.filter((it) => TRANSLATIONS.includes(it["639-1"]));

export const getCurrentLanguage = () => {
  const storedLanguage = localStorage.getItem("i18nextLng");
  if (!storedLanguage) {
    return (i18n as any).language || DEFAULT_LANGUAGE;
  }
  return storedLanguage;
};

// eslint-disable-next-line
(i18n as any)
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    debug: false,
    returnNull: false,
    initImmediate: false,
    preload: [],
    fallbackLng: DEFAULT_LANGUAGE,
    lng: getCurrentLanguage(),
    // ns: ["translations"],
    // defaultNS: "translations",
    keySeparator: false, // we use content as keys
    resources: {
      en: {
        translation: en
      }
    },
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;

export interface II18nContext {
  currentLanguage: string;
  setCurrentLanguage: React.Dispatch<React.SetStateAction<string>>;
}

export const I18nContext = React.createContext<II18nContext>({
  currentLanguage: (i18n as any).language,
  setCurrentLanguage: () => {}
});

export const I18nContextProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = React.useState((i18n as any).language);
  return (
    <I18nContext.Provider
      value={{
        currentLanguage,
        setCurrentLanguage: (lang: any) => {
          console.debug("Changing locale to", lang);
          localStorage.setItem("i18nextLng", lang);
          (i18n as any).changeLanguage(lang);
          setCurrentLanguage(lang);
        }
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
    i18n
  };
};
