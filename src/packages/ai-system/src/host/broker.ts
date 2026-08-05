import { fetchModelWindow } from "@/ai-system/adapters/modelWindow";
import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
  type AIStatus,
} from "@/ai-system/core/channels";
import type { AIRecordedError } from "@/ai-system/core/diagnostics";
import { dispatchEngineOp } from "@/ai-system/core/engineOpDispatch";
import { describeError } from "@/ai-system/core/errors";
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import { composeAuthRefreshEnv, composeGatewayEnv, KEYCHAIN_SECRET_PLACEHOLDER } from "@/ai-system/core/piAgentEnv";
import type {
  AIKeyStore,
  ExecutionSelector,
  ExecutionSelectorFactory,
  ResolvedExecution,
  SandboxRunner,
} from "@/ai-system/core/ports";
import { type ResolvedProvider, resolveProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import { validateAIInvokeRequest } from "@/ai-system/core/schemas";
import { SKILL_LIMITS } from "@/ai-system/core/skills";
import type { AISettings, DiagnosticsBundle, EngineOps, ListedModel, ProviderTransport } from "@/ai-system/core/types";
import type { WorkspaceChangesPort } from "@/ai-system/core/workspaceChanges";
import { dispatchWorkspaceOp } from "@/ai-system/core/workspaceOpDispatch";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { createDiagnosticsHost } from "./diagnosticsHost";
import { createModelDiscoveryHost } from "./modelDiscoveryHost";
import type { ProjectContextHost } from "./projectContextHost";
import type { SkillHost } from "./skillHost";

export interface AIBrokerDeps<TEvent = unknown> {
  keyStore: AIKeyStore;
  getAISettings: () => Promise<AISettings> | AISettings;
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  providerTransport: ProviderTransport;
  listModels: (
    provider: ResolvedProvider,
    options: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  projectContextHost?: ProjectContextHost;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  workspaceChanges?: WorkspaceChangesPort;
  createExecutionSelector?: ExecutionSelectorFactory;
  permissionsStore?: PermissionsStoreLike;
  // The public-web search the agent asks the app to run. Absent ⇒ this runtime cannot pin a destination, and the
  // tool is refused rather than offered.
  webSearcher?: (query: string) => Promise<{ text: string }>;
  skillHost?: SkillHost;
  buildSkillInvocationPrompt?: (context: {
    command: string;
    source: string;
    fingerprint: string;
    arguments: string;
    body: string;
  }) => string;
  logger?: { error: (...args: unknown[]) => void };
}

function requirePermissions(store: PermissionsStoreLike | undefined): PermissionsStoreLike {
  if (!store) throw new Error("AI: the permission store is not available");
  return store;
}

export interface AIBroker {
  register(): void;
  disposeForSender(senderId: number | string): void;
  dispose(): void;
}

export function createAIBroker<TEvent = unknown>(deps: AIBrokerDeps<TEvent>): AIBroker {
  const recentErrors: AIRecordedError[] = [];
  const resolveProviderAccess = async (providerId?: string): Promise<ResolvedProvider> => {
    const resolved = resolveProvider(await deps.getAISettings(), providerId);
    if (resolved.requiresKey && !(await deps.keyStore.hasKey(resolved.id))) {
      throw new Error("AI: no credential stored for this provider");
    }
    return resolved;
  };
  const reportError = (message: string, id: string | undefined, error: unknown): void => {
    const detail = redactText(describeError(error)).slice(0, 384);
    recentErrors.push({
      at: Date.now(),
      message: `${message}: ${detail}`.slice(0, 512),
      ...(id ? { context: id.slice(0, 256) } : {}),
    });
    if (recentErrors.length > 20) recentErrors.splice(0, recentErrors.length - 20);
    try {
      deps.logger?.error(message, {
        ...(id ? { sessionId: id } : {}),
        error: detail,
      });
    } catch {
      // Teardown is best-effort; logger failure must not become another host failure.
    }
  };

  const requireProjectContext = (): ProjectContextHost => {
    if (!deps.projectContextHost) throw new Error("AI: project context is unavailable");
    return deps.projectContextHost;
  };

  // One execution selector per RUN, so every workspace call a session makes shares its backend — and its single
  // sandbox container. Held here rather than in the renderer because the selector owns host-side ports the web view
  // cannot have, and released explicitly: a sandbox exists for the run and must not outlive it.
  const selectors = new Map<string, ExecutionSelector>();
  const resolveExecution = async (runId: string, target: ExecutionTarget): Promise<ResolvedExecution | undefined> => {
    if (!deps.createExecutionSelector) return undefined;
    let selector = selectors.get(runId);
    if (!selector) {
      selector = deps.createExecutionSelector(runId);
      selectors.set(runId, selector);
    }
    return selector.select(target);
  };
  const releaseExecution = async (runId: string): Promise<void> => {
    const selector = selectors.get(runId);
    if (!selector) return;
    selectors.delete(runId);
    // Reported, never raised: the session is ending either way, and a sandbox left standing is a leak to log rather
    // than a reason to fail the call that was tidying up.
    await selector.dispose().catch((error) => reportError("AI: releasing a workspace target failed", runId, error));
  };
  const models = createModelDiscoveryHost<TEvent>({
    senderId: deps.senderId,
    resolveProviderAccess,
    providerTransport: deps.providerTransport,
    listModels: deps.listModels,
  });

  const status = (): AIStatus => ({
    encryption: deps.keyStore.getEncryptionStatus(),
    webSearchAvailable: !!deps.webSearcher,
  });
  const diagnostics = createDiagnosticsHost({
    keyStore: deps.keyStore,
    getAISettings: deps.getAISettings,
    providerTransport: deps.providerTransport,
    listModels: deps.listModels,
    permissionsStore: deps.permissionsStore,
    skillHost: deps.skillHost,
    webSearchAvailable: !!deps.webSearcher,
    capabilities: {
      sandbox: !!deps.runSandboxed,
      containerTools: !!deps.engineOps,
      workspaceTools: !!deps.workspaceAccess,
      executionTargets: !!deps.createExecutionSelector,
    },
    recentErrors: () => recentErrors,
  });
  const guarded = async <T>(event: TEvent, task: () => T | Promise<T>): Promise<T> => {
    if (!deps.isAllowedSender(event)) throw new Error("AI: unauthorized sender");
    return task();
  };
  // A shell that offers no skills library must fail the channel loudly. Answering with an empty list would look
  // like "you have no skills", and the next save would appear to succeed while persisting nothing.
  const requireSkills = (): SkillHost => {
    if (!deps.skillHost) throw new Error("AI: the skills library is unavailable on this runtime");
    return deps.skillHost;
  };
  const skillObservers = new Map<number | string, TEvent>();
  const observeSkills = (event: TEvent): void => {
    skillObservers.set(deps.senderId(event), event);
  };
  const unsubscribeSkills = deps.skillHost?.subscribe((snapshot) => {
    for (const [senderId, event] of skillObservers) {
      try {
        deps.send(event, AI_CHANNELS.skillsChanged, snapshot);
      } catch (error) {
        skillObservers.delete(senderId);
        reportError("AI: skill observer delivery failed", undefined, error);
      }
    }
  });

  const register = (): void => {
    const onInvoke = <TChannel extends AIInvokeChannel>(
      channel: TChannel,
      handler: (
        event: TEvent,
        payload: AIInvokeRequest<TChannel>,
      ) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
    ) => deps.onInvoke(channel, async (event, payload) => handler(event, validateAIInvokeRequest(channel, payload)));

    onInvoke(AI_CHANNELS.status, (event) => guarded(event, () => status()));
    onInvoke(AI_CHANNELS.diagnostics, (event, request) => guarded(event, () => diagnostics(request.providerId)));
    onInvoke(AI_CHANNELS.keyHas, (event, request) => guarded(event, () => deps.keyStore.hasKey(request.provider)));
    onInvoke(AI_CHANNELS.keySet, (event, request) =>
      guarded(event, async () => {
        await deps.keyStore.setKey(request.provider, request.key, { allowDegraded: !!request.allowDegraded });
        return { ok: true };
      }),
    );
    onInvoke(AI_CHANNELS.keyClear, (event, request) =>
      guarded(event, async () => {
        await deps.keyStore.clearKey(request.provider);
        return { ok: true };
      }),
    );
    // The coding agent's gateway container needs the provider key, and the renderer cannot read it — the key
    // lives in the OS keychain. So the env file that carries it is composed and written HERE, and the renderer
    // only learns its path. A provider with no key stored yields an empty value, which is correct for a
    // keyless local server.
    onInvoke(AI_CHANNELS.agentGatewayEnv, (event, request) =>
      guarded(event, async () => {
        // The credential SHAPE is derived here too, from the settings this host reads itself — the renderer
        // never describes how a provider authenticates, only which one it picked. `baseUrl` stays the caller's:
        // it carries the engine's host-alias rewrite, which only the renderer knows.
        const resolved = resolveProvider(await deps.getAISettings(), request.provider);
        // The key is NEVER read here. This host can run in a web-view realm, where the vault deliberately
        // refuses to hand over a secret at all — so the file is composed with a placeholder and the realm that
        // owns the vault substitutes it while writing, answering only the path. That keeps one composer and one
        // file format while the plaintext stays where it started.
        const contents = composeGatewayEnv({
          baseUrl: request.baseUrl,
          apiKey: KEYCHAIN_SECRET_PLACEHOLDER,
          bridgeToken: request.bridgeToken,
          gatewayPort: request.gatewayPort,
          providerKind: resolved.kind,
          auth: resolved.auth,
        });
        const path = await deps.keyStore.writeSecretFile(request.provider, request.fileName, contents);
        return { path };
      }),
    );
    // The one-shot auth container's env file for a refresh. Composed with the same placeholder the gateway's uses, so
    // the credential is substituted by the realm that owns the vault and never crosses into the web view — which is
    // precisely why the exchange happens in a container rather than here.
    onInvoke(AI_CHANNELS.authRefreshEnv, (event, request) =>
      guarded(event, async () => ({
        path: await deps.keyStore.writeSecretFile(
          request.provider,
          request.fileName,
          composeAuthRefreshEnv({
            bridgeToken: request.bridgeToken,
            bridgePort: request.bridgePort,
            credential: KEYCHAIN_SECRET_PLACEHOLDER,
          }),
        ),
      })),
    );
    // The AGENT container's env file, into the SAME protected directory. It carries the bridge token — a secret in its
    // own right — so it belongs behind the same guard rather than in a second directory the web view can read back.
    onInvoke(AI_CHANNELS.agentEnvFile, (event, request) =>
      guarded(event, async () => ({ path: await deps.keyStore.writeAgentEnvFile(request.fileName, request.contents) })),
    );
    onInvoke(AI_CHANNELS.changesStatus, (event) =>
      guarded(event, () => {
        if (!deps.workspaceChanges) throw new Error("AI: workspace change review is unavailable");
        return deps.workspaceChanges.status();
      }),
    );
    onInvoke(AI_CHANNELS.changesDiff, (event) =>
      guarded(event, () => {
        if (!deps.workspaceChanges) throw new Error("AI: workspace change review is unavailable");
        return deps.workspaceChanges.diff();
      }),
    );
    onInvoke(AI_CHANNELS.projectContextSnapshot, (event) =>
      guarded(event, () =>
        deps.projectContextHost
          ? deps.projectContextHost.snapshot()
          : { state: "unconfigured", rules: [], memory: [], message: "AI: project context is unavailable" },
      ),
    );
    onInvoke(AI_CHANNELS.projectRulesSetEnabled, (event, request) =>
      guarded(event, () => requireProjectContext().setRulesEnabled(request.enabled)),
    );
    onInvoke(AI_CHANNELS.projectRulesInitialize, (event) =>
      guarded(event, () => requireProjectContext().initializeRules()),
    );
    onInvoke(AI_CHANNELS.projectMemoryAdd, (event, request) =>
      guarded(event, () => requireProjectContext().addMemory(request.content)),
    );
    onInvoke(AI_CHANNELS.projectMemoryRemove, (event, request) =>
      guarded(event, () => requireProjectContext().removeMemory(request.id)),
    );
    onInvoke(AI_CHANNELS.projectMemoryClear, (event) => guarded(event, () => requireProjectContext().clearMemory()));
    onInvoke(AI_CHANNELS.projectMemoryImport, (event, content) =>
      guarded(event, () => requireProjectContext().importMemory(content)),
    );
    onInvoke(AI_CHANNELS.modelsList, (event, request) =>
      guarded(event, () => models.list(event, request.requestId, request.providerId)),
    );
    onInvoke(AI_CHANNELS.modelsCancel, (event, request) =>
      guarded(event, () => models.cancel(event, request.requestId)),
    );
    // What the PROVIDER says its window is. Answered host-side because only this realm holds the credential and can
    // reach a provider's own endpoint; an unknown provider answers `{}`, which the panel shows as "unknown".
    onInvoke(AI_CHANNELS.modelWindow, (event, request) =>
      guarded(event, async () => {
        const resolved = resolveProvider(await deps.getAISettings(), request.providerId);
        return (await fetchModelWindow({ ...resolved, model: request.model })) ?? {};
      }),
    );
    // The coding agent's container toolset lands here. dispatchEngineOp answers with a reason instead of
    // throwing, so an unbound port or a dead connection reaches the agent as a tool error it can act on.
    onInvoke(AI_CHANNELS.engineOp, (event, request) =>
      guarded(event, () =>
        dispatchEngineOp(
          deps.engineOps,
          { op: request.op, args: request.args },
          { connectionId: request.defaultConnectionId },
        ),
      ),
    );
    // The coding agent's WORKSPACE toolset. The target travels with every call and the selector is memoized per
    // run, so everything a session does on one target shares one backend — and one sandbox container.
    onInvoke(AI_CHANNELS.workspaceOp, (event, request) =>
      guarded(event, async () => {
        const resolved = await resolveExecution(request.runId, request.target).catch((error) => {
          // Building a backend can genuinely fail — a sandbox image that will not pull, a workspace root that
          // cannot be made in the container. That is a reason the model can act on, not a rejected invoke.
          reportError("AI: preparing the workspace target failed", request.runId, error);
          return undefined;
        });
        if (!resolved) {
          return { ok: false as const, error: "The workspace target could not be prepared for this session." };
        }
        return dispatchWorkspaceOp(resolved.workspaceAccess, { op: request.op, args: request.args });
      }),
    );
    onInvoke(AI_CHANNELS.workspaceRelease, (event, request) =>
      guarded(event, async () => {
        await releaseExecution(request.runId);
        return { ok: true as const };
      }),
    );
    // The agent's public-web search. The user's switch is enforced HERE, on every call, rather than by withholding
    // the tool: it can be turned off while a session runs, and "the user turned it off" is a reason the model can
    // act on. A runtime with no pinned public fetch never offers it at all (webSearchAvailable is false).
    onInvoke(AI_CHANNELS.webSearch, (event, request) =>
      guarded(event, async () => {
        if (!deps.webSearcher) throw new Error("AI: web search is unavailable on this runtime");
        if (!(await deps.getAISettings()).webSearch) {
          throw new Error("AI: web search is turned off in Settings → AI");
        }
        return deps.webSearcher(request.query);
      }),
    );
    onInvoke(AI_CHANNELS.permissionsList, (event) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).load()),
    );
    onInvoke(AI_CHANNELS.permissionsAdd, (event, request) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).addCommand(request.list, request.rule)),
    );
    onInvoke(AI_CHANNELS.permissionsRemove, (event, request) =>
      guarded(event, () => requirePermissions(deps.permissionsStore).removeCommand(request.list, request.key)),
    );
    onInvoke(AI_CHANNELS.skillsSnapshot, (event) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().snapshot();
      }),
    );
    onInvoke(AI_CHANNELS.skillsReload, (event) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().reload();
      }),
    );
    onInvoke(AI_CHANNELS.skillsSetProjectSource, (event, request) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().setProjectSourceEnabled(request.enabled);
      }),
    );
    onInvoke(AI_CHANNELS.skillsSetProjectTrust, (event, request) =>
      guarded(event, () => {
        observeSkills(event);
        return requireSkills().setProjectSkillTrust(request.skillId, request.expectedFingerprint, request.trusted);
      }),
    );
    onInvoke(AI_CHANNELS.skillsInvoke, (event, request) =>
      guarded(event, async () => {
        observeSkills(event);
        const resolved = await requireSkills().resolveInvocation(request);
        if (!deps.buildSkillInvocationPrompt) throw new Error("AI: skill prompt builder is unavailable");
        const prompt = deps.buildSkillInvocationPrompt({
          command: resolved.descriptor.command,
          source: resolved.descriptor.source.kind,
          fingerprint: resolved.descriptor.fingerprint,
          arguments: resolved.arguments,
          body: resolved.manifest.body,
        });
        if (new TextEncoder().encode(prompt).byteLength > SKILL_LIMITS.renderedPromptBytes) {
          throw new Error("AI: rendered skill prompt is too large");
        }
        // Resolved and rendered, not submitted: the agent runs on the pi bridge, so the renderer is what owns
        // the turn. Everything security-relevant — the fingerprint match, the project-trust check, the tool
        // narrowing and the taint verdict — is decided HERE and travels with the prompt.
        return {
          prompt,
          displayContent: `${resolved.descriptor.command}${resolved.arguments ? ` ${resolved.arguments}` : ""}`,
          skill: {
            skillId: resolved.descriptor.id,
            command: resolved.descriptor.command,
            source: resolved.descriptor.source.kind,
            fingerprint: resolved.descriptor.fingerprint,
          },
          ...(resolved.manifest.allowedTools ? { allowedTools: [...resolved.manifest.allowedTools] } : {}),
          ...(resolved.initialTaint ? { initialTaint: true } : {}),
        };
      }),
    );
  };

  return {
    register,
    disposeForSender(senderId: number | string): void {
      models.disposeForSender(senderId);
      skillObservers.delete(senderId);
    },
    dispose(): void {
      models.dispose();
      unsubscribeSkills?.();
      deps.skillHost?.dispose();
      skillObservers.clear();
      try {
        deps.providerTransport.dispose();
      } catch (error) {
        reportError("AI: provider fetch disposal failed", undefined, error);
      }
    },
  };
}
