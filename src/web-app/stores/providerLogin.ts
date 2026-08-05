// One provider sign-in, start to finish: a one-shot container, pi's own flow inside it, and the key it produces
// written to the OS keychain — the same slot a typed key goes to, so everything downstream is unchanged.
//
// It is its own store rather than part of the coding-agent one because it runs BEFORE a session can exist: signing in
// is how a provider gets the credential a session needs, so it can neither borrow the session's container nor its
// socket. The container it starts mounts nothing and is removed on every path out of here.

import { create } from "zustand";
import { pickHostPort } from "@/ai-system/adapters/piAgentContainer";
import { createPiLoginClient, type PiLoginClient } from "@/ai-system/adapters/piLoginClient";
import {
  PI_BRIDGE_PORT_IN_IMAGE,
  type PiLoginContainerSpec,
  removePiLoginContainer,
  startPiLoginContainer,
} from "@/ai-system/adapters/piLoginContainer";
import { loginCredentialVerdict, providerLoginOffer } from "@/ai-system/core/piAuth";
import { isMockMode } from "@/container-client/mock/mode";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";
import { agentImageTag } from "@/pi-bridge/image";
import { piProviderIdFor } from "@/pi-bridge/modelBaseline";
import type { PiAuthPrompt } from "@/pi-bridge/protocol";
import { encodeProviderCredential } from "@/pi-bridge/providerCredential";
import { randomUUID } from "@/utils/randomUUID";
import { connectedConnections, pickActiveConnection } from "@/web-app/components/ConnectionSelect.logic";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { PROJECT_VERSION } from "@/web-app/Environment";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

const logger = createLogger("ai.providerLogin");

export type ProviderLoginStatus = "idle" | "starting" | "waiting" | "stored" | "refused" | "error";

// What the sign-in produced. `stored: false` is never a fault: the user closed it, or the provider answered with a
// credential this app cannot keep, and both are things to say plainly.
export type ProviderLoginResult = { stored: true } | { stored: false; reason: string };

// What a rotation attempt did. `refreshed: false` with no reason is the ordinary case — a permanent key, or a token
// with life left. `mustSignInAgain` is the one the caller has to surface: the refresh token is spent.
export interface ProviderRefreshResult {
  refreshed: boolean;
  reason?: string;
  mustSignInAgain?: boolean;
  // When the credential in the vault lapses, so a running session can schedule the next rotation rather than poll.
  // Absent for a permanent key.
  expiresAt?: number;
  // The access token a rotation produced, for a caller that has to hand it to a gateway already running. Present
  // ONLY on a rotation, and never read back out of the vault — this is the same exposure the sign-in itself has.
  accessToken?: string;
}

export interface ProviderLoginState {
  status: ProviderLoginStatus;
  // The app's provider id being signed into, while one is running.
  providerId?: string;
  // pi's own label for the flow, so the UI never has to invent one.
  label?: string;
  // pi's progress and info lines, in the order the flow raised them.
  log: string[];
  // The URL the user has to open, published by pi's flow. Rendered as a link, which the shell sends to the browser.
  authUrl?: string;
  authInstructions?: string;
  // pi's device-code flows show a code to type on the provider's site instead of a redirect.
  deviceCode?: { userCode: string; verificationUri: string };
  // The question the flow is blocked on. One at a time — pi's flows never raise two.
  prompt?: { promptId: string; prompt: PiAuthPrompt };
  message?: string;
  // Held so an answer, a decline and a cancel all reach the flow that asked. Dropped when the sign-in ends.
  client?: PiLoginClient;

  signIn(providerId: string, options: { allowDegraded: boolean }): Promise<ProviderLoginResult>;
  // Rotate the stored credential if it is near expiry, so nothing starts on a token about to lapse.
  refreshCredential(providerId: string): Promise<ProviderRefreshResult>;
  answerPrompt(value: string): void;
  // Refuse the question. pi's own flows read a rejected prompt as the user abandoning that step, which for OpenRouter
  // is what hands the login back to its loopback callback server.
  declinePrompt(): void;
  cancel(): void;
  reset(): void;
}

function engineForLogin(): { connectionId: string; name: string } | undefined {
  const app = useAppStore.getState();
  const items = connectedConnections(app.connections, useResourceStore.getState().activeRuntime);
  const chosen = pickActiveConnection(items, undefined, app.userSettings?.connector?.default);
  return chosen ? { connectionId: chosen.id, name: chosen.name } : undefined;
}

// The env file carries the bridge token, which authorises the whole socket, so it is written by the host into the same
// protected directory the session's files go to rather than anywhere the web view can read back.
async function writeLoginEnvFile(name: string, contents: string): Promise<string> {
  const bridge = typeof window !== "undefined" ? window.AI : undefined;
  if (!bridge) throw new Error("the AI host bridge is unavailable, so the sign-in cannot be given its environment");
  const { path } = await bridge.writeAgentEnvFile(name, contents);
  return path;
}

