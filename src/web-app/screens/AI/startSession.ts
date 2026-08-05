// Pure resolution of the Coding Agent's start form: which endpoint the gateway container dials, which model
// the agent asks for, and every reason a start cannot proceed. Kept out of the drawer so the rules are
// unit-testable without rendering one.
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import { resolveProvider } from "@/ai-system/core/providers";
import type { AISettings } from "@/ai-system/core/types";
import type { StartCodingAgentOptions } from "@/web-app/stores/codingAgent";

export interface CodingAgentStartForm {
  connectionId: string;
  workspacePath: string;
  providerId: string;
  model: string;
  egress: boolean;
  // Which container the session's workspace tools run in. "off" is not a target: it withholds the toolset
  // entirely, which is the default — the agent's own file tools already see the mounted workspace inside its own
  // container, and entering another one is a choice the user makes, never one this form makes for them.
  executionKind: ExecutionTargetKind;
  // The container the tools run in, or the image a disposable one is created from. Which of the two it is follows
  // from `executionKind`; one field because exactly one of them is ever asked for.
  executionRef: string;
}

// A target is a CONTAINER — the connection above is how it is reached, not a target of its own. Connections are
// this app's core principle: local, remote over SSH, WSL or a machine VM, all reached the same way.
export type ExecutionTargetKind = "off" | "container" | "sandbox";

export type CodingAgentStartProblem =
  | "no-connection"
  | "no-workspace"
  | "no-provider"
  | "no-endpoint"
  | "no-model"
  | "missing-key"
  | "no-execution-ref";

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

// The form's own words turned into the target vocabulary `ExecutionTarget` already owns. Both targets act through
// the connection the session was started on — that is the transport the app holds, and the only way a container is
// reached whether the engine is on this machine, in a VM or across SSH.
function executionTargetFor(form: CodingAgentStartForm, executionRef: string): ExecutionTarget | undefined {
  switch (form.executionKind) {
    case "off":
      return undefined;
    case "container":
      return { kind: "container", connectionId: form.connectionId, containerId: executionRef };
    case "sandbox":
      return { kind: "sandbox", connectionId: form.connectionId, image: executionRef };
  }
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
  // A container to run in and an image to create one from are both named by the user; neither has a default worth
  // inventing, and a target missing its reference cannot run a single operation.
  const executionRef = form.executionRef.trim();
  if ((form.executionKind === "container" || form.executionKind === "sandbox") && !executionRef) {
    problems.push("no-execution-ref");
  }
  if (!resolved || problems.length > 0) {
    return { problems };
  }
  const target = executionTargetFor(form, executionRef);
  return {
    problems,
    options: {
      connectionId: form.connectionId,
      workspacePath,
      modelId,
      providerId: resolved.id,
      // The wire shape and the credential shape both follow from the provider, so they travel with it: the
      // gateway signs Anthropic with x-api-key and pi speaks /v1/messages to it.
      providerKind: resolved.kind,
      upstreamAuth: resolved.auth,
      upstreamBaseUrl: resolved.baseURL,
      // No key travels with this: it lives in the OS keychain, unreadable here, and naming the provider is what
      // makes the host compose the gateway's private env file from it.
      appVersion: context.appVersion,
      egress: form.egress,
      ...(target ? { executionTarget: target } : {}),
    },
  };
}
