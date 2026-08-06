// One provider sign-in, start to finish: a one-shot container, pi's own flow inside it, and the key it produces
// written to the OS keychain — the same slot a typed key goes to, so everything downstream is unchanged.
//
// It is its own store rather than part of the coding-agent one because it runs BEFORE a session can exist: signing in
// is how a provider gets the credential a session needs, so it can neither borrow the session's container nor its
// socket. The container it starts mounts nothing and is removed on every path out of here.
//
// **It runs on the connection the user chose, remote included.** Nothing about a connection is this store's to answer
// for: the scope its commands are wrapped in, whether its engine is on another machine, and where a port it publishes
// actually lands are all asked of the connection at the moment of use — and where that lands somewhere else, the
// bridge is forwarded here exactly as a session's is. Before that it ran the container through the LOCAL engine
// whatever the user had chosen, and dialled `127.0.0.1` at a port only that local engine had published, so a user
// whose only engine is remote could not sign in at all.
//
// A RENEWAL is the one exception, and it is a boundary rather than a shortcut: the file it needs carries the stored
// credential, written by the realm that owns the vault, which answers with a PATH and never with contents. There is
// nothing for this realm to carry over an engine's stdin, so a renewal can only run where a file this machine wrote
// can be read.

import { create } from "zustand";
import { engineSharesAppFilesystem, pickHostPort } from "@/ai-system/adapters/piAgentContainer";
import { createPiLoginClient, type PiLoginClient } from "@/ai-system/adapters/piLoginClient";
import {
  type PiLoginContainerSpec,
  removePiLoginContainer,
  startPiLoginContainer,
} from "@/ai-system/adapters/piLoginContainer";
import { assistantContainerName, assistantEnvVolumeName } from "@/ai-system/adapters/sessionNaming";
import { loginCredentialVerdict, providerLoginOffer } from "@/ai-system/core/piAuth";
import { isMockMode } from "@/container-client/mock/mode";
import { engineIsRemote } from "@/container-client/proxy-route";
import { connectionCommandScope } from "@/container-client/runtimes/commandScope";
import { publishedPortAddress } from "@/container-client/runtimes/publishedPortHost";
import type { Connection } from "@/container-client/types/connection";
import { createLogger } from "@/logger";
import { agentImageTag, PI_BRIDGE_PORT_IN_IMAGE } from "@/pi-bridge/image";
import { piProviderIdFor } from "@/pi-bridge/modelBaseline";
import type { PiAuthPrompt } from "@/pi-bridge/protocol";
import { encodeProviderCredential } from "@/pi-bridge/providerCredential";
import { randomUUID } from "@/utils/randomUUID";
import { connectedConnections, pickActiveConnection } from "@/web-app/components/ConnectionSelect.logic";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { forwardPublishedPort } from "@/web-app/domain/remoteReach";
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

// What a login container has to be able to reach. A SIGN-IN needs nothing of this machine — its environment is the
// bridge token and the port, which travel to any engine — so it runs on whichever connection the user chose. A
// RENEWAL needs the file the vault's owning realm wrote HERE, and only an engine that can read this filesystem can be
// handed one; carrying it is not an option, because that realm answers with a path and never with contents.
type LoginEngineNeed = "any-connection" | "reads-this-filesystem";

const NO_ENGINE_REASON: Record<LoginEngineNeed, string> = {
  "any-connection": "connect a container engine first — the sign-in runs in a container",
  "reads-this-filesystem":
    "renewing a sign-in needs a container engine on this machine — a stored credential cannot be handed to a remote one",
};

function engineForLogin(need: LoginEngineNeed): Connection | undefined {
  const app = useAppStore.getState();
  const items = connectedConnections(
    app.connections,
    useResourceStore.getState().activeRuntime,
    need === "reads-this-filesystem" ? (connection) => engineSharesAppFilesystem(connection.host) : undefined,
  );
  return pickActiveConnection(items, undefined, app.userSettings?.connector?.default);
}

// A login container, running and reachable — everything between "one has to exist" and "it is gone".
interface LoginRun {
  client: PiLoginClient;
  // Why the socket stopped carrying anything, when a forward under it died. An outcome that fails afterwards fails
  // for THIS reason rather than for the closed socket that dialling nothing produces.
  carrierLost(): string | undefined;
  // Everything this run brought up, taken down in the order that leaves nothing holding a port. Called on every path
  // out, including a throw.
  release(): Promise<void>;
}

