import { Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { RunView } from "@/ai-system/core/runEvents";
import { isRunActive } from "@/ai-system/ui/core/stores/goalClient";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";

export interface GoalActionsMenuProps {
  run?: RunView;
  navigation?: React.ReactNode;
  onCreate?: () => void;
  onOpen?: () => void;
  onStop?: () => void;
  onDismiss?: () => void;
  onReload?: () => void;
}

export const GoalActionsMenu: React.FC<GoalActionsMenuProps> = ({
  run,
  navigation,
  onCreate,
  onOpen,
  onStop,
  onDismiss,
  onReload,
}) => {
  const { t } = useTranslation();
  const active = run ? isRunActive(run) : false;

  // Dismiss only drops the run from this renderer's list — it is not a delete, because nothing is persisted.
  // Stopping first would be a different action, so an active run is never offered dismissal.
  const onConfirmDismiss = useCallback(
    (_tag: any, confirmed: boolean) => {
      if (confirmed) onDismiss?.();
    },
    [onDismiss],
  );

  const dismissWidget = run ? (
    <ConfirmMenu onConfirm={onConfirmDismiss} tag={run.runId} disabled={active} large={!!onReload}>
      <MenuItem icon={IconNames.ARROW_RIGHT} text={t("Open")} onClick={onOpen} />
      {active ? <MenuItem icon={IconNames.STOP} text={t("Stop")} onClick={onStop} /> : null}
    </ConfirmMenu>
  ) : undefined;

  if (onReload) {
    return (
      <ResourceListActions
        actions={onCreate ? { icon: IconNames.ADD, text: t("New goal"), onClick: onCreate } : undefined}
        navigation={navigation}
        utilityActions={dismissWidget}
        utilityActionsPlacement="before-reload"
        onReload={onReload}
      />
    );
  }

  return (
    <ButtonGroup className={run ? "ResourceItemInlineActionsMenu" : undefined}>
      {active ? (
        <Button size="small" variant="minimal" icon={IconNames.STOP} title={t("Stop")} onClick={onStop} />
      ) : null}
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.ARROW_RIGHT}
        title={t("Open")}
        intent={run?.planPending ? Intent.WARNING : Intent.NONE}
        onClick={onOpen}
      />
      {dismissWidget}
    </ButtonGroup>
  );
};
