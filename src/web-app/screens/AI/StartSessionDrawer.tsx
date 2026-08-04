// The form that starts a coding agent session: which connection runs the container pair, which folder is
// mounted into it, which model answers, and whether the agent may reach the network. A drawer, like every
// other form in the app; the screen behind it stays readable while it is open.
import {
  Button,
  ButtonGroup,
  Callout,
  Classes,
  DrawerSize,
  FormGroup,
  InputGroup,
  Intent,
  ProgressBar,
  Switch,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { AISettings } from "@/ai-system/core/types";
import { createLogger } from "@/logger";
import { agentImageTag } from "@/pi-bridge/image";
import { getHostRuntime } from "@/platform/provider";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { ModelPicker, type ModelPickerValue } from "@/web-app/components/ModelPicker";
import { PROJECT_VERSION } from "@/web-app/Environment";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

import { type CodingAgentStartProblem, resolveCodingAgentStart } from "./startSession";
import "./AssistantScreen.css";

const logger = createLogger("web-app.codingAgent.start");

export interface StartSessionDrawerProps {
  onClose: () => void;
}

export const StartSessionDrawer: React.FC<StartSessionDrawerProps> = ({ onClose }: StartSessionDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const status = useCodingAgentStore((state) => state.status);
  const startLog = useCodingAgentStore((state) => state.startLog);
  const error = useCodingAgentStore((state) => state.error);
  const start = useCodingAgentStore((state) => state.start);

  const [connectionId, setConnectionId] = useState("");
  // The workspace root the assistant's own file tools are confined to is the obvious first offer.
  const [workspacePath, setWorkspacePath] = useState(ai.workspaceRoot ?? "");
  const [egress, setEgress] = useState(true);
  // The ModelPicker owns discovery and persistence; this only tracks the live selection, seeded like the
  // composer's from the saved default provider and its model.
  const [selection, setSelection] = useState<ModelPickerValue>(() => ({
    providerId: ai.defaultProvider,
    model: ai.providers?.[ai.defaultProvider]?.model ?? "",
  }));
  // undefined = not answered yet, so a provider that needs a key does not flash a complaint on open.
  const [keyPresent, setKeyPresent] = useState<boolean | undefined>(undefined);

  const starting = status === "starting";

  useEffect(() => {
    let current = true;
    setKeyPresent(undefined);
    void (async () => {
      const present = await window.AI?.hasKey(selection.providerId).catch((problem: unknown) => {
        logger.warn("unable to read the provider key state", problem);
        return false;
      });
      if (current) setKeyPresent(present ?? false);
    })();
    return () => {
      current = false;
    };
  }, [selection.providerId]);

  // A started session takes the screen; keeping the form open would invite edits it cannot apply.
  useEffect(() => {
    if (status === "ready") onClose();
  }, [status, onClose]);

  const resolved = useMemo(
    () =>
      resolveCodingAgentStart(
        { connectionId, workspacePath, providerId: selection.providerId, model: selection.model, egress },
        { settings: ai, appVersion: PROJECT_VERSION, keyPresent: keyPresent ?? false },
      ),
    [connectionId, workspacePath, selection.providerId, selection.model, egress, ai, keyPresent],
  );

  const browse = useCallback(async () => {
    const selected = await getHostRuntime().dialogs.openFileSelector({ directory: true });
    const path = selected?.filePaths?.[0];
    if (!selected?.canceled && path) setWorkspacePath(path);
  }, []);

  const onSubmit = useCallback(() => {
    if (!resolved.options) return;
    void start(resolved.options);
  }, [resolved.options, start]);

  // Reported together, in the form's own order, so one pass fixes everything.
  const PROBLEM_TEXT: Record<CodingAgentStartProblem, string> = {
    "no-connection": t("Pick a connected engine to run the agent's containers on."),
    "no-workspace": t("Pick the folder the agent may read and write."),
    "no-provider": t("This inference source is not configured. Add it in Settings → AI."),
    "no-endpoint": t("This inference source has no endpoint. Set its base URL in Settings → AI."),
    "no-model": t("Pick a model for the agent to use."),
    "missing-key": t("This inference source needs an API key. Add it in Settings → AI."),
  };
  // Only what the user can act on: an unanswered key probe is not a complaint.
  const blockers = keyPresent === undefined ? [] : resolved.problems;

  return (
    <AppDrawer
      className="AppStartAgentSessionDrawer"
      icon={IconNames.CODE}
      title={t("Start an assistant session")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitIcon={IconNames.PLAY}
      submitTitle={t("Start session")}
      submitting={starting}
      submitDisabled={!resolved.options}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={starting} />
          <div className="AppDataForm" data-form="ai.codingAgent.start">
            <FormGroup
              disabled={starting}
              label={t("Workspace folder")}
              labelFor="agentWorkspacePath"
              helperText={t("Mounted at /workspace. The agent reads and writes here, and nowhere else.")}
            >
              <InputGroup
                fill
                autoFocus
                disabled={starting}
                id="agentWorkspacePath"
                leftIcon={IconNames.FOLDER_CLOSE}
                placeholder={t("Type or browse to a project folder")}
                value={workspacePath}
                onInput={(event) => setWorkspacePath(event.currentTarget.value)}
                rightElement={
                  <Button
                    variant="minimal"
                    disabled={starting}
                    icon={IconNames.FOLDER_OPEN}
                    title={t("Choose the workspace folder")}
                    onClick={() => void browse()}
                  />
                }
              />
            </FormGroup>
            <FormGroup
              disabled={starting}
              label={t("Model")}
              helperText={t("The key stays on this machine — a separate gateway container holds it, not the agent.")}
            >
              <ModelPicker value={selection} onChange={setSelection} disabled={starting} />
            </FormGroup>
            <FormGroup disabled={starting} label={t("Network")}>
              <Switch
                checked={egress}
                disabled={starting}
                label={t("Allow egress")}
                onChange={(event) => setEgress(event.currentTarget.checked)}
              />
            </FormGroup>
          </div>
          {blockers.length > 0 ? (
            <Callout intent={Intent.PRIMARY} icon={IconNames.INFO_SIGN} className="AgentStartProblems">
              {blockers.map((problem) => (
                <div key={problem}>{PROBLEM_TEXT[problem]}</div>
              ))}
            </Callout>
          ) : null}
          <div className="AppDrawerPendingIndicator">{starting && <ProgressBar intent={Intent.SUCCESS} />}</div>
          {startLog.length > 0 ? <pre className="AssistantStartLog">{startLog.join("\n")}</pre> : null}
          {status === "error" && error ? (
            <Callout intent={Intent.DANGER} icon={IconNames.ERROR} className="AgentStartFailure">
              {error}
            </Callout>
          ) : null}
          <ButtonGroup fill>
            <Button
              type="submit"
              disabled={starting || !resolved.options}
              intent={Intent.SUCCESS}
              icon={IconNames.PLAY}
              title={resolved.options ? t("Start the session") : t("Complete the form to start a session")}
              text={t("Start session")}
            />
          </ButtonGroup>
          <div className="AgentStartImageNote">
            {t("Image {{tag}} — builds on first use.", { tag: agentImageTag(PROJECT_VERSION) })}
          </div>
        </form>
      </div>
    </AppDrawer>
  );
};
