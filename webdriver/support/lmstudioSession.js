// Starting a live session on the LM Studio server running on THIS machine, the way the app does — and keyless, which
// is the difference that matters: no OPENROUTER_API_KEY, no cloud, no network. The host still writes the gateway's
// env file (the app always names its provider), and a vault with nothing stored for a keyless provider substitutes an
// empty key, which is exactly what a local server wants.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROVIDER = "lmstudio";
export const LM_STUDIO_BASE_URL = process.env.CD_LIVE_LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1";

function settingsFile() {
  const userData =
    process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
  return path.join(userData, "user-settings.json");
}

// Merged, never clobbered: the harness pre-seeds `ai.workspaceRoot` in this same file, and the host re-reads it on
// every getAISettings, so the file IS the authority.
export function configureLmStudioProvider(model) {
  const file = settingsFile();
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.ai = {
    ...settings.ai,
    defaultProvider: PROVIDER,
    providers: {
      ...settings.ai?.providers,
      [PROVIDER]: { model, baseURL: LM_STUDIO_BASE_URL, enabled: true, auth: { scheme: "none" } },
    },
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// What the app's own composer builds for this provider (`screens/AI/startSession.ts`): the provider is NAMED even
// though it is keyless, because that is what asks the host to write the gateway's env file at all.
export function lmStudioStartOptions({ connectionId, workspacePath, model, appVersion = "6.0.0" }) {
  return {
    connectionId,
    workspacePath,
    modelId: model,
    providerId: PROVIDER,
    providerKind: "local",
    upstreamAuth: { scheme: "none" },
    upstreamBaseUrl: LM_STUDIO_BASE_URL,
    appVersion,
    egress: true,
  };
}

// What the server itself says it loaded, asked the same way the app's probe asks. A model loaded at less than the
// session's own prompt costs cannot answer a turn, and knowing that BEFORE the run is what tells a real failure
// from a model nobody gave room to.
// A server that is not running answers by refusing the connection, which `fetch` raises rather than returns — so
// that is caught too: "nothing is loaded" is the same answer for the caller, and a naked TypeError here would
// otherwise surface as a harness fault instead of the absent server it is.
export async function loadedContextLength(model) {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL.replace(/\/v\d+\/?$/, "")}/api/v0/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const entry = (await response.json()).data?.find((item) => item.id === model);
    return entry?.loaded_context_length;
  } catch {
    return undefined;
  }
}
