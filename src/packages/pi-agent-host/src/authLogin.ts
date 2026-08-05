// Runs pi's OWN provider login flow, in the one realm that can: pi loads each flow through a variable specifier
// precisely so a bundler cannot follow it into `node:http` callback servers and `node:crypto` PKCE, which is why the
// web view can browse pi's catalogue but can never sign in against it.
//
// Nothing about the flow is reimplemented here. `provider.auth.oauth.login()` is called with an `AuthInteraction`
// whose prompts and notifications are the bridge's own frames, so what the user answers is what pi asked for — the
// select, the secret, and the manual paste it races its loopback callback against.

import type { AuthInteraction, AuthPrompt, OAuthAuth, ProviderAuth } from "@earendil-works/pi-ai";

import { createLogger } from "@/logger";
import {
  type AttachedBridgeConnection,
  attachBridgeChannel,
  type BridgeConnection,
} from "@/pi-agent-host/bridgeChannel";
import type { BridgeCommand, BridgeEvent, PiAuthEvent, PiAuthLoginOutcome, PiAuthPrompt } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

const logger = createLogger("pi-agent-host.authLogin");

// Just enough of pi's `Provider` to find one and read its login flow. Narrowed so the runner can be driven in a test
// without constructing a provider, and so nothing here depends on pi's model machinery.
export interface LoginCapableProvider {
  id: string;
  name: string;
  auth?: ProviderAuth;
}

export interface ProviderLoginRunner {
  // One login, start to finish. Answers with a value rather than throwing: "the user closed it" and "the provider
  // refused" are both outcomes the app renders, not faults.
  login(providerId: string): Promise<PiAuthLoginOutcome>;
  answerPrompt(promptId: string, ok: boolean, value?: string): void;
  // Abandon the running login. pi's flows watch `interaction.signal` and tear their callback server down on it.
  cancel(): void;
}

function toProtocolPrompt(prompt: AuthPrompt): PiAuthPrompt {
  if (prompt.type === "select") {
    return {
      type: "select",
      message: prompt.message,
      options: prompt.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    };
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
  };
}

// pi's AuthEvent, with its readonly links copied so the frame is a plain value. The union is carried whole: the app
// opens an `auth_url`, shows a `device_code`'s user code, and prints the rest — none of which it could do from prose.
function toProtocolEvent(event: Parameters<AuthInteraction["notify"]>[0]): PiAuthEvent {
  if (event.type === "info") {
    return {
      type: "info",
      message: event.message,
      ...(event.links
        ? { links: event.links.map((link) => ({ url: link.url, ...(link.label ? { label: link.label } : {}) })) }
        : {}),
    };
  }
  return { ...event };
}

function oauthFlow(provider: LoginCapableProvider | undefined, providerId: string): OAuthAuth {
  if (!provider) throw new Error(`pi ships no provider called ${providerId}`);
  const flow = provider.auth?.oauth;
  if (!flow) throw new Error(`${provider.name} has no sign-in flow`);
  return flow;
}

export function createProviderLoginRunner(options: {
  emit: (event: BridgeEvent) => void;
  // Injected so the runner is testable without pi, and so the container's own resolution stays one line.
  findProvider: (providerId: string) => LoginCapableProvider | undefined;
}): ProviderLoginRunner {
  const { emit, findProvider } = options;
  const pending = new Map<string, { settle: (value: string) => void; fail: (error: Error) => void }>();
  let abort: AbortController | undefined;

  const closePrompt = (promptId: string) => {
    if (!pending.delete(promptId)) return;
    emit({ type: "auth_prompt_closed", promptId });
  };

  const ask = (prompt: AuthPrompt): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const promptId = randomUUID();
      pending.set(promptId, { settle: resolve, fail: reject });
      // pi cancels a prompt out of band — the manual-paste one dies the moment its loopback callback wins the race.
      // The app is told, or it goes on asking for a code the login has already stopped needing.
      prompt.signal?.addEventListener(
        "abort",
        () => {
          closePrompt(promptId);
          reject(new Error("prompt cancelled"));
        },
        { once: true },
      );
      emit({ type: "auth_prompt", promptId, prompt: toProtocolPrompt(prompt) });
    });

  return {
    async login(providerId): Promise<PiAuthLoginOutcome> {
      if (abort) return { ok: false, error: "a sign-in is already running" };
      const controller = new AbortController();
      abort = controller;
      const interaction: AuthInteraction = {
        signal: controller.signal,
        prompt: ask,
        notify: (event) => emit({ type: "auth_event", event: toProtocolEvent(event) }),
      };
      try {
        const flow = oauthFlow(findProvider(providerId), providerId);
        const credential = await flow.login(interaction);
        // Only the three fields one static secret can carry. pi's own credential may hold provider extras through
        // its index signature, and half a credential in the keychain would be worse than none.
        return {
          ok: true,
          credential: { access: credential.access, refresh: credential.refresh, expires: credential.expires },
        };
      } catch (error) {
        logger.debug(`sign-in to ${providerId} did not complete`, error);
        return { ok: false, error: (error as Error).message || "the sign-in did not complete" };
      } finally {
        abort = undefined;
        for (const promptId of [...pending.keys()]) closePrompt(promptId);
      }
    },

    answerPrompt(promptId, ok, value) {
      const waiting = pending.get(promptId);
      if (!waiting) return;
      pending.delete(promptId);
      // pi documents a prompt as rejecting on cancel, and its flows rely on it: OpenRouter's manual prompt failing is
      // what hands the login back to the callback server.
      if (ok) waiting.settle(value ?? "");
      else waiting.fail(new Error("cancelled"));
    },

    cancel() {
      abort?.abort(new Error("cancelled"));
    },
  };
}

// The login container's whole conversation. No session on this socket — nothing is mounted, no model is registered
// and no turn can be taken — so the only commands it answers are the three a login needs, and everything else is
// refused by name rather than half-served.
export function attachLoginConnection(
  connection: BridgeConnection,
  options: { token: string; findProvider: (providerId: string) => LoginCapableProvider | undefined },
): AttachedBridgeConnection {
  let runner: ProviderLoginRunner | undefined;
  const channel = attachBridgeChannel(connection, {
    token: options.token,
    dispatch: async (command: BridgeCommand): Promise<unknown> => {
      switch (command.type) {
        case "auth_login":
          return runner?.login(command.provider);
        case "auth_prompt_answer":
          runner?.answerPrompt(command.promptId, command.ok, command.value);
          return;
        case "auth_cancel":
          runner?.cancel();
          return;
        default:
          throw new Error(`this container only performs a provider sign-in, not ${command.type}`);
      }
    },
  });
  runner = createProviderLoginRunner({ emit: channel.emit, findProvider: options.findProvider });
  return channel;
}
