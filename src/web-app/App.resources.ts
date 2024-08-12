import DefinedLanguages from "./assets/languages.json";

export interface Language {
  "639-1": string;
  "639-2": string;
  family: string;
  name: string;
  nativeName: string;
  "639-2/B"?: string;
}

export const Languages: Language[] = DefinedLanguages.sort((a, b) => a.name.localeCompare(b.name));
