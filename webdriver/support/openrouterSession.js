// Starting a live session on OpenRouter the way the APP does: the key goes into the OS keychain, the provider is
// configured in settings, and `start` is handed a provider ID and no credential at all.
//
// Why this exists: the live specs used to pass `upstreamApiKey` straight into the session spec, which was the second
// producer of a credential-bearing gateway env file and the only reason a key could travel through the renderer at
// all. That field is gone. Naming the provider is now the only way to ask for a credential — the HOST resolves it and
// composes the gateway's env file from the vault — so a spec that wants a real model has to do what a user does.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROVIDER = "openrouter";
const BASE_URL = "https://openrouter.ai/api/v1";

function settingsFile() {
  const userData =
    process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
  return path.join(userData, "user-settings.json");
}

// Written from NODE rather than through a bridge call: there is no settings writer on `window.AI`, and the host reads
// user-settings.json fresh on every `getAISettings`, so the file IS the authority. Merged, never clobbered — the
// harness pre-seeded `ai.workspaceRoot` in the same file and a session started off it needs that folder to survive.
function configureProvider(model) {
  const file = settingsFile();
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.ai = {
    ...settings.ai,
    defaultProvider: PROVIDER,
    providers: {
      ...settings.ai?.providers,
      // The kind and the auth scheme come from the CATALOGUE entry for this id, resolved host-side; what settings
      // supply is the endpoint, the model and the credential shape.
      [PROVIDER]: { model, baseURL: BASE_URL, auth: { scheme: "bearer" } },
    },
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// `allowDegraded` on purpose: a headless session may have no unlocked keyring, and the vault then refuses outright. A
// spec that cannot store a key cannot drive a keyed provider, so it accepts the vault's degraded mode — the same
// choice the app offers a user whose keyring is unavailable. The key never travels back out.
export async function seedOpenRouterProvider(browser, { model }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required: this spec drives a real model");
  configureProvider(model);
  const stored = await browser.executeAsync(
    (provider, apiKey, done) => {
      window.AI.setKey(provider, apiKey, { allowDegraded: true })
        .then(() => window.AI.hasKey(provider))
        // Never `error`: a returned key by that name is read as a W3C error response and thrown.
        .then((held) => done({ ok: held === true, reason: held ? "" : "the vault did not keep the key" }))
        .catch((failure) => done({ ok: false, reason: String(failure) }));
    },
    PROVIDER,
    key,
  );
  if (!stored.ok) throw new Error(`the OpenRouter key could not be stored: ${stored.reason}`);
}

// The options a live session starts with once the key is in the keychain. No credential: `providerId` is what makes
// the host write the gateway's env file from the vault.
export function openRouterStartOptions({ connectionId, workspacePath, model, appVersion = "6.0.0" }) {
  return {
    connectionId,
    workspacePath,
    modelId: model,
    providerId: PROVIDER,
    providerKind: "openai-compatible",
    upstreamAuth: { scheme: "bearer" },
    upstreamBaseUrl: BASE_URL,
    appVersion,
  };
}
