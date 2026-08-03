// The shared assistant thread: the ordered transcript (prose, command steps, results, approval cards,
// tool → generative-UI cards) plus the AIComposer. Rendered by BOTH the full-page AssistantScreen and the
// summonable quake console, against the SAME useAIStore Thread, so a thread is continuous across
// surfaces. Layout-only: it fills its parent as a flex column; the surface (screen vs console body) owns the
// outer chrome. Extracted from AssistantScreen so the two surfaces can never drift.
import { Button, Callout, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AccessProfileId, isAccessProfileId } from "@/ai-system/core/accessProfiles";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { isReasoningLevel, type ReasoningLevel } from "@/ai-system/core/reasoning";
import type { RunView } from "@/ai-system/core/runEvents";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { latestAssistantResponse } from "@/ai-system/core/threadExport";
import type { ThreadConfigurationPatch } from "@/ai-system/core/threads";
import type { AISettings } from "@/ai-system/core/types";
import type { WorkerDefinition } from "@/ai-system/core/workers";
import type {
  AssistantCommandExecutionResult,
  AssistantCommandSurface,
  BuiltinAssistantCommandId,
} from "@/ai-system/ui/core/commands/commandTypes";
import { isRunActive } from "@/ai-system/ui/core/stores/runClient";
import { resolveScreenPrompt } from "@/template/screenPrompts";
import { AIComposer, type ParsedAssistantCommand } from "@/web-app/components/AIComposer";
import { AssistantContextDrawer, type AssistantContextSection } from "@/web-app/components/ai/AssistantContextDrawer";
import { AssistantDiagnosticsDrawer } from "@/web-app/components/ai/AssistantDiagnosticsDrawer";
import { AssistantSkillsDrawer } from "@/web-app/components/ai/AssistantSkillsDrawer";
import { type AssistantTimelineContext, AssistantTimelineItem } from "@/web-app/components/ai/AssistantTimelineItem";
import type { ProjectContextRequest } from "@/web-app/components/ai/ProjectContextPanel";
import { ThinkingStatus } from "@/web-app/components/ai/ThinkingStatus";
import { ThreadBranchDrawer, type ThreadBranchSource } from "@/web-app/components/ai/ThreadBranchDrawer";
import { ThreadCompactionDrawer } from "@/web-app/components/ai/ThreadCompactionDrawer";
import { ThreadExportDrawer } from "@/web-app/components/ai/ThreadExportDrawer";
import { ThreadSelector } from "@/web-app/components/ai/ThreadSelector";
import { resolveThreadReference } from "@/web-app/components/ai/threadHistory";
import { WorkspaceChangesDrawer, type WorkspaceChangesView } from "@/web-app/components/ai/WorkspaceChangesDrawer";
import { useAssistantSkills } from "@/web-app/hooks/useAssistantSkills";
import { Notification } from "@/web-app/Notification";
import { CreateDrawer as RunCreateDrawer } from "@/web-app/screens/AI/Run";
import { getRunsUrl, getRunUrl } from "@/web-app/screens/AI/Run/Navigation";
import { useRunClient } from "@/web-app/screens/AI/Run/runClientInstance";
import { resolveRunReference } from "@/web-app/screens/AI/Run/runReference";
import { StopDrawer as RunStopDrawer } from "@/web-app/screens/AI/Run/StopDrawer";
import { CreateDrawer as WorkerCreateDrawer } from "@/web-app/screens/AI/Worker";
import { getWorkersUrl } from "@/web-app/screens/AI/Worker/Navigation";
import { resolveWorkerReference } from "@/web-app/screens/AI/Worker/workerReference";
import { getSettingsUrl } from "@/web-app/screens/Settings/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import { useUIStore } from "@/web-app/stores/uiStore";
import { useAIStore } from "@/web-app/stores/useAIStore";

import "./AssistantThread.css";

export interface AssistantThreadProps {
  // Extra class on the flex-column root (e.g. the console passes one to scope tweaks).
  className?: string;
  composerPlaceholder?: string;
  surface?: AssistantCommandSurface;
}

