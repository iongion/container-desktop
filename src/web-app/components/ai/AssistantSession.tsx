// The shared assistant session: the ordered transcript (prose, command steps, results, approval cards,
// tool → generative-UI cards) plus the AIComposer. Rendered by BOTH the full-page AssistantScreen and the
// summonable quake console, against the SAME useAIStore Session, so a session is continuous across
// surfaces. Layout-only: it fills its parent as a flex column; the surface (screen vs console body) owns the
// outer chrome. Extracted from AssistantScreen so the two surfaces can never drift.
import { Button, Callout, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { latestAssistantResponse } from "@/ai-system/core/sessionExport";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type {
  AssistantCommandExecutionResult,
  AssistantCommandSurface,
  BuiltinAssistantCommandId,
} from "@/ai-system/ui/core/commands/commandTypes";
import { modelFromCommandArgument } from "@/ai-system/ui/core/commands/modelArgument";
import {
  readProjectTrustAnswer,
  readScopedModelsAnswer,
  readSessionSettingsAnswer,
  readSessionTreeAnswer,
} from "@/ai-system/ui/core/commands/piCommandAnswers";
import { resolveScreenPrompt } from "@/template/screenPrompts";
import { AIComposer, type ParsedAssistantCommand } from "@/web-app/components/AIComposer";
import { AssistantContextDrawer, type AssistantContextSection } from "@/web-app/components/ai/AssistantContextDrawer";
import { AssistantDiagnosticsDrawer } from "@/web-app/components/ai/AssistantDiagnosticsDrawer";
import {
  AssistantSessionTreeDrawer,
  type AssistantSessionTreeView,
} from "@/web-app/components/ai/AssistantSessionTreeDrawer";
import { AssistantSettingsDrawer, type AssistantSettingsView } from "@/web-app/components/ai/AssistantSettingsDrawer";
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
import { SessionExportDrawer } from "@/web-app/components/ai/SessionExportDrawer";
import { ThinkingStatus } from "@/web-app/components/ai/ThinkingStatus";
import { WorkspaceChangesDrawer, type WorkspaceChangesView } from "@/web-app/components/ai/WorkspaceChangesDrawer";
import { useAssistantSkills } from "@/web-app/hooks/useAssistantSkills";
import { Notification } from "@/web-app/Notification";
import { StartSessionDrawer } from "@/web-app/screens/AI/StartSessionDrawer";
import { getSettingsUrl } from "@/web-app/screens/Settings/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import { useUIStore } from "@/web-app/stores/uiStore";
import { useAIStore } from "@/web-app/stores/useAIStore";

import "./AssistantSession.css";

export interface AssistantSessionProps {
  // Extra class on the flex-column root (e.g. the console passes one to scope tweaks).
  className?: string;
  composerPlaceholder?: string;
  surface?: AssistantCommandSurface;
}

// Which of pi's commands a picked row goes back to. A session is answered by `/resume`, not by a tree move.
const PICKED_COMMAND: Record<AssistantSessionTreeView["kind"], string> = {
  fork: "fork",
  tree: "tree",
  sessions: "resume",
};

export const AssistantSession: React.FC<AssistantSessionProps> = ({
  className,
  composerPlaceholder,
  surface = "assistant",
}) => {
  const { t } = useTranslation();

  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const lifecycle = useAIStore((s) => s.lifecycle);
  const sessions = useAIStore((s) => s.sessions);
  const views = useAIStore((s) => s.views);
  const recoveryErrors = useAIStore((s) => s.recoveryErrors);
  const submitMessage = useAIStore((s) => s.submitMessage);
  const newSession = useAIStore((s) => s.newSession);
  const resolveApproval = useAIStore((s) => s.resolveApproval);
  const cancel = useAIStore((s) => s.cancel);
  // Extension chrome and dialogs are pi-session state with no place in the neutral SessionView, and since the
  // Assistant surface IS the pi session they are read from its store directly rather than widening AIState.
  const extensionChrome = useCodingAgentStore((s) => s.chrome);
  const pendingDialog = useCodingAgentStore((s) => s.pendingDialog);
  const respondToRequest = useCodingAgentStore((s) => s.respondToRequest);
  // There is exactly ONE session behind every surface, so "is there anything to talk to?" is the session's own
  // question. Without a session the composer would accept text and silently drop it (submit returns early with
  // no bridge client), so the surface offers a way to start one instead of a dead input.
  const sessionStatus = useCodingAgentStore((s) => s.status);
  const noSession = sessionStatus !== "ready";
  // What the running session is answering with, so the composer's chip reflects it rather than a saved default — and
  // switching it re-points THIS conversation instead of describing the next one.
  const sessionModel = useCodingAgentStore((s) => s.sessionModel);
  const sessionProviderId = useCodingAgentStore((s) => s.lastStart?.providerId);
  const switchModel = useCodingAgentStore((s) => s.switchModel);
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
  const defaultProvider = useAppStore((s) => s.userSettings.ai?.defaultProvider) ?? DEFAULT_AI_SETTINGS.defaultProvider;
  // Per-screen starter questions for the empty state (chips), from the current screen the user is on.
  const screenId = useUIStore((s) => s.currentScreen.id);
  const suggestions = resolveScreenPrompt(screenId).suggestions;

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const view = activeSessionId ? views[activeSessionId] : undefined;
  const recoveryError = activeSessionId ? recoveryErrors[activeSessionId] : undefined;
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
  // The points a bare `/fork`, `/tree` or `/resume` answered with, held until the user picks one.
  const [sessionPoints, setSessionPoints] = useState<AssistantSessionTreeView>();
  // The state a bare `/settings`, `/trust` or `/scoped-models` answered with.
  const [settingsView, setSettingsView] = useState<AssistantSettingsView>();

  // Stable, because the settings drawer reads the rest of pi's state once on open.
  const runPiCommand = useCallback(
    (name: string, args: string) => useCodingAgentStore.getState().runPiCommand(name, args),
    [],
  );

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
        // A bare pi command is a QUESTION: the session answers with what it is about and waits. Without reading the
        // answer here it is discarded and the command looks inert, which is what every one of these did before.
        const points = readSessionTreeAnswer(result.data);
        if (points) {
          setSessionPoints(points);
          return undefined;
        }
        const settings = readSessionSettingsAnswer(result.data);
        if (settings) {
          setSettingsView({ kind: "settings", settings });
          return undefined;
        }
        const trust = readProjectTrustAnswer(result.data);
        if (trust) {
          setSettingsView({ kind: "trust", trust });
          return undefined;
        }
        const scoped = readScopedModelsAnswer(result.data);
        if (scoped) setSettingsView({ kind: "scoped-models", models: scoped });
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
          await newSession();
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
        // pi's `/import`: the app picks the JSONL off the host and the session imports it, which replaces the
        // conversation on screen with the one in the file.
        "session.import": async () => {
          if (await useCodingAgentStore.getState().importSession()) {
            Notification.show({ message: t("Session imported"), intent: Intent.SUCCESS });
          }
        },
        // pi's `/share`, without pi's gist: the conversation as one standalone HTML file, saved where the user says.
        "session.share": async () => {
          if (await useCodingAgentStore.getState().shareSession()) {
            Notification.show({ message: t("Conversation saved as HTML"), intent: Intent.SUCCESS });
          }
        },
        // pi's `/login` and `/logout` are provider auth, which is the app's: it owns the settings and the keychain,
        // and the agent container never holds a credential. `/login` opens where the key is entered; `/logout`
        // removes it, behind the palette's own confirmation.
        "provider.login": () => {
          navigate(getSettingsUrl("ai"));
          return undefined;
        },
        "provider.logout": async (command) => {
          const provider = command.rawArguments.trim();
          if (!provider) throw new Error(t("Name the provider to sign out of: /logout <provider>"));
          await window.AI.clearKey(provider);
          Notification.show({ message: t("Provider authentication removed"), intent: Intent.SUCCESS });
        },
        // pi's `/model`: bare it opens the selector, and with pi's own `<provider/model>` argument it switches
        // straight away. Either way the session is re-pointed in place — no container restart, no lost conversation.
        "model.open": async (command) => {
          const store = useCodingAgentStore.getState();
          const target = modelFromCommandArgument(command.rawArguments, store.lastStart?.providerId ?? "");
          if (!target) return { kind: "open-model-picker" };
          await store.switchModel(target, store.lastStart?.providerId);
          Notification.show({ message: t("Now answering with {{model}}", { model: target }), intent: Intent.SUCCESS });
          return undefined;
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
    [cancel, navigate, submitMessage, newSession, reloadSkills, t, view],
  );

  const composerCommands = useMemo(
    () => ({
      registry: skillRegistry,
      sessionId: activeSessionId,
      context: {
        surface,
        hostStatus: lifecycle === "hydrating" ? ("connecting" as const) : ("ready" as const),
        hasSession: !!activeSessionId,
        sessionPhase: composerPhase,
      },
      onExecute: executeCommand,
    }),
    [activeSessionId, composerPhase, executeCommand, lifecycle, skillRegistry, surface],
  );

  // Starter chips send straight to the running session, like any other submission.
  const onStarter = (text: string) => {
    void submitMessage(text);
  };

  // A running session ALWAYS owns the chip: showing a saved default while something else is answering is the very
  // thing this replaces. The start form always records which source it resolved, so the fallback is only reached by a
  // session composed by hand — and the model that is answering is still the truth worth showing.
  const composerSession = useMemo(
    () =>
      sessionModel
        ? {
            providerId: sessionProviderId ?? defaultProvider,
            model: sessionModel,
            onSelectModel: switchModel,
          }
        : undefined,
    [sessionModel, sessionProviderId, defaultProvider, switchModel],
  );

  const timelineContext: AssistantTimelineContext = {
    view,
    activeSession,
    activeSessionId: activeSessionId ?? undefined,
    rememberApprovals: mode === "remember",
    onResolveApproval: resolveApproval,
    onOpenWorkspaceChanges: () => setWorkspaceChangesView("diff"),
  };

  const showJump = !atBottom && items.length > 0;

  return (
    <div className={`AssistantSession${className ? ` ${className}` : ""}`}>
      <PluginChromeSurface slot="header" />
      <div className="AssistantScroll">
        <PluginFocusSurface variant="overlay" />
        <div className="AssistantTranscript" ref={scrollRef} onScroll={onScroll}>
          {recoveryError ? <Callout intent={Intent.DANGER}>{recoveryError}</Callout> : null}
          {noSession ? (
            // Owned by the SESSION, not by the screen: the console renders this same component, so a session
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
            statusLeading={
              streaming && !extensionChrome.working?.hidden ? (
                <ThinkingStatus message={extensionChrome.working?.message} />
              ) : null
            }
            showPermissionMode
            commands={composerCommands}
            draft={extensionChrome.editorDraft}
            session={composerSession}
          />
          <ExtensionWidgetStrip widgets={extensionChrome.widgets} placement="belowEditor" />
          <PluginWidgetSurfaces placement="belowEditor" />
        </div>
      )}
      {startOpen ? <StartSessionDrawer onClose={() => setStartOpen(false)} /> : null}
      {exportOpen && activeSession && view ? (
        <SessionExportDrawer session={activeSession} view={view} onClose={() => setExportOpen(false)} />
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
        <AssistantDiagnosticsDrawer providerId={activeSession?.providerId} onClose={() => setDiagnosticsOpen(false)} />
      ) : null}
      {workspaceChangesView ? (
        <WorkspaceChangesDrawer initialView={workspaceChangesView} onClose={() => setWorkspaceChangesView(undefined)} />
      ) : null}
      {sessionPoints ? (
        <AssistantSessionTreeDrawer
          view={sessionPoints}
          onPick={async (id) => {
            // The SAME command the user typed, now with the id it was asking for. A refusal comes back as a reason
            // for the drawer to show rather than as a throw, because a cancelled branch switch is an answer.
            const answer = await runPiCommand(PICKED_COMMAND[sessionPoints.kind], id);
            return answer.ok ? undefined : answer.error;
          }}
          onClose={() => setSessionPoints(undefined)}
        />
      ) : null}
      {settingsView ? (
        <AssistantSettingsDrawer view={settingsView} onRun={runPiCommand} onClose={() => setSettingsView(undefined)} />
      ) : null}
    </div>
  );
};
