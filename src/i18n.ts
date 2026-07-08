import i18next from "i18next";

import de from "./web-app/translations/de.json";
import en from "./web-app/translations/en.json";
import es from "./web-app/translations/es.json";
import fr from "./web-app/translations/fr.json";
import it from "./web-app/translations/it.json";
import ja from "./web-app/translations/ja.json";
import ko from "./web-app/translations/ko.json";
import ptBR from "./web-app/translations/pt-BR.json";
import ro from "./web-app/translations/ro.json";
import ru from "./web-app/translations/ru.json";
import zhCN from "./web-app/translations/zh-CN.json";

export const AUTO_LANGUAGE = "auto";
export const DEFAULT_LANGUAGE = "en";
export const TRANSLATIONS = ["en", "zh-CN", "es", "fr", "de", "ja", "pt-BR", "ru", "ko", "it", "ro"] as const;

export type SupportedLanguage = (typeof TRANSLATIONS)[number];
export type LanguagePreference = typeof AUTO_LANGUAGE | SupportedLanguage;

export const LANGUAGE_OPTIONS: { value: SupportedLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "中文（简体）" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ja", label: "日本語" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "ru", label: "Русский" },
  { value: "ko", label: "한국어" },
  { value: "it", label: "Italiano" },
  { value: "ro", label: "Română" },
];

const LANGUAGE_STORAGE_KEY = "containerDesktopLanguage";
const I18NEXT_STORAGE_KEY = "i18nextLng";
const LANGUAGE_RESOURCES: Record<SupportedLanguage, any> = {
  en,
  "zh-CN": zhCN,
  es,
  fr,
  de,
  ja,
  "pt-BR": ptBR,
  ru,
  ko,
  it,
  ro,
};

export const i18n = i18next;

interface I18nPlugin {
  type: string;
  init?: (instance: typeof i18next) => void;
}

const getLanguageStorage = () => {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis ? globalThis.localStorage : undefined;
};

const normalizeLocale = (language?: string | null) => language?.trim().replace("_", "-");

export const normalizeLanguagePreference = (language?: string | null): LanguagePreference => {
  const normalized = normalizeLocale(language);
  if (!normalized) {
    return AUTO_LANGUAGE;
  }
  if (normalized === AUTO_LANGUAGE) {
    return AUTO_LANGUAGE;
  }
  const exact = TRANSLATIONS.find((item) => item.toLowerCase() === normalized.toLowerCase());
  if (exact) {
    return exact;
  }
  const [base] = normalized.toLowerCase().split("-");
  if (base === "zh") {
    return "zh-CN";
  }
  if (base === "pt") {
    return "pt-BR";
  }
  return TRANSLATIONS.find((item) => item.toLowerCase() === base) ?? AUTO_LANGUAGE;
};

const getSystemLanguage = () => {
  if (typeof navigator !== "undefined") {
    const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
    return languages[0] || navigator.language;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

export const resolveLanguagePreference = (preference?: string | null): SupportedLanguage => {
  const normalized = normalizeLanguagePreference(preference);
  const resolved = normalized === AUTO_LANGUAGE ? normalizeLanguagePreference(getSystemLanguage()) : normalized;
  return resolved === AUTO_LANGUAGE ? DEFAULT_LANGUAGE : resolved;
};

export const getCurrentLanguagePreference = (): LanguagePreference => {
  const storage = getLanguageStorage();
  return normalizeLanguagePreference(storage?.getItem(LANGUAGE_STORAGE_KEY) ?? storage?.getItem(I18NEXT_STORAGE_KEY));
};

export const getCurrentLanguage = (): SupportedLanguage => {
  return resolveLanguagePreference(getCurrentLanguagePreference());
};

export const storeCurrentLanguage = (language: string) => {
  const preference = normalizeLanguagePreference(language);
  const resolved = resolveLanguagePreference(preference);
  const storage = getLanguageStorage();
  storage?.setItem(LANGUAGE_STORAGE_KEY, preference);
  storage?.setItem(I18NEXT_STORAGE_KEY, resolved);
};

export const setCurrentLanguagePreference = (language: string): LanguagePreference => {
  const preference = normalizeLanguagePreference(language);
  storeCurrentLanguage(preference);
  const resolved = resolveLanguagePreference(preference);
  if ((i18n as any).isInitialized) {
    void (i18n as any).changeLanguage(resolved);
  }
  return preference;
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
      resources: Object.fromEntries(
        TRANSLATIONS.map((language) => [
          language,
          {
            translation: LANGUAGE_RESOURCES[language],
          },
        ]),
      ),
      interpolation: {
        escapeValue: false,
      },
    });
  }
  return i18n;
};

export const t = (key: string, rest?: any): string => {
  const lng = getCurrentLanguage();
  if (rest && typeof rest === "object") {
    return (ensureI18nInitialized() as any).t(key, { ...rest, lng });
  }
  if (rest !== undefined) {
    return (ensureI18nInitialized() as any).t(key, rest, { lng });
  }
  return (ensureI18nInitialized() as any).t(key, { lng });
};

export default { t };
