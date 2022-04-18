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
          containersRunning: "There are no running containers",
          containersRunning_0: "There are no running containers",
          containersRunning_one: "There is {{count}} running container",
          containersRunning_other: "There are {{count}} running containers",
        }
      }
    },
    interpolation: {
      escapeValue: false
    }
  });
