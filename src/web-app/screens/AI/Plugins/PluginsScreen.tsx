// The Plugins sub-screen: pi's configured packages, what each contributes, and the install / update / enable
// / remove actions over them. A face on pi's own package manager — the container resolves and installs, this
// screen only shows what it reports. Reached through the AI section tab bar, not the sidebar.
import { Callout, HTMLTable, Icon, Intent, NonIdealState, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { PluginRow } from "@/ai-system/core/pluginCatalog";
import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { type BulkAction, BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { usePluginStore } from "@/web-app/stores/pluginStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeaderSectionsTabBar } from "../ScreenHeader";
import { PluginActionsMenu } from "./ActionsMenu";
import "./PluginsScreen.css";

export const ID = "ai.plugins";
export const Title = i18n.t("Plugins");

export interface ScreenProps extends AppScreenProps {}

const KIND_ICON = {
  npm: IconNames.BOX,
  git: IconNames.GIT_BRANCH,
  local: IconNames.FOLDER_CLOSE,
} as const;

// A source can be configured in both scopes, so neither alone identifies a row.
const rowKey = (row: PluginRow) => `${row.scope}:${row.source}`;

// The contributed names, shown as tags so a row says what the plugin actually adds rather than just a count.
const Contributions: React.FC<{ names: string[]; prefix?: string }> = ({ names, prefix }) => {
  if (names.length === 0) return <span className="PluginMuted">&mdash;</span>;
  return (
    <div className="PluginContributions">
      {names.map((name) => (
        <Tag minimal key={name}>
          {prefix ? `${prefix}${name}` : name}
        </Tag>
      ))}
    </div>
  );
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const rows = usePluginStore((state) => state.rows);
  const busy = usePluginStore((state) => state.busy);
  const error = usePluginStore((state) => state.error);
  const progress = usePluginStore((state) => state.progress);
  const updatable = usePluginStore((state) => state.updatable);
  const attach = usePluginStore((state) => state.attach);
  const refresh = usePluginStore((state) => state.refresh);
  const remove = usePluginStore((state) => state.remove);
  const update = usePluginStore((state) => state.update);
  const setEnabled = usePluginStore((state) => state.setEnabled);

  // One subscription for as long as the screen is up: plugin events only matter while it is being looked at,
  // and the first read happens on attach.
  useEffect(() => attach(), [attach]);

  const visibleIds = useMemo(() => rows.map(rowKey), [rows]);
  const selection = useBulkSelection(ID, visibleIds);

  // The bulk actions call the same store mutations the row menu does, so a mass disable behaves exactly like
  // disabling each row in turn.
  const bulkActions = useMemo<BulkAction<PluginRow>[]>(
    () => [
      {
        key: "plugin.enable",
        label: t("Enable"),
        icon: IconNames.EYE_OPEN,
        eligible: (row) => !row.enabled,
        run: async (row) => {
          await setEnabled(row.source, true, row.scope);
          return !usePluginStore.getState().error;
        },
      },
      {
        key: "plugin.disable",
        label: t("Disable"),
        icon: IconNames.EYE_OFF,
        eligible: (row) => row.enabled,
        run: async (row) => {
          await setEnabled(row.source, false, row.scope);
          return !usePluginStore.getState().error;
        },
      },
      {
        key: "plugin.update",
        label: t("Update"),
        icon: IconNames.REFRESH,
        eligible: (row) => row.installed,
        run: async (row) => {
          await update(row.source);
          return !usePluginStore.getState().error;
        },
      },
      {
        key: "plugin.remove",
        label: t("Remove"),
        icon: IconNames.TRASH,
        intent: Intent.DANGER,
        destructive: true,
        eligible: () => true,
        run: async (row) => {
          await remove(row.source, row.scope);
          return !usePluginStore.getState().error;
        },
      },
    ],
    [remove, setEnabled, t, update],
  );

  const onReload = useCallback(() => void refresh(), [refresh]);

  return (
    <div className="AppScreen PluginsScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        centerContent={
          selection.count > 0 ? (
            <BulkActionsBar
              items={rows}
              getId={rowKey}
              selectedIds={selection.selectedIds}
              actions={bulkActions}
              onClear={selection.clear}
              refresh={refresh}
            />
          ) : undefined
        }
        rightContent={
          <PluginActionsMenu
            navigation={<ScreenHeaderSectionsTabBar expand isActive={(screen) => screen === ID} />}
            onReload={onReload}
          />
        }
      />
      <div className="AppScreenContent">
        {error ? (
          <Callout intent={Intent.DANGER} icon={IconNames.ERROR} className="PluginError">
            {error}
          </Callout>
        ) : null}
        {progress ? (
          <Callout intent={Intent.PRIMARY} icon={IconNames.CLOUD_DOWNLOAD} className="PluginProgress">
            {progress.source}: {progress.message}
          </Callout>
        ) : null}
        {rows.length === 0 ? (
          <NonIdealState
            icon={IconNames.CUBE_ADD}
            title={t("No plugins installed")}
            description={t(
              "Install a pi plugin from npm or git to add commands, skills and prompt templates to the coding agent.",
            )}
          />
        ) : (
          <HTMLTable compact interactive className="AppDataTable PluginsTable" data-table="ai-plugins">
            <thead>
              <tr>
                <th data-column="Name">{t("Plugin")}</th>
                <th data-column="Scope">{t("Scope")}</th>
                <th data-column="State">{t("State")}</th>
                <th data-column="Commands">{t("Commands")}</th>
                <th data-column="Skills">{t("Skills")}</th>
                <th data-column="Prompts">{t("Prompts")}</th>
                <th data-column="Actions">&nbsp;</th>
                <th data-column="select" className="BulkSelectColumn">
                  <SelectionCheckbox
                    checked={selection.headerState.checked}
                    indeterminate={selection.headerState.indeterminate}
                    onChange={selection.toggleAll}
                    title={t("Select all")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key} data-enabled={row.enabled ? "true" : "false"}>
                    <td data-column="Name">
                      <div className="PluginName">
                        <Icon icon={KIND_ICON[row.kind]} />
                        <span className="PluginNameText" title={row.source}>
                          {row.name}
                        </span>
                        {updatable.includes(row.source) ? (
                          <Tag minimal intent={Intent.WARNING}>
                            {t("Update available")}
                          </Tag>
                        ) : null}
                      </div>
                    </td>
                    <td data-column="Scope">{row.scope === "project" ? t("Project") : t("User")}</td>
                    <td data-column="State">
                      <div className="PluginState">
                        <Tag minimal intent={row.enabled ? Intent.SUCCESS : Intent.NONE}>
                          {row.enabled ? t("Enabled") : t("Disabled")}
                        </Tag>
                        {row.installed ? null : (
                          <Tag minimal intent={Intent.WARNING} title={t("Configured but not present on disk")}>
                            {t("Not installed")}
                          </Tag>
                        )}
                      </div>
                    </td>
                    <td data-column="Commands">
                      <Contributions names={row.commands} prefix="/" />
                    </td>
                    <td data-column="Skills">
                      <Contributions names={row.skills} />
                    </td>
                    <td data-column="Prompts">
                      <Contributions names={row.prompts} prefix="/" />
                    </td>
                    <td data-column="Actions">
                      <PluginActionsMenu row={row} />
                    </td>
                    {/* Last column: a checkbox first breaks the grouped/tree views this table shares styling with. */}
                    <td data-column="select" className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(key)}
                        onChange={() => selection.toggle(key)}
                        title={busy ? t("An operation is running") : row.name}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/plugins",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD,
  RequiresAI: true,
  ExcludeFromSidebar: true,
};
