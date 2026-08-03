import { Button, ButtonGroup, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PluginRow } from "@/ai-system/core/pluginCatalog";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { usePluginStore } from "@/web-app/stores/pluginStore";

import { InstallDrawer } from "./InstallDrawer";

export interface PluginActionsMenuProps {
  // A row's actions in the list; absent for the header, which acts on the whole set.
  row?: PluginRow;
  navigation?: React.ReactNode;
  onReload?: () => void;
}

export const PluginActionsMenu: React.FC<PluginActionsMenuProps> = ({
  row,
  navigation,
  onReload,
}: PluginActionsMenuProps) => {
  const { t } = useTranslation();
  const busy = usePluginStore((state) => state.busy);
  const remove = usePluginStore((state) => state.remove);
  const update = usePluginStore((state) => state.update);
  const checkUpdates = usePluginStore((state) => state.checkUpdates);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const [withInstall, setWithInstall] = useState(false);

  const onInstallClick = useCallback(() => setWithInstall(true), []);
  const onInstallClose = useCallback(() => setWithInstall(false), []);
  const onRemove = useCallback(
    (tag: PluginRow | undefined, confirmed: boolean) => {
      if (confirmed && tag) void remove(tag.source, tag.scope);
    },
    [remove],
  );
  const toggleButton = row ? (
    <Button
      size="small"
      variant="minimal"
      disabled={busy}
      icon={row.enabled ? IconNames.EYE_OFF : IconNames.EYE_OPEN}
      title={row.enabled ? t("Disable this plugin, keeping it installed") : t("Enable this plugin")}
      text={row.enabled ? t("Disable") : t("Enable")}
      onClick={() => void setEnabled(row.source, !row.enabled, row.scope)}
    />
  ) : null;

  // Row: removing a plugin is the destructive action, so it is the ConfirmMenu's confirmed item and update
  // rides along inside it. The header has nothing destructive — updating every plugin only moves versions
  // forward — so it gets plain minimal buttons instead of a menu that would read as a delete.
  const utilityMenu = row ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={row}
      disabled={busy}
      large={!!onReload}
      title={t("Remove {{name}}?", { name: row.name })}
    >
      <MenuItem icon={IconNames.REFRESH} text={t("Update")} disabled={busy} onClick={() => void update(row.source)} />
    </ConfirmMenu>
  ) : (
    <>
      <Button
        variant="minimal"
        disabled={busy}
        icon={IconNames.SEARCH_TEMPLATE}
        text={t("Check for updates")}
        onClick={() => void checkUpdates()}
      />
      <Button
        variant="minimal"
        disabled={busy}
        icon={IconNames.REFRESH}
        text={t("Update all")}
        onClick={() => void update()}
      />
    </>
  );

  return (
    <>
      {onReload ? (
        <ResourceListActions
          actions={{ icon: IconNames.PLUS, text: t("Install plugin"), onClick: onInstallClick, disabled: busy }}
          navigation={navigation}
          utilityActions={utilityMenu}
          utilityActionsPlacement="before-reload"
          reloadDisabled={busy}
          onReload={onReload}
        />
      ) : (
        <ButtonGroup className={row ? "ResourceItemInlineActionsMenu" : undefined}>
          {toggleButton}
          {utilityMenu}
        </ButtonGroup>
      )}
      {withInstall && <InstallDrawer onClose={onInstallClose} />}
    </>
  );
};