export const useProviderLoginStore = create<ProviderLoginState>()((set, get) => ({
  status: "idle",
  log: [],

  async signIn(providerId, options): Promise<ProviderLoginResult> {
    const offer = providerLoginOffer(providerId);
    if (!offer) return { stored: false, reason: "this provider has no sign-in this app can complete" };
    const bridge = typeof window !== "undefined" ? window.AI : undefined;
    if (!bridge) return { stored: false, reason: "the AI host bridge is unavailable" };
    // One at a time, enforced here rather than only in the container: a second call would start a SECOND container,
    // and the one already waiting on the user's browser would be orphaned holding its port.
    const running = get().status;
    if (running === "starting" || running === "waiting") {
      return { stored: false, reason: "a sign-in is already running" };
    }

    set({
      status: "starting",
      providerId,
      label: offer.label,
      log: [],
      authUrl: undefined,
      authInstructions: undefined,
      deviceCode: undefined,
      prompt: undefined,
      message: undefined,
    });

    const suffix = randomUUID().slice(0, 8);
    const spec: PiLoginContainerSpec = {
      imageTag: agentImageTag(PROJECT_VERSION),
      containerName: `cd-login-${suffix}`,
      hostPort: pickHostPort(),
      bridgeToken: randomUUID(),
      piProviderId: piProviderIdFor(providerId),
    };

    const note = (line: string) => set((state) => ({ log: [...state.log, line] }));
    let client: PiLoginClient | undefined;
    // The host that STARTED the container, kept for the removal: resolving one again at the end could answer with a
    // different engine — the connection list is live — and the container would be left standing on the first.
    let startedOn: HostClientFacade | undefined;
    try {
      // Mock mode has no engine to run a container on, so the far end of the socket is scripted instead — the same
      // substitution the session makes. DEV-gated and dynamically imported, so a production build never links it.
      if (isMockMode() && import.meta.env.ENVIRONMENT !== "production") {
        const { createMockPiLoginClient } = await import("@/ai-system/testing/mockPiLoginClient");
        client = createMockPiLoginClient();
      } else {
        const engine = engineForLogin();
        if (!engine) {
          set({ status: "error", message: "connect a container engine first — the sign-in runs in a container" });
          return { stored: false, reason: "no connected container engine" };
        }
        const host = await resolveConnectionHost(engine.connectionId);
        if (!host) {
          set({ status: "error", message: `no engine host for connection ${engine.connectionId}` });
          return { stored: false, reason: "no engine host" };
        }
        note(`starting ${spec.containerName} on ${engine.name}`);
        await startPiLoginContainer(host, spec, (contents) => writeLoginEnvFile(`${suffix}-login.env`, contents));
        startedOn = host;
        client = createPiLoginClient({ url: `ws://127.0.0.1:${spec.hostPort}/`, token: spec.bridgeToken });
      }

      client.onEvent((event) => {
        if (event.type === "auth_prompt") {
          set({ status: "waiting", prompt: { promptId: event.promptId, prompt: event.prompt } });
          return;
        }
        if (event.type === "auth_prompt_closed") {
          set((state) => (state.prompt?.promptId === event.promptId ? { prompt: undefined } : {}));
          return;
        }
        const detail = event.event;
        if (detail.type === "auth_url") {
          set({ authUrl: detail.url, authInstructions: detail.instructions });
          return;
        }
        if (detail.type === "device_code") {
          set({ deviceCode: { userCode: detail.userCode, verificationUri: detail.verificationUri } });
          return;
        }
        note(detail.message);
      });

      await client.connect();
      // Published BEFORE the login is asked for, because the flow's first prompt can arrive while that call is still
      // pending: an answer typed into a dialog whose client had not been stored yet would reach nobody.
      set({ status: "waiting", client });
      const outcome = await client.login(spec.piProviderId);
      if (!outcome.ok) {
        set({ status: "refused", prompt: undefined, message: outcome.error });
        return { stored: false, reason: outcome.error };
      }
      const verdict = loginCredentialVerdict(outcome.credential, Date.now());
      if (!verdict.storable) {
        set({ status: "refused", prompt: undefined, message: verdict.reason });
        return { stored: false, reason: verdict.reason };
      }
      // A permanent key is stored as itself; an expiring pair is stored whole, because its refresh token is what the
      // next exchange needs. One vault entry either way — the gateway reads the access token out of it.
      await bridge.setKey(providerId, encodeProviderCredential(verdict.credential), {
        allowDegraded: options.allowDegraded,
      });
      set({ status: "stored", prompt: undefined, authUrl: undefined, message: undefined });
      return { stored: true };
    } catch (error) {
      const message = (error as Error).message;
      logger.error("provider sign-in failed", error);
      set({ status: "error", prompt: undefined, message });
      return { stored: false, reason: message };
    } finally {
      client?.close();
      set({ client: undefined });
      // Removed whatever happened: it holds a published port and keeps listening, so leaving one behind costs the
      // next sign-in its port and the engine a container nobody owns.
      if (startedOn) await removePiLoginContainer(startedOn, spec);
    }
  },

  // Keep a stored credential usable, before anything depends on it. The credential never crosses into this realm:
  // the container reads it from its own env file — substituted by the vault's owning realm — decides whether it is
  // near expiry, exchanges it through pi's own flow, and answers with the rotation, which is stored exactly the way a
  // sign-in's is. A provider holding a permanent key answers `unchanged` and costs one short-lived container.
  async refreshCredential(providerId): Promise<ProviderRefreshResult> {
    const offer = providerLoginOffer(providerId);
    if (!offer) return { refreshed: false };
    const bridge = typeof window !== "undefined" ? window.AI : undefined;
    if (!bridge) return { refreshed: false, reason: "the AI host bridge is unavailable" };
    if (!(await bridge.hasKey(providerId).catch(() => false))) return { refreshed: false };

    const suffix = randomUUID().slice(0, 8);
    const spec: PiLoginContainerSpec = {
      imageTag: agentImageTag(PROJECT_VERSION),
      containerName: `cd-login-${suffix}`,
      hostPort: pickHostPort(),
      bridgeToken: randomUUID(),
      piProviderId: piProviderIdFor(providerId),
      carriesStoredCredential: true,
    };
    let client: PiLoginClient | undefined;
    let startedOn: HostClientFacade | undefined;
    try {
      if (isMockMode() && import.meta.env.ENVIRONMENT !== "production") {
        const { createMockPiLoginClient } = await import("@/ai-system/testing/mockPiLoginClient");
        client = createMockPiLoginClient();
      } else {
        const engine = engineForLogin();
        if (!engine) return { refreshed: false, reason: "no connected container engine" };
        const host = await resolveConnectionHost(engine.connectionId);
        if (!host) return { refreshed: false, reason: "no engine host" };
        // The env file is composed HOST-side for this one, because it carries the stored credential: the realm that
        // owns the vault substitutes it while writing and answers only the path. So the contents this adapter would
        // have composed are not used — the file is asked for by provider instead.
        await startPiLoginContainer(host, spec, async () => {
          const { path } = await bridge.writeAuthRefreshEnv({
            provider: providerId,
            fileName: `${suffix}-refresh.env`,
            bridgeToken: spec.bridgeToken,
            bridgePort: PI_BRIDGE_PORT_IN_IMAGE,
          });
          return path;
        });
        startedOn = host;
        client = createPiLoginClient({ url: `ws://127.0.0.1:${spec.hostPort}/`, token: spec.bridgeToken });
      }
      await client.connect();
      const outcome = await client.refresh(spec.piProviderId);
      if (!outcome.ok) return { refreshed: false, reason: outcome.error, mustSignInAgain: !!outcome.invalidGrant };
      if ("unchanged" in outcome) {
        return { refreshed: false, ...(outcome.expiresAt ? { expiresAt: outcome.expiresAt } : {}) };
      }
      const verdict = loginCredentialVerdict(outcome.credential, Date.now());
      if (!verdict.storable) return { refreshed: false, reason: verdict.reason };
      await bridge.setKey(providerId, encodeProviderCredential(verdict.credential), { allowDegraded: true });
      return { refreshed: true, expiresAt: outcome.credential.expires, accessToken: outcome.credential.access };
    } catch (error) {
      const message = (error as Error).message;
      logger.error("refreshing the provider credential failed", error);
      return { refreshed: false, reason: message };
    } finally {
      client?.close();
      if (startedOn) await removePiLoginContainer(startedOn, spec);
    }
  },

  answerPrompt(value) {
    const { prompt, client } = get();
    if (!prompt) return;
    client?.answerPrompt(prompt.promptId, true, value);
    set({ prompt: undefined });
  },

  declinePrompt() {
    const { prompt, client } = get();
    if (!prompt) return;
    client?.answerPrompt(prompt.promptId, false);
    set({ prompt: undefined });
  },

  cancel() {
    get().client?.cancel();
    set({ prompt: undefined });
  },

  reset() {
    set({
      status: "idle",
      providerId: undefined,
      label: undefined,
      log: [],
      authUrl: undefined,
      authInstructions: undefined,
      deviceCode: undefined,
      prompt: undefined,
      message: undefined,
    });
  },
}));
