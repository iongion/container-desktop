import { afterEach, describe, expect, it } from "vitest";

import {
  getCurrentLanguage,
  getCurrentLanguagePreference,
  i18n,
  normalizeLanguagePreference,
  setCurrentLanguagePreference,
  t,
} from "./index";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function installLanguageGlobals(language: string) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language, languages: [language] },
  });
}

afterEach(() => {
  delete (globalThis as any).localStorage;
  delete (globalThis as any).navigator;
  void (i18n as any).changeLanguage("en");
});

describe("i18n language preferences", () => {
  it("stores automatic as the preference and resolves it to the nearest supported language", () => {
    installLanguageGlobals("fr-BE");

    setCurrentLanguagePreference("auto");

    expect(getCurrentLanguagePreference()).toBe("auto");
    expect(getCurrentLanguage()).toBe("fr");
    expect(normalizeLanguagePreference("fr-BE")).toBe("fr");
    expect(t("Containers")).toBe("Conteneurs");
  });
});
