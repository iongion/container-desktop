import type {
  ThreadCompactionExecutionResult,
  ThreadCompactionPreview,
  ThreadCompactionRevision,
} from "@/ai-system/core/threadCompaction";
import type { ResolveThreadApprovalResult, SubmitThreadResult, ThreadView } from "@/ai-system/core/threadEvents";
import type {
  CreateThreadRequest,
  ThreadBranchPreview,
  ThreadBranchResult,
  ThreadConfigurationPatch,
  ThreadSummary,
} from "@/ai-system/core/threads";
import type { ApprovalDecision } from "@/ai-system/core/types";
import type { IAI } from "@/ai-system/host/aiClientBridge";
import type { AIStoreDeps } from "./threadClientReducer";

export type ClientRequestInput =
  | { kind: "create"; request: CreateThreadRequest }
  | { kind: "rename"; threadId: string; title: string }
  | { kind: "configure"; threadId: string; patch: ThreadConfigurationPatch }
  | { kind: "branch-preview"; threadId: string }
  | { kind: "branch"; threadId: string; checkpointId: string; title: string }
  | { kind: "compaction-preview"; threadId: string }
  | { kind: "compact"; threadId: string; revision: ThreadCompactionRevision; instructions?: string }
  | { kind: "submit"; request: Parameters<IAI["submitToThread"]>[0] }
  | { kind: "approval"; threadId: string; approvalId: string; decision: ApprovalDecision }
  | { kind: "snapshot"; threadId: string }
  | { kind: "stop"; threadId: string }
  | { kind: "delete"; threadId: string };

export type ClientRequestOutput =
  | { kind: "create"; thread: ThreadSummary }
  | { kind: "rename"; thread: ThreadSummary }
  | { kind: "configure"; thread: ThreadSummary }
  | { kind: "branch-preview"; preview: ThreadBranchPreview }
  | { kind: "branch"; result: ThreadBranchResult }
  | { kind: "compaction-preview"; preview: ThreadCompactionPreview }
  | { kind: "compact"; result: ThreadCompactionExecutionResult }
  | { kind: "submit"; result: SubmitThreadResult }
  | { kind: "approval"; result: ResolveThreadApprovalResult }
  | { kind: "snapshot"; snapshot: ThreadView | null }
  | { kind: "stop" }
  | { kind: "delete"; result: Awaited<ReturnType<IAI["deleteThread"]>> };

export async function runRequest(deps: AIStoreDeps, input: ClientRequestInput): Promise<ClientRequestOutput> {
  const ai = deps.getAI();
  switch (input.kind) {
    case "create":
      return { kind: "create", thread: await ai.createThread(input.request) };
    case "rename":
      return { kind: "rename", thread: await ai.renameThread(input.threadId, input.title) };
    case "configure":
      return { kind: "configure", thread: await ai.configureThread(input.threadId, input.patch) };
    case "branch-preview":
      return { kind: "branch-preview", preview: await ai.previewThreadBranch(input.threadId) };
    case "branch":
      return {
        kind: "branch",
        result: await ai.branchThread(input.threadId, input.checkpointId, input.title),
      };
    case "compaction-preview":
      return { kind: "compaction-preview", preview: await ai.previewThreadCompaction(input.threadId) };
    case "compact":
      return {
        kind: "compact",
        result: await ai.compactThread(input.threadId, input.revision, input.instructions),
      };
    case "submit":
      return { kind: "submit", result: await ai.submitToThread(input.request) };
    case "approval":
      return {
        kind: "approval",
        result: await ai.resolveThreadApproval({
          threadId: input.threadId,
          approvalId: input.approvalId,
          decision: input.decision,
        }),
      };
    case "snapshot":
      return { kind: "snapshot", snapshot: await ai.getThreadSnapshot(input.threadId) };
    case "stop":
      await ai.stopThread(input.threadId);
      return { kind: "stop" };
    case "delete":
      return { kind: "delete", result: await ai.deleteThread(input.threadId) };
  }
}
