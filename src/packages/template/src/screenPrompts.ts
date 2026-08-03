// Per-screen prompt registry. The DATA (per-screen model-facing `focus` + `suggestions`) lives in
// src/resources/prompts/screenPrompts.json; this module is the pure resolver over it:
//   exact sub-screen override  →  domain base (from the id's first segment, plural-normalized)  →  generic.
// No ai-system dependency. `focus` is English (folded into the agent prompt); `suggestions` are i18n t() keys
// (the English string doubles as the key, keySeparator:false, so a missing catalog entry renders English).
import screenPromptData from "@/resources/prompts/screenPrompts.json";

export interface ScreenPrompt {
  focus: string;
  suggestions: string[];
}

interface ScreenPromptData {
  generic: ScreenPrompt;
  domains: Record<string, ScreenPrompt>;
  overrides: Record<string, ScreenPrompt>;
  pluralToDomain: Record<string, string>;
}

const data = screenPromptData as ScreenPromptData;
const GENERIC = data.generic;
const DOMAIN = data.domains;
const OVERRIDES = data.overrides;
const PLURAL_TO_DOMAIN = data.pluralToDomain;

// The full set (generic + domains + overrides) — for tests and i18n key extraction.
export const SCREEN_PROMPT_ENTRIES: Record<string, ScreenPrompt> = {
  generic: GENERIC,
  ...DOMAIN,
  ...OVERRIDES,
};

function domainOf(id: string): string {
  const first = id.split(".")[0];
  return PLURAL_TO_DOMAIN[first] ?? first;
}

export function resolveScreenPrompt(id?: string): ScreenPrompt {
  if (!id) {
    return GENERIC;
  }
  return OVERRIDES[id] ?? DOMAIN[domainOf(id)] ?? GENERIC;
}

// Every user-facing suggestion string across the registry (deduped) — the i18n keys these prompts introduce.
export function allSuggestionKeys(): string[] {
  const set = new Set<string>();
  for (const entry of Object.values(SCREEN_PROMPT_ENTRIES)) {
    for (const s of entry.suggestions) {
      set.add(s);
    }
  }
  return [...set];
}
