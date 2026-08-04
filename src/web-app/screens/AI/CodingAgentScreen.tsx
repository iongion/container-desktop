// The containerized pi coding agent surface: session summary, transcript, composer. The session itself lives
// in useCodingAgentStore; this screen renders it and forwards input. With no session it is an empty state and
// the header's Start CTA, which opens the start drawer.
import { Callout, Intent, NonIdealState, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { EngineCell } from "@/web-app/components/EngineCell";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { CodingAgentActionsMenu } from "./CodingAgentActionsMenu";
import { ScreenHeaderSectionsTabBar } from "./ScreenHeader";

import "./CodingAgentScreen.css";

export const ID = "ai.codingAgent";
export const Title = i18n.t("Coding Agent");

export interface ScreenProps extends AppScreenProps {}

// What the drawer collapsed into once the session is up: where it runs, on what, with which model.
const SessionBar: React.FC = () => {
  const spec = useCodingAgentStore((state) => state.spec);
  const connectionId = useCodingAgentStore((state) => state.connectionId);
  const connections = useAppStore((state) => state.connections);
  const connection = connections.find((item) => item.id === connectionId);
  return (
    <div className="CodingAgentBar" data-status="ready">
      <span className="CodingAgentStatusDot" />
      {connection ? <EngineCell engine={connection.engine} connectionName={connection.name} /> : null}
      <span className="CodingAgentWorkspace" title={spec?.workspacePath}>
        {spec?.workspacePath}
      </span>
      <span className="CodingAgentModel">{spec?.modelId}</span>
      <span className="CodingAgentBarSpacer" />
      <span className="CodingAgentContainer">{spec?.agentContainerName}</span>
    </div>
  );
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const status = useCodingAgentStore((state) => state.status);
  const error = useCodingAgentStore((state) => state.error);
  const timeline = useCodingAgentStore((state) => state.view.timeline);
  const submit = useCodingAgentStore((state) => state.submit);
  const refreshResources = useCodingAgentStore((state) => state.refreshResources);
  const [draft, setDraft] = useState("");
  const ready = status === "ready";

  const onReload = useCallback(() => void refreshResources(), [refreshResources]);

  return (
    <div className="AppScreen CodingAgentScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        rightContent={
          <CodingAgentActionsMenu
            navigation={<ScreenHeaderSectionsTabBar expand isActive={(screen) => screen === ID} />}
            onReload={onReload}
          />
        }
      />
      <div className="AppScreenContent">
        {/* A start failure outlives the drawer that reported it: closing the form must not hide why it failed. */}
        {status === "error" && error ? (
          <Callout intent={Intent.DANGER} icon={IconNames.ERROR} className="CodingAgentError">
            {error}
          </Callout>
        ) : null}
        {ready ? (
          <>
            <SessionBar />
            <div className="CodingAgentTranscript">
              {timeline.map((item) => {
                if (item.kind === "tool") {
                  return (
                    <div className="CodingAgentTool" key={item.id} data-state={item.status}>
                      <div className="CodingAgentToolName">{item.tool}</div>
                      <pre className="CodingAgentToolOutput">{item.message}</pre>
                    </div>
                  );
                }
                if (item.kind === "error") {
                  return (
                    <div className="CodingAgentError" key={item.id}>
                      {item.message}
                    </div>
                  );
                }
                if (item.kind !== "message") return null;
                return (
                  <div className={`CodingAgentMessage CodingAgentMessage--${item.role}`} key={item.id}>
                    {item.content}
                  </div>
                );
              })}
            </div>
            <TextArea
              className="CodingAgentComposer"
              value={draft}
              placeholder={t("Message the coding agent… (Enter to send, Shift+Enter for newline)")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const text = draft.trim();
                  setDraft("");
                  if (text) void submit(text);
                }
              }}
            />
          </>
        ) : (
          <NonIdealState
            className="CodingAgentEmptyState"
            icon={IconNames.CODE}
            title={t("No coding agent session")}
            description={
              <>
                <p>{t("Start a session to work on a folder with the agent.")}</p>
                <p>
                  {t("It runs in a container on the connection you pick, and only that folder is mounted into it.")}
                </p>
              </>
            }
          />
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/coding-agent",
};
Screen.Metadata = {
  LeftIcon: IconNames.CODE,
  RequiresAI: true,
  ExcludeFromSidebar: true,
};