interface LoginRunRequest {
  spec: PiLoginContainerSpec;
  // This run's own short name, the one its container is already called after. The volume that may carry its
  // environment is named from the same one, so the two can never belong to different runs.
  runScope: string;
  need: LoginEngineNeed;
  // How the environment reaches an engine that can read this machine's filesystem. Never called for one that cannot:
  // that environment is carried into a volume over the engine's own stdin instead.
  writeEnvFile: (contents: string) => Promise<string>;
  note: (line: string) => void;
}

async function openLoginRun(request: LoginRunRequest): Promise<LoginRun | { unavailable: string }> {
  const { spec, need, writeEnvFile, note } = request;
  // Mock mode has no engine to run a container on, so the far end of the socket is scripted instead — the same
  // substitution the session makes. DEV-gated and dynamically imported, so a production build never links it.
  if (isMockMode() && import.meta.env.ENVIRONMENT !== "production") {
    const { createMockPiLoginClient } = await import("@/ai-system/testing/mockPiLoginClient");
    const client = createMockPiLoginClient();
    return {
      client,
      carrierLost: () => undefined,
      release: async () => client.close(),
    };
  }

  const engine = engineForLogin(need);
  if (!engine) return { unavailable: NO_ENGINE_REASON[need] };
  const host = await resolveConnectionHost(engine.id);
  if (!host) return { unavailable: `no engine host for connection ${engine.id}` };

  // Everything about WHERE this runs is the connection's answer, asked at the moment of use: the scope its commands
  // are wrapped in, whether a published port lands on the engine's own host or inside a machine, and whether the
  // engine's client can read a file this app wrote.
  const remote = engineIsRemote(host.HOST);
  const machineAddress = await publishedPortAddress(host, spec.imageTag);
  const placed: PiLoginContainerSpec = {
    ...spec,
    scope: await connectionCommandScope(host),
    ...(machineAddress ? { machineAddress } : {}),
    ...(remote ? { envVolumeName: assistantEnvVolumeName(request.runScope) } : {}),
  };

  let carrier: string | undefined;
  let tunnel: { localPort: number; stop: () => void } | undefined;
  const release = async () => {
    tunnel?.stop();
    tunnel = undefined;
    await removePiLoginContainer(host, placed);
  };
  // The removal covers the START too, not only what follows it. `run --detach` can CREATE the container and still
  // fail — a refused port binding is the common one — and the engine leaves it behind in `Created`, holding the name.
  // Measured: two such orphans on this machine from runs whose removal only began once the start had returned.
  try {
    note(`starting ${placed.containerName} on ${engine.name}`);
    await startPiLoginContainer(host, placed, writeEnvFile);
    // A container on another machine publishes on THAT machine, so the port is forwarded here before anything dials
    // it — the same reach a session's bridge takes, and the reason a sign-in can happen on a remote connection at all.
    if (remote) {
      tunnel = await forwardPublishedPort({
        scope: placed.scope,
        what: "the sign-in",
        label: "the sign-in's bridge",
        remotePort: placed.hostPort,
        remoteHost: placed.machineAddress,
        onLost: (reason) => {
          carrier = reason;
          note(reason);
        },
      });
    }
    const client = createPiLoginClient({
      url: `ws://127.0.0.1:${tunnel?.localPort ?? placed.hostPort}/`,
      token: placed.bridgeToken,
    });
    return {
      client,
      carrierLost: () => carrier,
      release: async () => {
        client.close();
        await release();
      },
    };
  } catch (error) {
    // Whatever got as far as existing: a container the engine created but could not start, one that is up while the
    // forward it needs could not be opened, and the forward itself. Left alone, each holds a port on a machine that
    // may not be this one.
    await release();
    throw error;
  }
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
      containerName: assistantContainerName("login", suffix),
      hostPort: pickHostPort(),
      bridgeToken: randomUUID(),
      piProviderId: piProviderIdFor(providerId),
    };

    const note = (line: string) => set((state) => ({ log: [...state.log, line] }));
    let run: LoginRun | undefined;
    try {
      const opened = await openLoginRun({
        spec,
        runScope: `login-${suffix}`,
        need: "any-connection",
        writeEnvFile: (contents) => writeLoginEnvFile(`${suffix}-login.env`, contents),
        note,
      });
      if ("unavailable" in opened) {
        set({ status: "error", message: opened.unavailable });
        return { stored: false, reason: opened.unavailable };
      }
      run = opened;
      const client = run.client;

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
        // A forward that died took the socket with it, so "the container closed the connection" is the symptom and
        // the forward's own exit is the cause. Say the cause.
        const reason = run.carrierLost() ?? outcome.error;
        set({ status: "refused", prompt: undefined, message: reason });
        return { stored: false, reason };
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
      const message = run?.carrierLost() ?? (error as Error).message;
      logger.error("provider sign-in failed", error);
      set({ status: "error", prompt: undefined, message });
      return { stored: false, reason: message };
    } finally {
      set({ client: undefined });
      // Released whatever happened: the container holds a published port and keeps listening, and a forward under it
      // holds a local port and an SSH connection, so leaving either behind costs the next sign-in its port.
      await run?.release();
    }
  },

  // Keep a stored credential usable, before anything depends on it. The credential never crosses into this realm:
  // the container reads it from its own env file — substituted by the vault's owning realm — decides whether it is
  // near expiry, exchanges it through pi's own flow, and answers with the rotation, which is stored exactly the way a
  // sign-in's is. A provider holding a permanent key answers `unchanged` and costs one short-lived container.
  //
  // Unlike a sign-in this cannot run just anywhere, and the reason is that same file: the vault's realm answers with a
  // PATH, so there is nothing here to carry into a volume, and only an engine that can read this machine's filesystem
  // can be handed one. The connection it lands on is therefore not the user's choice but the first connected engine
  // that qualifies — which is sound because a rotation's product is a credential in THIS machine's keychain, the same
  // one whichever engine performed the exchange.
  async refreshCredential(providerId): Promise<ProviderRefreshResult> {
    const offer = providerLoginOffer(providerId);
    if (!offer) return { refreshed: false };
    const bridge = typeof window !== "undefined" ? window.AI : undefined;
    if (!bridge) return { refreshed: false, reason: "the AI host bridge is unavailable" };
    if (!(await bridge.hasKey(providerId).catch(() => false))) return { refreshed: false };

    const suffix = randomUUID().slice(0, 8);
    const spec: PiLoginContainerSpec = {
      imageTag: agentImageTag(PROJECT_VERSION),
      containerName: assistantContainerName("login", suffix),
      hostPort: pickHostPort(),
      bridgeToken: randomUUID(),
      piProviderId: piProviderIdFor(providerId),
      carriesStoredCredential: true,
    };
    let run: LoginRun | undefined;
    try {
      const opened = await openLoginRun({
        spec,
        runScope: `login-${suffix}`,
        need: "reads-this-filesystem",
        // The env file is composed HOST-side for this one, because it carries the stored credential: the realm that
        // owns the vault substitutes it while writing and answers only the path. So the contents this adapter would
        // have composed are not used — the file is asked for by provider instead.
        writeEnvFile: async () => {
          const { path } = await bridge.writeAuthRefreshEnv({
            provider: providerId,
            fileName: `${suffix}-refresh.env`,
            bridgeToken: spec.bridgeToken,
            bridgePort: PI_BRIDGE_PORT_IN_IMAGE,
          });
          return path;
        },
        note: (line) => logger.debug(line),
      });
      if ("unavailable" in opened) return { refreshed: false, reason: opened.unavailable };
      run = opened;
      await run.client.connect();
      const outcome = await run.client.refresh(spec.piProviderId);
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
      await run?.release();
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

// DEV-only handle for the WebDriver smoke spec, mirroring window.__cdCodingAgentStore: a sign-in cannot be driven to
// completion by a spec — it ends in the user's own browser — so what a spec drives is the half BEFORE that, which is
// the half this app owns: the container lands on the chosen connection, its bridge is reached from here, and pi's flow
// speaks back over it.
export function installProviderLoginProbe(): void {
  (globalThis as { __cdProviderLoginStore?: typeof useProviderLoginStore }).__cdProviderLoginStore =
    useProviderLoginStore;
}
