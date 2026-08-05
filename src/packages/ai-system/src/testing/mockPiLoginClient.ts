// A scripted stand-in for the one-shot login container, used when CONTAINER_DESKTOP_MOCK is on. It implements the same
// `PiLoginClient` the real sign-in uses and emits the same frames pi's OpenRouter flow raises, in pi's own order:
// a progress line while the callback server listens, the authorization URL, then the manual-paste prompt it races that
// callback against. So the renderer runs its production path — the link, the paste, the keychain write — with no
// engine, no container and no provider.
//
// Only the far end of the socket is replaced. What the app does with a permanent key is exactly what it does with a
// real one, which is why `loginCredentialVerdict` is left to judge the credential rather than being told the answer.

import type { PiLoginClient, PiLoginEvent } from "@/ai-system/adapters/piLoginClient";
import type { PiAuthLoginOutcome, PiAuthRefreshOutcome } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

const AUTHORIZE_URL = "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A41999%2Foauth%2Fcallback";

// What a real exchange answers with: OpenRouter hands back a permanent, user-controlled key rather than a token pair.
const MOCK_KEY = "sk-or-v1-mock-0123456789abcdef";

// pi's own `parseAuthorizationInput`, in pi's own order: a full redirect URL yields its `code` parameter, a bare
// query string is read as one, and anything else IS the code — a user who pasted only the code pasted the code.
// So the only paste pi refuses is one that resolves to nothing, e.g. a redirect whose `code` came back empty.
function authorizationCode(input: string | undefined): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  try {
    return new URL(value).searchParams.get("code") ?? undefined;
  } catch {
    // not a URL
  }
  if (value.includes("code=")) return new URLSearchParams(value).get("code") ?? undefined;
  return value;
}

export function createMockPiLoginClient(): PiLoginClient {
  const listeners = new Set<(event: PiLoginEvent) => void>();
  let settle: ((outcome: PiAuthLoginOutcome) => void) | undefined;
  let promptId: string | undefined;

  const emit = (event: PiLoginEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  return {
    async connect() {},

    login(): Promise<PiAuthLoginOutcome> {
      return new Promise<PiAuthLoginOutcome>((resolve) => {
        settle = resolve;
        promptId = randomUUID();
        emit({
          type: "auth_event",
          event: { type: "progress", message: "Listening for OpenRouter OAuth callback on http://127.0.0.1:41999" },
        });
        emit({
          type: "auth_event",
          event: {
            type: "auth_url",
            url: AUTHORIZE_URL,
            instructions:
              "Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
          },
        });
        emit({
          type: "auth_prompt",
          promptId,
          prompt: {
            type: "manual_code",
            message: "Complete sign-in in your browser, or paste the authorization code / redirect URL here:",
            placeholder: "http://127.0.0.1:41999/oauth/callback",
          },
        });
      });
    },

    // The real container reads the credential out of its own env and rotates only what needs it. Mock mode's sign-in
    // returns a permanent key, so `unchanged` is the honest answer — the same one the real container gives for a key.
    async refresh(): Promise<PiAuthRefreshOutcome> {
      return { ok: true, unchanged: true };
    },

    answerPrompt(id, ok, value) {
      if (id !== promptId || !settle) return;
      const resolve = settle;
      settle = undefined;
      promptId = undefined;
      if (!ok) {
        resolve({ ok: false, error: "cancelled" });
        return;
      }
      const code = authorizationCode(value);
      if (!code) {
        resolve({ ok: false, error: "Missing authorization code" });
        return;
      }
      emit({ type: "auth_prompt_closed", promptId: id });
      emit({
        type: "auth_event",
        event: { type: "progress", message: "Exchanging authorization code for an API key" },
      });
      resolve({ ok: true, credential: { access: MOCK_KEY, refresh: "", expires: Number.MAX_SAFE_INTEGER } });
    },

    cancel() {
      const resolve = settle;
      settle = undefined;
      resolve?.({ ok: false, error: "cancelled" });
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      listeners.clear();
    },
  };
}
