// The worker editor — one drawer for both create and edit, distinguished only by whether a `worker` came in.
//
// The tool policy is the security-bearing control here, so it is deliberate about what each mode shows:
//   all      — every box checked AND disabled, so the grant is visible but not editable piecemeal
//   ask      — the grid is hidden entirely; there is nothing to pick, every call is confirmed live
//   granular — the grid is the grant
// The allowlist is written only under "granular"; the other modes persist an empty array so switching to a
// permissive mode never leaves a stale narrow list that would silently apply if the mode changed back.

import {
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  Classes,
  FormGroup,
  H5,
  HTMLSelect,
  InputGroup,
  Intent,
  ProgressBar,
  TextArea,
} from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { memo, useCallback, useId, useMemo, useState } from "react";
import isEqual from "react-fast-compare";
import { useTranslation } from "react-i18next";

import { MAX_WORKER_PROMPT_CHARS, MAX_WORKER_SPECIALTY_CHARS } from "@/ai-system/core/limits";
import type { WorkerToolPolicyMode } from "@/ai-system/core/permissions";
import type { WorkerDefinition } from "@/ai-system/core/workers";
import { retainKnownWorkerTools, type WorkerToolGroup, workerToolsByGroup } from "@/ai-system/core/workerTools";
import { createLogger } from "@/logger";
import { randomUUID } from "@/utils/randomUUID";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import type { ModelPickerValue } from "@/web-app/components/ai/ModelNavigator";

import { useSaveWorker } from "./queries";
import { WorkerModelPicker } from "./WorkerModelPicker";

const logger = createLogger("web.ai.worker");

const POLICY_MODES: ReadonlyArray<{ mode: WorkerToolPolicyMode; labelKey: string; icon: any }> = [
  { mode: "all", labelKey: "All allowed", icon: IconNames.UNLOCK },
  { mode: "ask", labelKey: "Prompt me", icon: IconNames.HELP },
  { mode: "granular", labelKey: "Granular", icon: IconNames.FILTER },
];

const TOOL_GROUPS: ReadonlyArray<{ group: WorkerToolGroup; labelKey: string; icon: any }> = [
  { group: "container", labelKey: "Container tools", icon: IconNames.CUBE },
  { group: "workspace", labelKey: "Workspace tools", icon: IconNames.FOLDER_CLOSE },
];

export interface CreateDrawerProps {
  worker?: WorkerDefinition;
  onClose: () => void;
}

