// The containerized pi coding agent surface: status bar, start log, transcript, composer. The session
// itself lives in useCodingAgentStore; this screen renders it and forwards input.
import { Button, ButtonGroup, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import "./CodingAgentScreen.css";

export const ID = "ai.codingAgent";
export const Title = i18n.t("Coding Agent");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const status = useCodingAgentStore((state) => state.status);
  const items = useCodingAgentStore((state) => state.items);
  const startLog = useCodingAgentStore((state) => state.startLog);
  const submit = useCodingAgentStore((state) => state.submit);
  const stop = useCodingAgentStore((state) => state.stop);
  const [draft, setDraft] = useState("");

  return (
    <div className="AppScreen CodingAgentScreen" data-screen={ID}>
      <div className="CodingAgentBar">
        <span className="CodingAgentStatus" data-status={status}>
          {status}
        </span>
        <ButtonGroup>
          <Button icon={IconNames.STOP} text={t("Stop")} disabled={status !== "ready"} onClick={() => void stop()} />
        </ButtonGroup>
      </div>
      {status === "starting" || status === "error" ? (
        <pre className="CodingAgentStartLog">{startLog.join("\n")}</pre>
      ) : null}
      <div className="CodingAgentTranscript">
        {items.map((item) => {
          if (item.kind === "tool") {
            return (
              <div className="CodingAgentTool" key={item.id} data-state={item.state}>
                <div className="CodingAgentToolName">{item.toolName}</div>
                <pre className="CodingAgentToolOutput">{item.output}</pre>
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
          return (
            <div className={`CodingAgentMessage CodingAgentMessage--${item.kind}`} key={item.id}>
              {item.text}
            </div>
          );
        })}
      </div>
      <TextArea
        className="CodingAgentComposer"
        value={draft}
        disabled={status !== "ready"}
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
