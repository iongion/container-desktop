import { Button, Callout, FormGroup, HTMLSelect, HTMLTable, Icon, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { userConfiguration } from "@/container-client/config";
import {
  type HookTarget,
  type HookTargetKind,
  LIFECYCLE_HOOKS_SETTINGS_KEY,
  type LifecycleHook,
  type LifecycleHooksSettings,
  normalizeLifecycleHooks,
  removeLifecycleHook,
  splitCommandLine,
  upsertLifecycleHook,
} from "@/container-client/lifecycleHooks";
import type { Connection } from "@/container-client/types/connection";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

import "./LifecycleHooksPanel.css";

// Settings → Lifecycle hooks: every hook in one table, added and edited in the editor below it. A hook runs on this
// computer around a container's or a stack's start and stop, whoever triggers it (see @/container-client/lifecycleHooks).

interface Draft {
  kind: HookTargetKind;
  connectionId: string;
  name: string;
  beforeStart: string;
  afterStop: string;
  // The hook being edited, so renaming its target replaces it instead of adding a second one.
  original?: HookTarget;
}

const emptyDraft = (connectionId: string): Draft => ({
  kind: "container",
  connectionId,
  name: "",
  beforeStart: "",
  afterStop: "",
});

function quoteError(line: string): boolean {
  try {
    splitCommandLine(line);
    return false;
  } catch {
    return true;
  }
}

interface HookEditorProps {
  draft: Draft;
  connections: Connection[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}

const HookEditor: React.FC<HookEditorProps> = ({ draft, connections, onChange, onSave, onCancel }) => {
  const { t } = useTranslation();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const beforeInvalid = quoteError(draft.beforeStart);
  const afterInvalid = quoteError(draft.afterStop);
  const canSave =
    !!draft.name.trim() &&
    !!draft.connectionId &&
    !!(draft.beforeStart.trim() || draft.afterStop.trim()) &&
    !beforeInvalid &&
    !afterInvalid;
  const quoteHint = t("A quote is not closed.");
  return (
    <div className="LifecycleHookEditor" data-form="lifecycle-hook">
      <div className="LifecycleHookEditorTarget">
        <FormGroup label={t("Target")} labelFor="hookKind">
          <HTMLSelect
            id="hookKind"
            fill
            value={draft.kind}
            onChange={(e) => set({ kind: e.currentTarget.value as HookTargetKind })}
          >
            <option value="container">{t("Container")}</option>
            <option value="stack">{t("Stack")}</option>
          </HTMLSelect>
        </FormGroup>
        <FormGroup label={t("Name")} labelFor="hookName">
          <InputGroup
            id="hookName"
            value={draft.name}
            placeholder={draft.kind === "stack" ? t("compose project, e.g. shop") : t("container name, e.g. web")}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
        </FormGroup>
        <FormGroup label={t("Connection")} labelFor="hookConnection">
          <HTMLSelect
            id="hookConnection"
            fill
            value={draft.connectionId}
            onChange={(e) => set({ connectionId: e.currentTarget.value })}
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
      </div>
      <div className="LifecycleHookEditorCommands">
        <FormGroup
          label={t("Before start")}
          labelFor="hookBeforeStart"
          intent={beforeInvalid ? Intent.DANGER : Intent.NONE}
          helperText={beforeInvalid ? quoteHint : t("If it fails, the start is cancelled.")}
        >
          <InputGroup
            id="hookBeforeStart"
            className="LifecycleHookCommand"
            value={draft.beforeStart}
            intent={beforeInvalid ? Intent.DANGER : Intent.NONE}
            placeholder="/path/to/script --flag"
            onChange={(e) => set({ beforeStart: e.currentTarget.value })}
          />
        </FormGroup>
        <FormGroup
          label={t("After stop")}
          labelFor="hookAfterStop"
          intent={afterInvalid ? Intent.DANGER : Intent.NONE}
          helperText={afterInvalid ? quoteHint : t("A failure is reported; nothing else happens.")}
        >
          <InputGroup
            id="hookAfterStop"
            className="LifecycleHookCommand"
            value={draft.afterStop}
            intent={afterInvalid ? Intent.DANGER : Intent.NONE}
            placeholder="/path/to/script --flag"
            onChange={(e) => set({ afterStop: e.currentTarget.value })}
          />
        </FormGroup>
      </div>
      <div className="LifecycleHookEditorActions">
        <Button variant="minimal" text={t("Cancel")} onClick={onCancel} />
        <Button
          intent={Intent.PRIMARY}
          text={t("Save hook")}
          disabled={!canSave}
          data-action="hooks.save"
          onClick={onSave}
        />
      </div>
    </div>
  );
};

interface HooksTableProps {
  hooks: LifecycleHook[];
  connectionName: (id: string) => string;
  onEdit: (hook: LifecycleHook) => void;
  onRemove: (hook: LifecycleHook) => void;
}

const HooksTable: React.FC<HooksTableProps> = ({ hooks, connectionName, onEdit, onRemove }) => {
  const { t } = useTranslation();
  const command = (value?: string) =>
    value ? (
      <td className="LifecycleHookCell--command">{value}</td>
    ) : (
      <td className="LifecycleHookCell--none">{t("none")}</td>
    );
  return (
    <HTMLTable compact striped className="AppDataTable LifecycleHooksTable" data-table="lifecycle-hooks">
      <thead>
        <tr>
          <th>{t("Target")}</th>
          <th>{t("Connection")}</th>
          <th>{t("Before start")}</th>
          <th>{t("After stop")}</th>
          <th className="LifecycleHookCell--actions" />
        </tr>
      </thead>
      <tbody>
        {hooks.map((hook) => (
          <tr key={`${hook.kind}/${hook.connectionId}/${hook.name}`} data-hook={`${hook.kind}/${hook.name}`}>
            <td>
              <span className="LifecycleHookTarget">
                <Icon icon={hook.kind === "stack" ? IconNames.DIAGRAM_TREE : IconNames.CUBE} />
                <span>{hook.name}</span>
                <span className="LifecycleHookKind">{hook.kind === "stack" ? t("stack") : t("container")}</span>
              </span>
            </td>
            <td>{connectionName(hook.connectionId)}</td>
            {command(hook.beforeStart)}
            {command(hook.afterStop)}
            <td className="LifecycleHookCell--actions">
              <Button
                size="small"
                variant="minimal"
                icon={IconNames.EDIT}
                title={t("Edit")}
                data-action="hooks.edit"
                onClick={() => onEdit(hook)}
              />
              <ConfirmMenu
                title={t("Remove this hook?")}
                actionText={t("Remove")}
                actionIcon={IconNames.TRASH}
                tag={hook}
                onConfirm={(tag, confirmed) => confirmed && onRemove(tag)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};

export const LifecycleHooksPanel: React.FC = () => {
  const { t } = useTranslation();
  const connections = useAppStore((state) => state.connections);
  const [settings, setSettings] = useState<LifecycleHooksSettings>({ hooks: [] });
  const [draft, setDraft] = useState<Draft | undefined>();

  useEffect(() => {
    let active = true;
    userConfiguration
      .getKey(LIFECYCLE_HOOKS_SETTINGS_KEY)
      .then((stored) => active && setSettings(normalizeLifecycleHooks(stored)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const connectionName = useMemo(() => {
    const names = new Map(connections.map((connection) => [connection.id, connection.name]));
    return (id: string) => names.get(id) ?? id;
  }, [connections]);

  const persist = useCallback(async (next: LifecycleHooksSettings) => {
    try {
      await userConfiguration.setKey(LIFECYCLE_HOOKS_SETTINGS_KEY, next);
      setSettings(next);
      return true;
    } catch (error) {
      Notification.show({ message: error instanceof Error ? error.message : String(error), intent: Intent.DANGER });
      return false;
    }
  }, []);

  const onSave = useCallback(async () => {
    if (!draft) return;
    const base = draft.original ? removeLifecycleHook(settings, draft.original) : settings;
    const { original: _original, ...hook } = draft;
    if (await persist(upsertLifecycleHook(base, { ...hook, name: hook.name.trim() }))) {
      setDraft(undefined);
    }
  }, [draft, persist, settings]);

  const onEdit = useCallback((hook: LifecycleHook) => {
    setDraft({
      kind: hook.kind,
      connectionId: hook.connectionId,
      name: hook.name,
      beforeStart: hook.beforeStart ?? "",
      afterStop: hook.afterStop ?? "",
      original: { kind: hook.kind, connectionId: hook.connectionId, name: hook.name },
    });
  }, []);

  const count = settings.hooks.length;
  return (
    <div className="AppSettingsForm LifecycleHooksPanel" data-form="lifecycle-hooks">
      <p className="LifecycleHooksLead">{t("Run a command before a container or stack starts, or after it stops.")}</p>
      <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN} className="LifecycleHooksWarning">
        {t(
          "Hooks run on this computer, as you, whoever starts or stops the container: you, the tray, or an AI client through the MCP server.",
        )}
      </Callout>
      <div className="LifecycleHooksToolbar">
        <span className="LifecycleHooksCount">{t("{{count}} hooks", { count })}</span>
        <Button
          size="small"
          intent={Intent.PRIMARY}
          icon={IconNames.ADD}
          text={t("Add hook")}
          disabled={!!draft}
          data-action="hooks.add"
          onClick={() => setDraft(emptyDraft(connections[0]?.id ?? ""))}
        />
      </div>
      {count > 0 ? (
        <HooksTable
          hooks={settings.hooks}
          connectionName={connectionName}
          onEdit={onEdit}
          onRemove={(hook) => void persist(removeLifecycleHook(settings, hook))}
        />
      ) : null}
      {draft ? (
        <HookEditor
          draft={draft}
          connections={connections}
          onChange={setDraft}
          onSave={() => void onSave()}
          onCancel={() => setDraft(undefined)}
        />
      ) : null}
      <p className="LifecycleHooksNotes">
        {t(
          "A hook is a program and its arguments, run without a shell (wrap it in sh -c \"…\" for pipes or redirects), for up to 60 seconds. It gets CD_HOOK, CD_CONTAINER_ID, CD_CONTAINER_NAME, CD_CONNECTION and CD_ENGINE, and CD_STACK for a stack. A stack hook runs once, from the stack's Start all, Stop all, Restart all and Teardown; each container's own hooks still run. Restart counts as a start.",
        )}
      </p>
    </div>
  );
};
