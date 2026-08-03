import { Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/container-client/types/volume";
import { createLogger } from "@/logger";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { CreateDrawer } from "./CreateDrawer";
import { getVolumeUrl } from "./Navigation";
import { useRemoveVolume } from "./queries";

const logger = createLogger("web.volume");

export interface VolumeActionsMenuProps {
  volume?: Volume;
  connectionId?: string;
  navigation?: React.ReactNode;
  withoutCreate?: boolean;
  onReload?: () => void;
}

export const VolumeActionsMenu: React.FC<VolumeActionsMenuProps> = ({
  volume,
  connectionId: connectionIdProp,
  navigation,
  withoutCreate,
  onReload,
}: VolumeActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // The row's owning connection in the merged list; falls back to the primary for the header/create usage.
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connectionIdProp || primaryConnectionId;
  const volumeRemove = useRemoveVolume(connectionId);
  const performActionCommand = useCallback(
    async (action: string) => {
      const result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "volume.remove":
            if (volume) {
              result.success = await volumeRemove.mutateAsync(volume.Name);
            }
            break;
          default:
            break;
        }
        if (action === "volume.remove") {
          goToScreen("/screens/volumes");
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
    [volume, volumeRemove, t],
  );
  const onCreateClick = useCallback(() => {
    setWithCreate(true);
  }, []);
  const onCreateVolumeClose = useCallback(() => {
    setWithCreate(false);
  }, []);
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("volume.remove");
      }
    },
    [performActionCommand],
  );
  const startButton = withoutCreate ? null : (
    <Button size="small" intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = volume ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={volume.Name}
      disabled={disabledAction === "volume.remove"}
      large={!!onReload}
    >
      <MenuItem
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getVolumeUrl(volume.Name, "inspect", connectionId)}
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
        <ButtonGroup className={volume ? "ResourceItemInlineActionsMenu" : undefined}>
          {startButton}
          {removeWidget}
        </ButtonGroup>
      )}
      {withCreate && <CreateDrawer onClose={onCreateVolumeClose} />}
    </>
  );
};
