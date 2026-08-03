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
  Icon,
  type IconName,
  InputGroup,
  Intent,
  PopoverNext,
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
import type { WorkerDefinition, WorkerExecutionTarget } from "@/ai-system/core/workers";
import { retainKnownWorkerTools, type WorkerToolGroup, workerToolsByGroup } from "@/ai-system/core/workerTools";
import { createLogger } from "@/logger";
import { randomUUID } from "@/utils/randomUUID";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { AvatarLibrary } from "@/web-app/components/ai/AvatarLibrary";
import { useAvatars } from "@/web-app/components/ai/avatarQueries";
import type { ModelPickerValue } from "@/web-app/components/ai/ModelNavigator";
import { WorkerAvatar } from "@/web-app/components/ai/WorkerAvatar";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { useMergedResources } from "@/web-app/hooks/useMergedResources";

import { useSaveWorker } from "./queries";
import { WorkerModelPicker } from "./WorkerModelPicker";

const logger = createLogger("web.ai.worker");

const POLICY_MODES: ReadonlyArray<{ mode: WorkerToolPolicyMode; labelKey: string; icon: IconName }> = [
  { mode: "all", labelKey: "All allowed", icon: IconNames.UNLOCK },
  { mode: "ask", labelKey: "Prompt me", icon: IconNames.HELP },
  { mode: "granular", labelKey: "Granular", icon: IconNames.FILTER },
];

const TOOL_GROUPS: ReadonlyArray<{ group: WorkerToolGroup; labelKey: string; icon: IconName }> = [
  { group: "container", labelKey: "Container tools", icon: IconNames.CUBE },
  { group: "workspace", labelKey: "Workspace tools", icon: IconNames.FOLDER_CLOSE },
];

// A small, widely-available base image for a throwaway sandbox; the user can point it at anything with a shell.
const DEFAULT_SANDBOX_IMAGE = "docker.io/library/alpine:3";

type ExecutionKind = WorkerExecutionTarget["kind"];

const EXECUTION_KINDS: ReadonlyArray<{ kind: ExecutionKind; labelKey: string }> = [
  { kind: "host", labelKey: "This computer (host)" },
  { kind: "remote", labelKey: "Remote host (SSH)" },
  { kind: "container", labelKey: "Existing container" },
  { kind: "sandbox", labelKey: "Sandbox container (new)" },
];

const targetConnectionId = (target: WorkerExecutionTarget): string =>
  "connectionId" in target ? target.connectionId : "";