export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ worker, onClose }: CreateDrawerProps) => {
    const { t } = useTranslation();
    const formId = useId();
    const workerSave = useSaveWorker();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    const [name, setName] = useState(worker?.name ?? "");
    const [specialty, setSpecialty] = useState(worker?.specialty ?? "");
    const [systemPrompt, setSystemPrompt] = useState(worker?.systemPrompt ?? "");
    const [policy, setPolicy] = useState<WorkerToolPolicyMode>(worker?.toolPolicy.mode ?? "granular");
    const [allowed, setAllowed] = useState<string[]>(() => retainKnownWorkerTools(worker?.toolPolicy.allowed ?? []));
    // No provider means "inherit whatever the goal run was started with" — the host falls back to the run access.
    const [inherit, setInherit] = useState(!worker?.providerId);
    const [model, setModel] = useState<ModelPickerValue>({
      providerId: worker?.providerId ?? "",
      model: worker?.model ?? "",
    });

    const allowedSet = useMemo(() => new Set(allowed), [allowed]);

    const toggleTool = useCallback((toolName: string) => {
      setAllowed((prev) => (prev.includes(toolName) ? prev.filter((n) => n !== toolName) : [...prev, toolName]));
    }, []);

    const selectGroup = useCallback((group: WorkerToolGroup) => {
      const names = workerToolsByGroup(group).map((entry) => entry.name);
      setAllowed((prev) => {
        const missing = names.filter((n) => !prev.includes(n));
        return missing.length > 0 ? [...prev, ...missing] : prev.filter((n) => !names.includes(n));
      });
    }, []);

    const onSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError(t("A worker needs a name"));
        return;
      }
      const now = Date.now();
      const next: WorkerDefinition = {
        id: worker?.id ?? randomUUID(),
        name: trimmedName,
        specialty: specialty.trim(),
        systemPrompt,
        providerId: inherit ? undefined : model.providerId || undefined,
        model: inherit ? "" : model.model,
        toolPolicy: { mode: policy, allowed: policy === "granular" ? allowed : [] },
        execution: { kind: "host" },
        createdAt: worker?.createdAt ?? now,
        updatedAt: now,
      };
      try {
        setPending(true);
        setError("");
        await workerSave.mutateAsync(next);
        onClose();
      } catch (err: any) {
        logger.error("Unable to save worker", err);
        setError(err?.message ?? t("Unable to save worker"));
      } finally {
        setPending(false);
      }
    };

    const pendingIndicator = (
      <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
    );

    return (
      <AppDrawer
        icon={IconNames.PERSON}
        title={worker ? t("Edit worker") : t("Create new worker")}
        size={DrawerSize.STANDARD}
        onClose={onClose}
        formId={formId}
        submitting={pending}
      >
        <div className={Classes.DRAWER_BODY}>
          <form id={formId} className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <div className="AppDataForm" data-form="ai.worker.edit">
              <section className="WorkerEditorPanel">
                <H5>{t("Identity")}</H5>
                <FormGroup disabled={pending} label={t("Name")} labelFor="workerName" labelInfo="(required)">
                  <InputGroup
                    fill
                    autoFocus
                    required
                    disabled={pending}
                    id="workerName"
                    className="workerName"
                    placeholder={t("Type to set a name")}
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    intent={error && !name.trim() ? Intent.DANGER : Intent.NONE}
                  />
                </FormGroup>
                <FormGroup
                  disabled={pending}
                  label={t("Specialty")}
                  labelFor="workerSpecialty"
                  helperText={t("The coordinator reads this to decide which tasks it assigns here.")}
                >
                  <InputGroup
                    fill
                    disabled={pending}
                    id="workerSpecialty"
                    className="workerSpecialty"
                    maxLength={MAX_WORKER_SPECIALTY_CHARS}
                    placeholder={t("What this worker is good at")}
                    value={specialty}
                    onChange={(e) => setSpecialty(e.currentTarget.value)}
                  />
                </FormGroup>
              </section>

              <section className="WorkerEditorPanel">
                <H5>{t("System prompt")}</H5>
                <FormGroup
                  disabled={pending}
                  helperText={t("Appended to the base assistant prompt for every task this worker runs.")}
                >
                  <TextArea
                    fill
                    disabled={pending}
                    className="workerSystemPrompt"
                    maxLength={MAX_WORKER_PROMPT_CHARS}
                    rows={6}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.currentTarget.value)}
                  />
                </FormGroup>
              </section>

              <section className="WorkerEditorPanel">
                <H5>{t("Model")}</H5>
                <Checkbox
                  disabled={pending}
                  checked={inherit}
                  label={t("Use whatever model the goal run was started with")}
                  onChange={(e) => setInherit(e.currentTarget.checked)}
                />
                <div className="WorkerEditorPickerRow" data-disabled={inherit ? "yes" : "no"}>
                  <WorkerModelPicker value={model} onChange={setModel} disabled={pending || inherit} />
                </div>
              </section>

              <section className="WorkerEditorPanel">
                <H5>{t("Tools")}</H5>
                <ButtonGroup fill className="WorkerEditorPolicy">
                  {POLICY_MODES.map((entry) => (
                    <Button
                      key={entry.mode}
                      disabled={pending}
                      icon={entry.icon}
                      text={t(entry.labelKey)}
                      // intent, not `active`: tokens.css renders a plain active button DARKER than rest, which
                      // reads as recessed. The intent bridge maps primary to --app-accent on every engine theme.
                      intent={policy === entry.mode ? Intent.PRIMARY : Intent.NONE}
                      onClick={() => setPolicy(entry.mode)}
                    />
                  ))}
                </ButtonGroup>

                {policy === "all" ? (
                  <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN} className="WorkerEditorNote">
                    {t(
                      "This worker runs every tool unattended, including destructive ones. The catastrophic-command floor still applies.",
                    )}
                  </Callout>
                ) : null}
                {policy === "ask" ? (
                  <Callout icon={IconNames.INFO_SIGN} className="WorkerEditorNote">
                    {t("Every call is confirmed by you first — including reads, which normally run unattended.")}
                  </Callout>
                ) : null}
                {policy === "granular" ? (
                  <Callout icon={IconNames.INFO_SIGN} className="WorkerEditorNote">
                    {t("Only the checked tools are offered to the model. Anything else is unknown to it.")}
                  </Callout>
                ) : null}

                {policy === "ask" ? null : (
                  <div className="WorkerEditorToolGrid">
                    {TOOL_GROUPS.map((groupEntry) => (
                      <div key={groupEntry.group} className="WorkerEditorToolGroup">
                        <div className="WorkerEditorToolGroupHead">
                          <span className="WorkerEditorToolGroupTitle">{t(groupEntry.labelKey)}</span>
                          <Button
                            variant="minimal"
                            size="small"
                            disabled={pending || policy !== "granular"}
                            text={t("Select all")}
                            onClick={() => selectGroup(groupEntry.group)}
                          />
                        </div>
                        {workerToolsByGroup(groupEntry.group).map((tool) => (
                          <Checkbox
                            key={tool.name}
                            className="WorkerEditorTool"
                            // "all" shows every grant as checked, but locked — the mode IS the grant.
                            checked={policy === "all" || allowedSet.has(tool.name)}
                            disabled={pending || policy !== "granular"}
                            onChange={() => toggleTool(tool.name)}
                          >
                            <span className="WorkerEditorToolName">{tool.name}</span>
                            {/* The space is load-bearing for assistive tech: without a text node between them the
                                label reads as one word ("startContainergated"). CSS margin only fixes the pixels. */}
                            {tool.gated ? (
                              <>
                                {" "}
                                <span className="WorkerEditorToolGated">{t("gated")}</span>
                              </>
                            ) : null}
                          </Checkbox>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN} className="WorkerEditorNote">
                  {t(
                    "Remembered approvals are shared app-wide — a “remember” granted while this worker ran also applies to other workers and to chat.",
                  )}
                </Callout>
              </section>

              <section className="WorkerEditorPanel">
                <H5>{t("Runs on")}</H5>
                <FormGroup
                  disabled={pending}
                  helperText={t("Workspace tools are confined to the workspace folder set in Settings → AI.")}
                >
                  <HTMLSelect fill disabled value="host" onChange={() => undefined}>
                    <option value="host">{t("This computer (host)")}</option>
                  </HTMLSelect>
                </FormGroup>
              </section>

              {error ? (
                <Callout intent={Intent.DANGER} icon={IconNames.ERROR} className="WorkerEditorNote">
                  {error}
                </Callout>
              ) : null}
            </div>
            {pendingIndicator}
            <ButtonGroup fill>
              <Button
                disabled={pending}
                intent={Intent.SUCCESS}
                icon={IconNames.PERSON}
                title={t("Click to save this worker")}
                text={worker ? t("Save") : t("Create")}
                type="submit"
              />
            </ButtonGroup>
          </form>
        </div>
      </AppDrawer>
    );
  },
  (prev, next) => {
    return isEqual(prev, next);
  },
);
CreateDrawer.displayName = "CreateDrawer";
