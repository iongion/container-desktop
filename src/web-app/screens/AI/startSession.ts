// Pure resolution of the Coding Agent's start form: which endpoint the gateway container dials, which model
// the agent asks for, and every reason a start cannot proceed. Kept out of the drawer so the rules are
// unit-testable without rendering one.
import { resolveProvider } from "@/ai-system/core/providers";
import type { AISettings } from "@/ai-system/core/types";
import type { StartCodingAgentOptions } from "@/web-app/stores/codingAgent";

export interface CodingAgentStartForm {
  connectionId: string;
  workspacePath: string;
  providerId: string;
  model: string;
  egress: boolean;
}

export type CodingAgentStartProblem =
  | "no-connection"
  | "no-workspace"
  | "no-provider"
  | "no-endpoint"
  | "no-model"
  | "missing-key";

export interface CodingAgentStartContext {
  settings: AISettings;
  appVersion: string;
  // Whether the OS keychain holds a key for the picked provider (window.AI.hasKey). The key itself never
  // reaches the renderer, so presence is all this can decide on.
  keyPresent: boolean;
}

export interface ResolvedCodingAgentStart {
  problems: CodingAgentStartProblem[];
  options?: StartCodingAgentOptions;
}

export function resolveCodingAgentStart(
  form: CodingAgentStartForm,
  context: CodingAgentStartContext,
): ResolvedCodingAgentStart {
  const problems: CodingAgentStartProblem[] = [];
  const workspacePath = form.workspacePath.trim();
  if (!form.connectionId) {
    problems.push("no-connection");
  }
  if (!workspacePath) {
    problems.push("no-workspace");
  }
  // An unconfigured provider id has no endpoint to derive, and resolveProvider throws on it.
  let resolved: ReturnType<typeof resolveProvider> | undefined;
  try {
    resolved = resolveProvider(context.settings, form.providerId);
  } catch {
    problems.push("no-provider");
  }
  const modelId = (form.model || resolved?.model || "").trim();
  if (resolved) {
    if (!resolved.baseURL) {
      problems.push("no-endpoint");
    }
    if (!modelId) {
      problems.push("no-model");
    }
    if (resolved.requiresKey && !context.keyPresent) {
      problems.push("missing-key");
    }
  }
  if (!resolved || problems.length > 0) {
    return { problems };
  }
  return {
    problems,
    options: {
      connectionId: form.connectionId,
      workspacePath,
      modelId,
      providerId: resolved.id,
      upstreamBaseUrl: resolved.baseURL,
      // The key lives in the OS keychain and is never readable here — the host puts it in the gateway's
      // private env file. Callers that already hold a key (the live WebDriver specs) pass their own.
      upstreamApiKey: "",
      appVersion: context.appVersion,
      egress: form.egress,
    },
  };
}