// Build a fresh target for a newly-selected kind, carrying the connection over so switching kinds does not lose it.
function makeTarget(kind: ExecutionKind, prev: WorkerExecutionTarget): WorkerExecutionTarget {
  if (kind === "host") return { kind: "host" };
  const connectionId = targetConnectionId(prev);
  if (kind === "remote") return { kind: "remote", connectionId };
  if (kind === "container") return { kind: "container", connectionId, containerId: "" };
  return { kind: "sandbox", connectionId, image: DEFAULT_SANDBOX_IMAGE };
}

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
    const [target, setTarget] = useState<WorkerExecutionTarget>(worker?.execution ?? { kind: "host" });
    const containers = useMergedResources("containers");
    const [avatarId, setAvatarId] = useState<string | undefined>(worker?.avatarId);
    const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
    const { data: avatars } = useAvatars();
    const customAvatars = avatars ?? [];
    const [specialty, setSpecialty] = useState(worker?.specialty ?? "");
    const [systemPrompt, setSystemPrompt] = useState(worker?.systemPrompt ?? "");
    const [policy, setPolicy] = useState<WorkerToolPolicyMode>(worker?.toolPolicy.mode ?? "granular");
    const [allowed, setAllowed] = useState<string[]>(() => retainKnownWorkerTools(worker?.toolPolicy.allowed ?? []));
    // No provider means "inherit the Team Run model" — the host falls back to the Run's provider access.
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
      if (target.kind !== "host" && !target.connectionId) {
        setError(t("Choose a connection for this worker to run on"));
        return;
      }
      if (target.kind === "container" && !target.containerId) {
        setError(t("Choose a container for this worker to run in"));
        return;
      }
      if (target.kind === "sandbox" && !target.image.trim()) {
        setError(t("A sandbox needs an image"));
        return;
      }
      const now = Date.now();
      const next: WorkerDefinition = {
        id: worker?.id ?? randomUUID(),
        name: trimmedName,
        avatarId,
        specialty: specialty.trim(),
        systemPrompt,
        providerId: inherit ? undefined : model.providerId || undefined,
        model: inherit ? "" : model.model,
        toolPolicy: { mode: policy, allowed: policy === "granular" ? allowed : [] },
        execution: target,
        createdAt: worker?.createdAt ?? now,
        updatedAt: now,
      };
      try {
        setPending(true);
        setError("");
        await workerSave.mutateAsync(next);
        onClose();
      } catch (err: unknown) {
        logger.error("Unable to save worker", err);
        setError(err instanceof Error ? err.message : t("Unable to save worker"));
      } finally {
        setPending(false);
      }
    };

    const pendingIndicator = (
      <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
    );

    return (
      <AppDrawer
        className="WorkerEditorDrawer"
        icon={IconNames.PERSON}
        title={
          <span className="WorkerDrawerCredentialTitle">
            <span>{worker ? t("Edit worker") : t("Create new worker")}</span>{" "}
            <span className="WorkerDrawerCredentialKind">{t("Identity")}</span>
            <span className="WorkerCredentialMark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
        }
        size={DrawerSize.STANDARD}
        onClose={onClose}
        formId={formId}
        submitting={pending}
      >
        <div className={Classes.DRAWER_BODY}>
          <form id={formId} className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <div className="AppDataForm" data-form="ai.worker.edit">
              <section aria-label={t("Identity")}>
                <div className="WorkerCredential">
                  <div className="WorkerCredentialBody">
                    <div className="WorkerCredentialPortrait">
                      <PopoverNext
                        isOpen={avatarPickerOpen}
                        onInteraction={(next) => setAvatarPickerOpen(next)}
                        usePortal
                        placement="bottom-start"
                        content={
                          <div className="WorkerAvatarPicker">
                            <AvatarLibrary mode="select" selectedId={avatarId} onSelect={setAvatarId} />
                            <div className="WorkerAvatarPickerFoot">
                              <Button
                                intent={Intent.SUCCESS}
                                text={t("Use avatar")}
                                onClick={() => setAvatarPickerOpen(false)}
                              />
                            </div>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          className="WorkerAvatarChangeButton"
                          disabled={pending}
                          aria-label={t("Change avatar")}
                          aria-haspopup="dialog"
                          aria-expanded={avatarPickerOpen}
                          title={t("Change avatar")}
                          onClick={() => setAvatarPickerOpen(true)}
                        >
                          <WorkerAvatar
                            avatarId={avatarId}
                            name={name || t("New worker")}
                            customs={customAvatars}
                            size={76}
                          />
                          <span className="WorkerAvatarEditCue" aria-hidden="true">
                            <Icon icon={IconNames.EDIT} size={12} />
                          </span>
                        </button>
                      </PopoverNext>
                    </div>
                    <div className="WorkerCredentialFields">
                      <FormGroup
                        className="WorkerCredentialField WorkerIdentityName"
                        disabled={pending}
                        label={t("Name")}
                        labelFor="workerName"
                        labelInfo={t("(required)")}
                      >
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
                        className="WorkerCredentialField"
                        disabled={pending}
                        label={t("Specialty")}
                        labelFor="workerSpecialty"
                      >
                        <InputGroup
                          fill
                          disabled={pending}
                          id="workerSpecialty"
                          className="workerSpecialty"
                          maxLength={MAX_WORKER_SPECIALTY_CHARS}
                          placeholder={t("What this worker is good at")}
                          value={specialty}
                          aria-describedby="workerSpecialtyHelp"
                          onChange={(e) => setSpecialty(e.currentTarget.value)}
                        />
                      </FormGroup>
                    </div>
                  </div>
                  <div className="WorkerCredentialFooter" id="workerSpecialtyHelp">
                    <Icon icon={IconNames.GIT_BRANCH} size={13} />
                    <span>{t("The coordinator reads this to decide which tasks it assigns here.")}</span>
                  </div>
                </div>
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
                  label={t("Use the model selected for the Team Run")}
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
                  helperText={
                    target.kind === "host"
                      ? t("Workspace tools are confined to the workspace folder set in Settings → AI.")
                      : t("Workspace and command tools run inside the chosen environment, not on this computer.")
                  }
                >
                  <HTMLSelect
                    fill
                    disabled={pending}
                    value={target.kind}
                    onChange={(e) => setTarget(makeTarget(e.currentTarget.value as ExecutionKind, target))}
                  >
                    {EXECUTION_KINDS.map((entry) => (
                      <option key={entry.kind} value={entry.kind}>
                        {t(entry.labelKey)}
                      </option>
                    ))}
                  </HTMLSelect>
                </FormGroup>

                {target.kind !== "host" ? (
                  <ConnectionSelect
                    value={targetConnectionId(target)}
                    onChange={(connectionId) =>
                      setTarget((prev) => ("connectionId" in prev ? { ...prev, connectionId } : prev))
                    }
                    disabled={pending}
                    label={t("Connection")}
                  />
                ) : null}

                {target.kind === "container" ? (
                  <FormGroup disabled={pending} label={t("Container")}>
                    <HTMLSelect
                      fill
                      disabled={pending}
                      value={target.containerId}
                      onChange={(e) =>
                        setTarget((prev) =>
                          prev.kind === "container" ? { ...prev, containerId: e.currentTarget.value } : prev,
                        )
                      }
                    >
                      <option value="">{t("Choose a container…")}</option>
                      {containers
                        .filter((c) => c.connectionId === targetConnectionId(target))
                        .map((c) => (
                          <option key={c.Id} value={c.Id}>
                            {c.Computed?.Name || c.Id}
                          </option>
                        ))}
                    </HTMLSelect>
                  </FormGroup>
                ) : null}

                {target.kind === "sandbox" ? (
                  <FormGroup
                    disabled={pending}
                    label={t("Image")}
                    helperText={t("A fresh container is created from this image for the run and removed afterwards.")}
                  >
                    <InputGroup
                      fill
                      disabled={pending}
                      value={target.image}
                      placeholder={DEFAULT_SANDBOX_IMAGE}
                      onChange={(e) =>
                        setTarget((prev) =>
                          prev.kind === "sandbox" ? { ...prev, image: e.currentTarget.value } : prev,
                        )
                      }
                    />
                  </FormGroup>
                ) : null}
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
