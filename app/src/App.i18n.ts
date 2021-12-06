import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    debug: false,
    fallbackLng: "en",
    lng: "en",
    resources: {
      en: {
        translation: {
          containersCount: "There are no containers running",
          containersCount_0: "There are no containers running",
          containersCount_one: "There is {{count}} container running",
          containersCount_other: "There are {{count}} containers running"
        }
      }
    },
    interpolation: {
      escapeValue: false
    }
  });
