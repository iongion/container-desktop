// The shared assistant thread: the ordered transcript (prose, command steps, results, approval cards,
// tool → generative-UI cards) plus the AIComposer. Rendered by BOTH the full-page AssistantScreen and the
// summonable quake console, against the SAME useAIStore Thread, so a thread is continuous across
// surfaces. Layout-only: it fills its parent as a flex column; the surface (screen vs console body) owns the
// outer chrome. Extracted from AssistantScreen so the two surfaces can never drift.
import { Button, Callout, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isAccessProfileId } from "@/ai-system/core/accessProfiles";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { isReasoningLevel } from "@/ai-system/core/reasoning";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { latestAssistantResponse } from "@/ai-system/core/threadExport";
import type { AISettings } from "@/ai-system/core/types";
import type {
  AssistantCommandExecutionResult,
  AssistantCommandSurface,
  BuiltinAssistantCommandId,
} from "@/ai-system/ui/core/commands/commandTypes";
import { resolveScreenPrompt } from "@/template/screenPrompts";
import { AIComposer, type ParsedAssistantCommand } from "@/web-app/components/AIComposer";
import { AssistantContextDrawer, type AssistantContextSection } from "@/web-app/components/ai/AssistantContextDrawer";
import { AssistantDiagnosticsDrawer } from "@/web-app/components/ai/AssistantDiagnosticsDrawer";
import { AssistantSkillsDrawer } from "@/web-app/components/ai/AssistantSkillsDrawer";
import { type AssistantTimelineContext, AssistantTimelineItem } from "@/web-app/components/ai/AssistantTimelineItem";
import { ExtensionDialog } from "@/web-app/components/ai/ExtensionDialog";
import { ExtensionStatusStrip, ExtensionWidgetStrip } from "@/web-app/components/ai/ExtensionWidgetStrip";
import {
  PluginChromeSurface,
  PluginEditorSurface,
  PluginFocusSurface,
  PluginWidgetSurfaces,
  usePiThemeSync,
} from "@/web-app/components/ai/PluginSurfaces";
import type { ProjectContextRequest } from "@/web-app/components/ai/ProjectContextPanel";
import { ThinkingStatus } from "@/web-app/components/ai/ThinkingStatus";
import { ThreadExportDrawer } from "@/web-app/components/ai/ThreadExportDrawer";
import { WorkspaceChangesDrawer, type WorkspaceChangesView } from "@/web-app/components/ai/WorkspaceChangesDrawer";
import { useAssistantSkills } from "@/web-app/hooks/useAssistantSkills";
import { Notification } from "@/web-app/Notification";
import { StartSessionDrawer } from "@/web-app/screens/AI/StartSessionDrawer";
import { getSettingsUrl } from "@/web-app/screens/Settings/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
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
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  // Extension chrome and dialogs are pi-session state with no place in the neutral ThreadView, and since the
  // Assistant surface IS the pi session they are read from its store directly rather than widening AIState.
  const extensionChrome = useCodingAgentStore((s) => s.chrome);
  const pendingDialog = useCodingAgentStore((s) => s.pendingDialog);
  const respondToRequest = useCodingAgentStore((s) => s.respondToRequest);
  // There is exactly ONE session behind every surface, so "is there anything to talk to?" is the thread's own
  // question. Without a session the composer would accept text and silently drop it (submit returns early with
  // no bridge client), so the surface offers a way to start one instead of a dead input.
  const sessionStatus = useCodingAgentStore((s) => s.status);
  const noSession = sessionStatus !== "ready";
  const [startOpen, setStartOpen] = useState(false);
  usePiThemeSync();
  const setAssistantConsoleOpen = useUIStore((s) => s.setAssistantConsoleOpen);
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
  const _ai: AISettings = useAppStore((s) => s.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
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
  const [exportOpen, setExportOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [contextDrawer, setContextDrawer] = useState<{
    section: AssistantContextSection;
    projectRequest?: ProjectContextRequest;
  }>();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [workspaceChangesView, setWorkspaceChangesView] = useState<WorkspaceChangesView>();

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

  // The session was started with its provider, model, access and reasoning; a per-message binding would be a promise
  // nothing here can keep, so the composer's are read for display only and the text is what is sent.
  const onSubmit = (text: string) => submitMessage(text);

  const navigate = useCallback(
    (href: string) => {
      if (surface === "quake-console") setAssistantConsoleOpen(false);
      window.location.href = href;
    },
    [setAssistantConsoleOpen, surface],
  );

  const executeCommand = useCallback(
    async (parsed: ParsedAssistantCommand): Promise<AssistantCommandExecutionResult> => {
      // A plugin's SKILL belongs to the pi session, not the app's skill host: there is nothing here to resolve it
      // against. pi expands it itself when the prompt arrives, so the canonical text is simply sent.
      if (parsed.command.kind === "skill" && parsed.command.source.kind === "plugin-skill") {
        const text = `${parsed.command.path}${parsed.rawArguments ? ` ${parsed.rawArguments}` : ""}`;
        await submitMessage(text);
        return undefined;
      }
      // pi's own command, or one a plugin registered with pi. A `prompt`-venue command is text pi expands itself,
      // so it is simply sent; a `session`-venue one crosses the bridge and runs against pi's session. An
      // `unavailable` one never reaches here — the availability layer refuses it with pi's reason.
      if (parsed.command.kind === "pi") {
        const command = parsed.command;
        if (command.venue === "prompt") {
          const text = `${command.path}${parsed.rawArguments ? ` ${parsed.rawArguments}` : ""}`;
          await submitMessage(text);
          return undefined;
        }
        if (command.venue !== "session") {
          throw new Error(command.unavailableReason ?? t("This session cannot run that pi command"));
        }
        const result = await useCodingAgentStore.getState().runPiCommand(command.commandName, parsed.rawArguments);
        if (!result.ok) throw new Error(result.error);
        return undefined;
      }
      if (parsed.command.kind === "skill") {
        // The broker resolves and renders it — trust check, fingerprint match, tool narrowing — and the pi
        // session runs it. The transcript shows the command; the model receives the rendered body.
        const invocation = await window.AI.invokeSkill({
          skillId: parsed.command.skillId,
          expectedFingerprint: parsed.command.source.fingerprint,
          arguments: parsed.rawArguments,
        });
        await useCodingAgentStore.getState().submitSkill(invocation);
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
        // pi's own `/reload` reloads its extensions, skills, prompts, themes and context files; the app's skill
        // library is reloaded in the same breath, because one command called `/reload` that reloaded half of what
        // is loaded would be the sort of half-truth this app has been chasing out.
        reload: async () => {
          const store = useCodingAgentStore.getState();
          const session = store.client ? await store.runPiCommand("reload", "") : undefined;
          const next = await reloadSkills();
          if (session && !session.ok) throw new Error(session.error);
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
        // pi's `/new`: a pi session IS the conversation, so a fresh one means a fresh session on the same settings.
        "session.new": async () => {
          await newThread();
        },
        // pi's `/quit`: it quits pi, which here means tearing down the container pair.
        "session.quit": async () => {
          await useCodingAgentStore.getState().stop();
        },
        // pi's `/session`: its info and stats, which is exactly what the usage panel shows.
        "session.info": () => {
          setContextDrawer({ section: "usage" });
        },
        "turn.stop": async () => {
          await cancel();
        },
        "session.copy": async () => {
          const response = view ? latestAssistantResponse(view) : undefined;
          if (!response) throw new Error(t("There is no Assistant response to copy"));
          if (!navigator.clipboard?.writeText) throw new Error(t("Clipboard access is unavailable"));
          await navigator.clipboard.writeText(response);
          Notification.show({ message: t("Assistant response copied"), intent: Intent.SUCCESS });
        },
        "session.export": () => {
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
      };
      // Everything else was dispatched above; only a control command reaches the handler map.
      if (parsed.command.kind !== "control") throw new Error(t("Command is not available here"));
      return handlers[parsed.command.handlerId](parsed);
    },
    [cancel, navigate, submitMessage, newThread, reloadSkills, t, view],
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

  // Starter chips send straight to the running session, like any other submission.
  const onStarter = (text: string) => {
    void submitMessage(text);
  };

  const timelineContext: AssistantTimelineContext = {
    view,
    activeThread,
    activeThreadId: activeThreadId ?? undefined,
    rememberApprovals: mode === "remember",
    onResolveApproval: resolveApproval,
    onOpenWorkspaceChanges: () => setWorkspaceChangesView("diff"),
  };

  const showJump = !atBottom && items.length > 0;

  return (
    <div className={`AssistantThread${className ? ` ${className}` : ""}`}>
      <PluginChromeSurface slot="header" />
      <div className="AssistantScroll">
        <PluginFocusSurface variant="overlay" />
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
          {recoveryError ? <Callout intent={Intent.DANGER}>{recoveryError}</Callout> : null}
          {noSession ? (
            // Owned by the THREAD, not by the screen: the console renders this same component, so a session
            // that can only be started from the screen leaves the console a dead box. Here both surfaces
            // offer the same way in.
            <div className="AssistantEmpty AssistantEmpty--noSession">
              <NonIdealState
                icon={<Icon icon={IconNames.CHAT} size={40} />}
                title={t("No assistant session")}
                description={
                  <>
                    <p>{t("Start a session to work on a folder with the assistant.")}</p>
                    <p>
                      {t("It runs in a container on the connection you pick, and only that folder is mounted into it.")}
                    </p>
                  </>
                }
                action={
                  <Button
                    intent={Intent.SUCCESS}
                    icon={IconNames.PLAY}
                    text={t("Start session")}
                    loading={sessionStatus === "starting"}
                    onClick={() => setStartOpen(true)}
                  />
                }
              />
            </div>
          ) : items.length === 0 ? (
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

      {/* No session ⇒ no dock: its composer, plugin strips and extension dialogs all belong to a running
          session, and an input that accepts text nothing will read is worse than no input. */}
      {noSession ? null : (
        <div className="AssistantComposerDock">
          <PluginChromeSurface slot="footer" />
          <ExtensionStatusStrip statuses={extensionChrome.statuses} />
          <ExtensionWidgetStrip widgets={extensionChrome.widgets} placement="aboveEditor" />
          <PluginWidgetSurfaces placement="aboveEditor" />
          <PluginFocusSurface variant="inline" />
          <PluginEditorSurface />
          {pendingDialog ? <ExtensionDialog request={pendingDialog} onRespond={respondToRequest} /> : null}
          <AIComposer
            placeholder={composerPlaceholder ?? t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
            phase={composerPhase}
            onStop={cancel}
            onSubmit={onSubmit}
            statusLeading={streaming ? <ThinkingStatus /> : null}
            showPermissionMode
            commands={composerCommands}
            draft={extensionChrome.editorDraft}
          />
          <ExtensionWidgetStrip widgets={extensionChrome.widgets} placement="belowEditor" />
          <PluginWidgetSurfaces placement="belowEditor" />
        </div>
      )}
      {startOpen ? <StartSessionDrawer onClose={() => setStartOpen(false)} /> : null}
      {exportOpen && activeThread && view ? (
        <ThreadExportDrawer thread={activeThread} view={view} onClose={() => setExportOpen(false)} />
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
    </div>
  );
};
