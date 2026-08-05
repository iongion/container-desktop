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
  HTMLSelect,
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

import { ExecutionTargetSelect } from "./ExecutionTargetSelect";
import { type CodingAgentStartProblem, type ExecutionTargetKind, resolveCodingAgentStart } from "./startSession";
import "./AssistantScreen.css";

const logger = createLogger("web-app.codingAgent.start");

export interface StartSessionDrawerProps {
  onClose: () => void;
}

// What each choice means, in the drawer's own words. A target is a CONTAINER; the connection chosen above is how it
// is reached. `off` is not a target — it withholds the toolset, which is why it reads as the agent keeping to its
// own container.
const EXECUTION_KINDS: readonly ExecutionTargetKind[] = ["off", "container", "sandbox"];

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

  // Where the session's workspace tools run. "off" by default: the agent's own file tools already see the folder
  // mounted into its container, and reaching this machine, the engine's host or another container is a decision the
  // user makes explicitly — never one this form makes for them.
  const [executionKind, setExecutionKind] = useState<ExecutionTargetKind>("off");
  const [executionRef, setExecutionRef] = useState("");

  const resolved = useMemo(
    () =>
      resolveCodingAgentStart(
        {
          connectionId,
          workspacePath,
          providerId: selection.providerId,
          model: selection.model,
          egress,
          executionKind,
          executionRef,
        },
        { settings: ai, appVersion: PROJECT_VERSION, keyPresent: keyPresent ?? false },
      ),
    [
      connectionId,
      workspacePath,
      selection.providerId,
      selection.model,
      egress,
      executionKind,
      executionRef,
      ai,
      keyPresent,
    ],
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
    "no-execution-ref": t("Name the container the tools run in, or the image a disposable one is created from."),
  };
  // Where the workspace toolset acts, and what each choice costs. Beside PROBLEM_TEXT because both are translated
  // prose the form reads; the KINDS list is the vocabulary and lives at module level.
  const EXECUTION_LABEL: Record<ExecutionTargetKind, string> = {
    off: t("Not offered"),
    container: t("An existing container"),
    sandbox: t("A disposable container"),
  };
  const EXECUTION_HELP: Record<ExecutionTargetKind, string> = {
    off: t("The agent keeps to its own container, which already has the workspace folder mounted."),
    container: t("File and command tools act inside a container already running on the connection chosen above."),
    sandbox: t("A throwaway container is created on that connection from this image, and removed when it ends."),
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
            <FormGroup
              disabled={starting}
              label={t("Workspace tools")}
              labelFor="agentExecutionKind"
              helperText={EXECUTION_HELP[executionKind]}
            >
              <HTMLSelect
                fill
                id="agentExecutionKind"
                disabled={starting}
                value={executionKind}
                onChange={(event) => setExecutionKind(event.currentTarget.value as ExecutionTargetKind)}
              >
                {EXECUTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EXECUTION_LABEL[kind]}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>
            {executionKind === "container" || executionKind === "sandbox" ? (
              <FormGroup
                disabled={starting}
                label={executionKind === "container" ? t("Container") : t("Image")}
                helperText={
                  executionKind === "container"
                    ? t("Running on this connection. A name the list has not seen is accepted too.")
                    : t("Pulled on this connection. A reference the list has not seen is pulled at start.")
                }
              >
                <ExecutionTargetSelect
                  kind={executionKind}
                  connectionId={connectionId}
                  value={executionRef}
                  onChange={setExecutionRef}
                  disabled={starting}
                />
              </FormGroup>
            ) : null}
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
