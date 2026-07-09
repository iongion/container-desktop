import { Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Network } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { CreateDrawer } from "./CreateDrawer";
import { getNetworkUrl } from "./Navigation";
import { useRemoveNetwork } from "./queries";

const logger = createLogger("web.network");

// Network actions menu

interface ActionsMenuProps {
  network?: Network;
  connectionId?: string;
  navigation?: React.ReactNode;
  withoutCreate?: boolean;
  onReload?: () => void;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  network,
  connectionId: connectionIdProp,
  navigation,
  withoutCreate,
  onReload,
}: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // The row's owning connection in the merged list; falls back to the primary for the header/create usage.
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connectionIdProp || primaryConnectionId;
  const networkRemove = useRemoveNetwork(connectionId);
  const performActionCommand = useCallback(
    async (
      action: string,
      { confirm }: PerformActionOptions = {
        confirm: { success: true, error: true },
      },
    ) => {
      const result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "network.remove":
            if (network) {
              result.success = await networkRemove.mutateAsync(network.name);
            }
            break;
          default:
            break;
        }
        if (confirm?.success) {
          Notification.show({
            message: t("Command completed"),
            intent: Intent.SUCCESS,
          });
        }
        if (action === "network.remove") {
          goToScreen("/screens/networks");
        }
      } catch (error: any) {
        logger.error("Command execution failed", error);
        Notification.show({
          message: t("Command did not execute properly - {{message}} {{data}}", {
            message: error.message,
            data: error.data,
          }),
          intent: Intent.DANGER,
        });
      }
      setDisabledAction(undefined);
    },
    [network, networkRemove, t],
  );
  const onCreateClick = useCallback(() => {
    setWithCreate(true);
  }, []);
  const onCreateClose = useCallback(() => {
    setWithCreate(false);
  }, []);
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("network.remove");
      }
    },
    [performActionCommand],
  );
  const startButton = withoutCreate ? null : (
    <Button size="small" intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = network ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={network.name}
      disabled={disabledAction === "network.remove"}
      large={!!onReload}
    >
      <MenuItem
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getNetworkUrl(network.id, "inspect", connectionId)}
      />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      {onReload ? (
        <ResourceListActions
          actions={withoutCreate ? undefined : { icon: IconNames.PLUS, text: t("Create"), onClick: onCreateClick }}
          navigation={navigation}
          utilityActions={removeWidget}
          utilityActionsPlacement="before-reload"
          onReload={onReload}
        />
      ) : (
        <ButtonGroup className={network ? "ResourceItemInlineActionsMenu" : undefined}>
          {startButton}
          {removeWidget}
        </ButtonGroup>
      )}
      {withCreate && <CreateDrawer onClose={onCreateClose} />}
    </>
  );
};
