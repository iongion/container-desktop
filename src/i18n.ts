import i18next from "i18next";

import en from "./web-app/translations/en.json";

export const DEFAULT_LANGUAGE = "en";
export const TRANSLATIONS = ["en", "ro"];

export const i18n = i18next;

interface I18nPlugin {
  type: string;
  init?: (instance: typeof i18next) => void;
}

const getLanguageStorage = () => {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis ? globalThis.localStorage : undefined;
};

export const getCurrentLanguage = () => {
  const storedLanguage = getLanguageStorage()?.getItem("i18nextLng");
  if (!storedLanguage) {
    return (i18n as any).language || DEFAULT_LANGUAGE;
  }
  return storedLanguage;
};

export const storeCurrentLanguage = (language: string) => {
  getLanguageStorage()?.setItem("i18nextLng", language);
};

export const registerI18nPlugin = (plugin: I18nPlugin) => {
  if (!(i18n as any).modules?.external?.includes(plugin)) {
    (i18n as any).use(plugin);
  }
  if ((i18n as any).isInitialized && typeof (plugin as any).init === "function") {
    (plugin as any).init(i18n);
  }
};

export const ensureI18nInitialized = (plugins: I18nPlugin[] = []) => {
  for (const plugin of plugins) {
    registerI18nPlugin(plugin);
  }
  if (!(i18n as any).isInitialized) {
    (i18n as any).init({
      debug: false,
      returnNull: false,
      initImmediate: false,
      preload: [],
      fallbackLng: DEFAULT_LANGUAGE,
      lng: getCurrentLanguage(),
      keySeparator: false,
      resources: {
        en: {
          translation: en,
        },
      },
      interpolation: {
        escapeValue: false,
      },
    });
  }
  return i18n;
};

export const t = (key: string, rest?: any): string =>
  (ensureI18nInitialized() as any).t(key, rest, { lng: getCurrentLanguage() });

export default { t };
