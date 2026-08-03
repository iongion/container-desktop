import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import type { AIDiagnosticState, AIDiagnosticsSnapshot, AIRecordedError } from "@/ai-system/core/diagnostics";
import { describeError } from "@/ai-system/core/errors";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AIKeyStore } from "@/ai-system/core/ports";
import { type ResolvedProvider, resolveProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import type { AISettings, ListedModel, ProviderTransport } from "@/ai-system/core/types";
import type { SkillHost } from "@/ai-system/host/skillHost";

interface DiagnosticsHostDeps {
  keyStore: AIKeyStore;
  getAISettings: () => Promise<AISettings> | AISettings;
  providerTransport: ProviderTransport;
  listModels: (
    provider: ResolvedProvider,
    options: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
  permissionsStore?: PermissionsStoreLike;
  skillHost?: SkillHost;
  webSearchAvailable: boolean;
  capabilities: AIDiagnosticsSnapshot["capabilities"];
  recentErrors: () => readonly AIRecordedError[];
}

type ProviderProbe = Pick<AIDiagnosticsSnapshot["provider"], "credential" | "reachability" | "modelCount" | "message">;

async function probeProvider(deps: DiagnosticsHostDeps, provider: ResolvedProvider): Promise<ProviderProbe> {
  let credential: ProviderProbe["credential"] = "not-required";
  let message: string | undefined;
  if (provider.requiresKey) {
    try {
      credential = (await deps.keyStore.hasKey(provider.id)) ? "stored" : "missing";
    } catch (error) {
      credential = "missing";
      message = redactText(describeError(error)).slice(0, 512);
    }
  }
  if (credential === "missing") return { credential, reachability: "not-checked", message };
  try {
    const models = await deps.listModels(provider, {
      fetchImpl: createProviderFetch(deps.providerTransport, provider),
    });
    return { credential, reachability: "reachable", modelCount: models.length, message };
  } catch (error) {
    return { credential, reachability: "unreachable", message: redactText(describeError(error)).slice(0, 512) };
  }
}

async function permissionsState(deps: DiagnosticsHostDeps): Promise<AIDiagnosticsSnapshot["security"]["permissions"]> {
  if (!deps.permissionsStore) return "unavailable";
  try {
    return (await deps.permissionsStore.load()).status;
  } catch {
    return "error";
  }
}

function skillState(deps: DiagnosticsHostDeps): AIDiagnosticState {
  const snapshot = deps.skillHost?.snapshot();
  if (!snapshot) return "unavailable";
  if (snapshot.user.status === "error" || snapshot.project?.status === "error") return "error";
  return snapshot.diagnostics.length ? "warning" : "ok";
}

export function createDiagnosticsHost(deps: DiagnosticsHostDeps) {
  return async (providerId?: string): Promise<AIDiagnosticsSnapshot> => {
    const settings = await deps.getAISettings();
    const provider = resolveProvider(settings, providerId);
    const [probe, permissions] = await Promise.all([probeProvider(deps, provider), permissionsState(deps)]);
    const skills = deps.skillHost?.snapshot();
    return {
      capturedAt: Date.now(),
      provider: {
        id: provider.id,
        kind: provider.kind,
        model: provider.model,
        destination: provider.isCloud ? "cloud" : "local",
        ...probe,
      },
      security: {
        encryption: deps.keyStore.getEncryptionStatus(),
        permissions,
        webSearch: !deps.webSearchAvailable ? "unavailable" : settings.webSearch ? "enabled" : "disabled",
      },
      capabilities: deps.capabilities,
      extensions: {
        skills: {
          state: skillState(deps),
          count: skills?.skills.length ?? 0,
          diagnostics: skills?.diagnostics.length ?? 0,
        },
        mcp: { state: "unavailable" },
      },
      recentErrors: deps.recentErrors().map((error) => ({ ...error })),
    };
  };
}
