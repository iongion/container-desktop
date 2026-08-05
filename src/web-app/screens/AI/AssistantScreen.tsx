// The full-page Assistant surface — the ONE conversation the app has. The session runs in a container pair
// (useCodingAgentStore) and the transcript, cards, empty state and composer all come from the shared
// <AssistantSession>, which also backs the summonable quake console, so the same conversation looks and
// behaves the same wherever it is opened. This screen adds only what a full page can carry: the session
// summary and the header's start/stop actions.
import { Button, ButtonGroup, Callout, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { getHostRuntime } from "@/platform/provider";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { AssistantSession } from "@/web-app/components/ai/AssistantSession";
import { EngineCell } from "@/web-app/components/EngineCell";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { AssistantActionsMenu } from "./AssistantActionsMenu";
import { ScreenHeaderSectionsTabBar } from "./ScreenHeader";

import "./AssistantScreen.css";

export const ID = "ai.assistant";
export const Title = i18n.t("Assistant");

export interface ScreenProps extends AppScreenProps {}

// What the start drawer collapsed into once the session is up: where it runs and in what. It rides in the
// screen header rather than in a bar of its own — a second full-width strip repeated what the header already
// framed. The MODEL is deliberately absent: the composer footer names it, next to where it is chosen. The
// workspace is a button rather than a path, because the path is long enough to crowd out everything else and
// what the user actually wants from it is to open the folder.
const SessionSummary: React.FC = () => {
  const spec = useCodingAgentStore((state) => state.spec);
  const connectionId = useCodingAgentStore((state) => state.connectionId);
  const connections = useAppStore((state) => state.connections);
  const connection = connections.find((item) => item.id === connectionId);
  const { t } = useTranslation();
  const workspacePath = spec?.workspacePath;
  const onOpenWorkspace = useCallback(() => {
    if (workspacePath) void getHostRuntime().windowControl.openPath(workspacePath);
  }, [workspacePath]);
  // VS Code may simply not be installed, and the vscode:// handler answers that. Saying so beats a button that
  // looks like it did something.
  const onOpenInVSCode = useCallback(async () => {
    if (!workspacePath) return;
    const opened = await getHostRuntime().dialogs.openInVSCode(workspacePath);
    if (!opened) {
      Notification.show({ message: t("Unable to open VS Code on this machine."), intent: Intent.WARNING });
    }
  }, [workspacePath, t]);
  return (
    <div className="AssistantSessionSummary" data-status="ready">
      <span className="AssistantSessionDot" />
      {connection ? <EngineCell engine={connection.engine} connectionName={connection.name} /> : null}
      {/* Two ways to open the SAME folder, so they read as one control rather than two loose buttons. */}
      <ButtonGroup variant="minimal" className="AssistantSessionWorkspaceActions">
        <Button
          className="AssistantSessionWorkspace"
          size="small"
          icon={IconNames.FOLDER_OPEN}
          text={t("Workspace")}
          title={workspacePath}
          disabled={!workspacePath}
          onClick={onOpenWorkspace}
        />
        <Button
          className="AssistantSessionEditor"
          size="small"
          intent={Intent.PRIMARY}
          icon={IconNames.CODE}
          text={t("VS Code")}
          title={t("Open {{path}} as a VS Code workspace", { path: workspacePath ?? "" })}
          disabled={!workspacePath}
          onClick={() => void onOpenInVSCode()}
        />
      </ButtonGroup>
      <span className="AssistantSessionContainer">{spec?.agentContainerName}</span>
    </div>
  );
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const status = useCodingAgentStore((state) => state.status);
  const error = useCodingAgentStore((state) => state.error);
  const refreshResources = useCodingAgentStore((state) => state.refreshResources);
  const ready = status === "ready";

  const onReload = useCallback(() => void refreshResources(), [refreshResources]);

  // Focus the composer on mount so the user can type immediately (mirrors the console's focus-on-open). Only
  // once a session exists — before that the session shows its start affordance instead of an input.
  useEffect(() => {
    if (!ready) return;
    const root = rootRef.current;
    requestAnimationFrame(() => root?.querySelector<HTMLTextAreaElement>(".AIComposerInput")?.focus());
  }, [ready]);

  return (
    <div className="AppScreen AssistantScreen" data-screen={ID} ref={rootRef}>
      <AppScreenHeader
        withoutSearch
        rightContent={
          <AssistantActionsMenu
            navigation={<ScreenHeaderSectionsTabBar expand isActive={(screen) => screen === ID} />}
            onReload={onReload}
          />
        }
      >
        {/* The header's LEFT group (children → .NavbarLeft), where a screen's own context belongs. */}
        {ready ? <SessionSummary /> : null}
      </AppScreenHeader>
      <div className="AppScreenContent">
        {/* A start failure outlives the drawer that reported it: closing the form must not hide why it failed. */}
        {status === "error" && error ? (
          <Callout intent={Intent.DANGER} icon={IconNames.ERROR} className="AssistantSessionError">
            {error}
          </Callout>
        ) : null}
        {/* Only the session SUMMARY is the screen's own, and it rides in the header; the conversation —
            including what to show when there is no session yet — belongs to the shared session, which the
            quake console renders too. */}
        <AssistantSession composerPlaceholder={t("Message the assistant… (Enter to send, Shift+Enter for newline)")} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/assistant",
};
Screen.Metadata = {
  LeftIcon: IconNames.CHAT,
  RequiresAI: true,
  ExcludeFromSidebar: true, // reached via the header AI menu, not the sidebar
};