export const AssistantThread: React.FC<AssistantThreadProps> = ({
  className,
  composerPlaceholder,
  surface = "assistant",
}) => {
  const { t } = useTranslation();

  const activeThreadId = useAIStore((s) => s.activeThreadId);
  const lifecycle = useAIStore((s) => s.lifecycle);
  const threads = useAIStore((s) => s.threads);
  const views = useAIStore((s) => s.views);
  const recoveryErrors = useAIStore((s) => s.recoveryErrors);
  const submitMessage = useAIStore((s) => s.submitMessage);
  const newThread = useAIStore((s) => s.newThread);
  const renameThread = useAIStore((s) => s.renameThread);
  const configureThread = useAIStore((s) => s.configureThread);
  const previewThreadBranch = useAIStore((s) => s.previewThreadBranch);
  const setActiveThread = useAIStore((s) => s.setActiveThread);
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  const setAssistantConsoleOpen = useUIStore((s) => s.setAssistantConsoleOpen);
  const { runClient, state: runState } = useRunClient();
  const {
    snapshot: skillSnapshot,
    registry: skillRegistry,
    loading: skillsLoading,
    error: skillsError,
    reload: reloadSkills,
    setProjectSourceEnabled,
    setProjectSkillTrust,
  } = useAssistantSkills();
  const mode: AIPermissionMode = useAppStore((s) => s.userSettings.ai?.permissionMode) ?? "ask";
  const ai: AISettings = useAppStore((s) => s.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  // Per-screen starter questions for the empty state (chips), from the current screen the user is on.
  const screenId = useUIStore((s) => s.currentScreen.id);
  const suggestions = resolveScreenPrompt(screenId).suggestions;

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const view = activeThreadId ? views[activeThreadId] : undefined;
  const recoveryError = activeThreadId ? recoveryErrors[activeThreadId] : undefined;
  const items = view?.timeline ?? [];
  const streamingContent = view?.streamingAssistant?.content ?? "";
  const phase = view?.phase ?? "idle";
  const pendingApproval = items.some(
    (item) => item.kind === "approval" && (item.status === "pending" || item.status === "resolving"),
  );
  const composerPhase = pendingApproval ? "awaiting-approval" : phase;
  const streaming =
    !pendingApproval && (phase === "model" || phase === "tool" || phase === "interrupting" || phase === "stopping");

  // Auto-follow ("magnetized") keeps the view pinned to the latest output. Scrolling up demagnetizes it
  // so the user can read past output while the model keeps streaming below; returning to the bottom (or
  // pressing the jump button) re-magnetizes. atBottom drives the button's visibility.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [threadHistoryOpen, setThreadHistoryOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [branchSource, setBranchSource] = useState<ThreadBranchSource>();
  const [compactionRequest, setCompactionRequest] = useState<{
    thread: NonNullable<typeof activeThread>;
    instructions?: string;
  }>();
  const [checkpointMessageIds, setCheckpointMessageIds] = useState<Set<string>>(() => new Set());
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [contextDrawer, setContextDrawer] = useState<{
    section: AssistantContextSection;
    projectRequest?: ProjectContextRequest;
  }>();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [workspaceChangesView, setWorkspaceChangesView] = useState<WorkspaceChangesView>();
  const [workerEditor, setWorkerEditor] = useState<WorkerDefinition | null>();
  const [runGoal, setRunGoal] = useState<string>();
  const [runToStop, setRunToStop] = useState<RunView>();

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (autoFollow && (items.length > 0 || streamingContent.length > 0)) {
      scrollToBottom();
    }
  }, [items, streamingContent, autoFollow, scrollToBottom]);

  useEffect(() => {
    setCheckpointMessageIds(new Set());
    if (!activeThreadId || phase !== "idle" || items.length === 0) return;
    let current = true;
    void previewThreadBranch(activeThreadId)
      .then((preview) => {
        if (current) setCheckpointMessageIds(new Set(preview.checkpoints.map(({ messageId }) => messageId)));
      })
      .catch(() => {
        if (current) setCheckpointMessageIds(new Set());
      });
    return () => {
      current = false;
    };
  }, [activeThreadId, items.length, phase, previewThreadBranch]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(near);
    setAutoFollow(near); // scrolling away demagnetizes; returning to the bottom re-magnetizes
  }, []);

  const jumpToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom]);

  const onSubmit = (
    text: string,
    bindings: {
      providerId: string;
      model: string;
      accessProfile: AccessProfileId;
      reasoningLevel: ReasoningLevel;
    },
  ) => {
    return submitMessage(text, bindings);
  };

  const onThreadConfigurationChange = useCallback(
    async (patch: ThreadConfigurationPatch) => {
      if (!activeThreadId) throw new Error(t("Start or select a Thread first"));
      await configureThread(activeThreadId, patch);
    },
    [activeThreadId, configureThread, t],
  );

  const openThreadHistory = useCallback((query = "") => {
    setThreadQuery(query);
    setThreadHistoryOpen(true);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      if (surface === "quake-console") setAssistantConsoleOpen(false);
      window.location.href = href;
    },
    [setAssistantConsoleOpen, surface],
  );

  const runs = useMemo(
    () => runState.order.map((runId) => runState.runs[runId]).filter((run): run is RunView => !!run),
    [runState.order, runState.runs],
  );

  const executeCommand = useCallback(
    async (parsed: ParsedAssistantCommand): Promise<AssistantCommandExecutionResult> => {
      if (parsed.command.kind === "skill") {
        if (!activeThreadId) throw new Error(t("Start or select a Thread first"));
        await window.AI.invokeSkill({
          threadId: activeThreadId,
          skillId: parsed.command.skillId,
          expectedFingerprint: parsed.command.source.fingerprint,
          arguments: parsed.rawArguments,
        });
        return undefined;
      }
      type Handler = (
        command: ParsedAssistantCommand,
      ) => AssistantCommandExecutionResult | Promise<AssistantCommandExecutionResult>;
      const handlers: Record<BuiltinAssistantCommandId, Handler> = {
        help: (command) => ({ kind: "open-command-palette", query: command.rawArguments }),
        "skills.open": () => {
          setSkillsOpen(true);
        },
        "skills.reload": async () => {
          const next = await reloadSkills();
          Notification.show({
            message: t("{{count}} skills loaded", { count: next.skills.length }),
            intent: Intent.SUCCESS,
          });
        },
        "context.usage": () => {
          setContextDrawer({ section: "usage" });
        },
        "context.tools": () => {
          setContextDrawer({ section: "tools" });
        },
        "diagnostics.open": () => {
          setDiagnosticsOpen(true);
        },
        "changes.status": () => {
          setWorkspaceChangesView("status");
        },
        "changes.diff": () => {
          setWorkspaceChangesView("diff");
        },
        "memory.list": () => {
          setContextDrawer({ section: "project", projectRequest: { view: "memory" } });
        },
        "memory.add": (command) => {
          setContextDrawer({
            section: "project",
            projectRequest: { view: "memory", memoryDraft: command.rawArguments },
          });
        },
        "memory.remove": (command) => {
          setContextDrawer({
            section: "project",
            projectRequest: { view: "memory", memoryId: command.rawArguments },
          });
        },
        "memory.clear": () => {
          setContextDrawer({
            section: "project",
            projectRequest: { view: "memory", action: "clear-memory" },
          });
        },
        "rules.list": () => {
          setContextDrawer({ section: "project", projectRequest: { view: "rules" } });
        },
        "rules.init": () => {
          setContextDrawer({
            section: "project",
            projectRequest: { view: "rules" },
          });
        },
        "thread.list": () => {
          openThreadHistory();
        },
        "thread.new": async () => {
          await newThread();
        },
        "thread.switch": (command) => {
          const reference = command.args[0] ?? "";
          const resolved = resolveThreadReference(threads, reference);
          if (resolved.kind === "resolved") setActiveThread(resolved.thread.id);
          else openThreadHistory(reference);
        },
        "thread.rename": async (command) => {
          if (activeThreadId) await renameThread(activeThreadId, command.args[0] ?? "");
        },
        "thread.branch": (command) => {
          if (!activeThread || !view) throw new Error(t("Start or select a Thread first"));
          setBranchSource({ thread: activeThread, view, checkpointReference: command.args[0] });
        },
        "thread.compact": (command) => {
          if (!activeThread) throw new Error(t("Start or select a Thread first"));
          setCompactionRequest({ thread: activeThread, instructions: command.rawArguments || undefined });
        },
        "thread.delete": (command) => {
          const reference = command.args[0];
          const active = threads.find((thread) => thread.id === activeThreadId);
          openThreadHistory(reference ?? active?.title ?? "");
        },
        "thread.stop": async () => {
          await cancel();
        },
        "thread.copy": async () => {
          const response = view ? latestAssistantResponse(view) : undefined;
          if (!response) throw new Error(t("There is no Assistant response to copy"));
          if (!navigator.clipboard?.writeText) throw new Error(t("Clipboard access is unavailable"));
          await navigator.clipboard.writeText(response);
          Notification.show({ message: t("Assistant response copied"), intent: Intent.SUCCESS });
        },
        "thread.export": () => {
          setExportOpen(true);
          return undefined;
        },
        "model.open": () => ({ kind: "open-model-picker" }),
        "access.set": (command) => {
          const value = command.args[0]?.toLowerCase();
          if (!value) return { kind: "open-access-profile" };
          if (!isAccessProfileId(value)) throw new Error(t("Unknown access profile: {{value}}", { value }));
          return { kind: "set-access-profile", value };
        },
        "reasoning.set": (command) => {
          const value = command.args[0]?.toLowerCase();
          if (!value) return { kind: "open-reasoning-level" };
          if (!isReasoningLevel(value)) throw new Error(t("Unknown reasoning level: {{value}}", { value }));
          return { kind: "set-reasoning-level", value };
        },
        "permissions.open": () => {
          navigate(getSettingsUrl("ai"));
          return undefined;
        },
        "worker.list": () => {
          useUIStore.getState().setSearch("ai.workers", "");
          navigate(getWorkersUrl());
        },
        "worker.show": async (command) => {
          const reference = command.args[0] ?? "";
          const resolved = resolveWorkerReference((await window.AI.listWorkers()).workers, reference);
          if (resolved.kind === "resolved") setWorkerEditor(resolved.worker);
          else {
            useUIStore.getState().setSearch("ai.workers", reference);
            navigate(getWorkersUrl());
          }
        },
        "worker.create": () => {
          setWorkerEditor(null);
          return undefined;
        },
        "run.start": (command) => {
          setRunGoal(command.args[0] ?? "");
          return undefined;
        },
        "run.list": () => {
          useUIStore.getState().setSearch("ai.runs", "");
          navigate(getRunsUrl());
        },
        "run.show": (command) => {
          const reference = command.args[0] ?? "";
          const resolved = resolveRunReference(runs, reference);
          if (resolved.kind === "resolved") navigate(getRunUrl(resolved.run.runId));
          else {
            useUIStore.getState().setSearch("ai.runs", reference);
            navigate(getRunsUrl());
          }
        },
        "run.stop": (command) => {
          const resolved = resolveRunReference(runs, command.args[0] ?? "");
          if (resolved.kind !== "resolved") throw new Error(t("Run ID or Goal is not unique"));
          if (!isRunActive(resolved.run)) throw new Error(t("Run is not active"));
          setRunToStop(resolved.run);
        },
      };
      return handlers[parsed.command.handlerId](parsed);
    },
    [
      activeThreadId,
      activeThread,
      cancel,
      navigate,
      newThread,
      openThreadHistory,
      reloadSkills,
      renameThread,
      runs,
      setActiveThread,
      t,
      threads,
      view,
    ],
  );

  const composerCommands = useMemo(
    () => ({
      registry: skillRegistry,
      threadId: activeThreadId,
      context: {
        surface,
        hostStatus: lifecycle === "hydrating" ? ("connecting" as const) : ("ready" as const),
        hasThread: !!activeThreadId,
        threadPhase: composerPhase,
      },
      onExecute: executeCommand,
    }),
    [activeThreadId, composerPhase, executeCommand, lifecycle, skillRegistry, surface],
  );

  // Starter chips send immediately with the saved default provider/model (the same seed the composer uses).
  const onStarter = (text: string) => {
    void submitMessage(text, {
      providerId: ai.defaultProvider,
      model: ai.providers?.[ai.defaultProvider]?.model ?? "",
    });
  };

  const timelineContext: AssistantTimelineContext = {
    view,
    activeThread,
    activeThreadId: activeThreadId ?? undefined,
    checkpointMessageIds,
    rememberApprovals: mode === "remember",
    onBranch: setBranchSource,
    onResolveApproval: resolveApproval,
    onOpenWorkspaceChanges: () => setWorkspaceChangesView("diff"),
  };

  const showJump = !atBottom && items.length > 0;

  return (
    <div className={`AssistantThread${className ? ` ${className}` : ""}`}>
      <ThreadSelector
        control={{
          open: threadHistoryOpen,
          query: threadQuery,
          onOpenChange: (open) => {
            setThreadHistoryOpen(open);
            if (!open) setThreadQuery("");
          },
        }}
      />
      <div className="AssistantScroll">
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
          {recoveryError ? <Callout intent={Intent.DANGER}>{recoveryError}</Callout> : null}
          {items.length === 0 ? (
            <div className="AssistantEmpty">
              <NonIdealState icon={<Icon icon={IconNames.CHAT} size={40} />} title={t("What can I help you with?")} />
              {suggestions.length > 0 ? (
                <div className="AssistantStarters">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="AssistantStarterChip" onClick={() => onStarter(s)}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            items.map((item, timelineIndex) => (
              <AssistantTimelineItem
                key={item.id}
                item={item}
                timelineIndex={timelineIndex}
                context={timelineContext}
              />
            ))
          )}
        </div>
        {showJump ? (
          <Button
            className={`AssistantJump${streaming ? " AssistantJump--blink" : ""}`}
            icon={IconNames.DOUBLE_CHEVRON_DOWN}
            title={t("Jump to latest")}
            aria-label={t("Jump to latest")}
            onClick={jumpToBottom}
          />
        ) : null}
      </div>

      <div className="AssistantComposerDock">
        <AIComposer
          placeholder={composerPlaceholder ?? t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
          phase={composerPhase}
          onStop={cancel}
          onSubmit={onSubmit}
          statusLeading={streaming ? <ThinkingStatus /> : null}
          showPermissionMode
          threadBindings={{
            providerId: activeThread?.providerId,
            model: activeThread?.model,
            accessProfile: activeThread?.accessProfile,
            reasoningLevel: activeThread?.reasoningLevel,
            onChange: onThreadConfigurationChange,
          }}
          commands={composerCommands}
        />
      </div>
      {exportOpen && activeThread && view ? (
        <ThreadExportDrawer thread={activeThread} view={view} onClose={() => setExportOpen(false)} />
      ) : null}
      {branchSource ? <ThreadBranchDrawer source={branchSource} onClose={() => setBranchSource(undefined)} /> : null}
      {compactionRequest ? (
        <ThreadCompactionDrawer
          thread={compactionRequest.thread}
          initialInstructions={compactionRequest.instructions}
          onClose={() => setCompactionRequest(undefined)}
        />
      ) : null}
      {skillsOpen ? (
        <AssistantSkillsDrawer
          snapshot={skillSnapshot}
          loading={skillsLoading}
          error={skillsError}
          onClose={() => setSkillsOpen(false)}
          onReload={reloadSkills}
          onSetProjectSourceEnabled={setProjectSourceEnabled}
          onSetProjectSkillTrust={setProjectSkillTrust}
        />
      ) : null}
      {contextDrawer ? (
        <AssistantContextDrawer
          view={view}
          initialSection={contextDrawer.section}
          projectRequest={contextDrawer.projectRequest}
          onClose={() => setContextDrawer(undefined)}
        />
      ) : null}
      {diagnosticsOpen ? (
        <AssistantDiagnosticsDrawer providerId={activeThread?.providerId} onClose={() => setDiagnosticsOpen(false)} />
      ) : null}
      {workspaceChangesView ? (
        <WorkspaceChangesDrawer initialView={workspaceChangesView} onClose={() => setWorkspaceChangesView(undefined)} />
      ) : null}
      {workerEditor !== undefined ? (
        <WorkerCreateDrawer worker={workerEditor ?? undefined} onClose={() => setWorkerEditor(undefined)} />
      ) : null}
      {runGoal !== undefined ? (
        <RunCreateDrawer
          initialGoal={runGoal}
          onClose={() => setRunGoal(undefined)}
          onStarted={(runId) => {
            setRunGoal(undefined);
            navigate(getRunUrl(runId));
          }}
        />
      ) : null}
      {runToStop ? (
        <RunStopDrawer
          run={runToStop}
          onClose={() => setRunToStop(undefined)}
          onStop={(runId) => runClient.stop(runId)}
        />
      ) : null}
    </div>
  );
};
