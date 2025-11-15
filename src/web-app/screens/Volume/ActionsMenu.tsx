import { Button, ButtonGroup, Divider, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useStoreActions } from "@/web-app/domain/types";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";

import { CreateDrawer } from "./CreateDrawer";
import { getVolumeUrl } from "./Navigation";

export interface VolumeActionsMenuProps {
  volume?: Volume;
  withoutCreate?: boolean;
  onReload?: () => void;
}

export const VolumeActionsMenu: React.FC<VolumeActionsMenuProps> = ({
  volume,
  withoutCreate,
  onReload,
}: VolumeActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // const volumeCreate = useStoreActions((actions) => actions.volumeCreate);
  const volumeRemove = useStoreActions((actions) => actions.volume.volumeRemove);
  const volumeFetch = useStoreActions((actions) => actions.volume.volumeFetch);
  const performActionCommand = useCallback(
    async (action: string) => {
      let result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "volume.remove":
            if (volume) {
              result = await volumeRemove(volume);
            }
            break;
          case "volume.inspect":
            if (volume) {
              result = await volumeFetch({ Id: volume.Name });
            }
            break;
          default:
            break;
        }
        console.debug("Command executed", action, result);
        Notification.show({
          message: t("Command completed"),
          intent: Intent.SUCCESS,
        });
        if (action === "volume.remove") {
          goToScreen("/screens/volumes");
        }
      } catch (error: any) {
        console.error("Command execution failed", error);
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
    [volume, volumeRemove, volumeFetch, t],
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
    <Button small intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = volume ? (
    <ConfirmMenu onConfirm={onRemove} tag={volume.Name} disabled={disabledAction === "volume.remove"}>
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getVolumeUrl(volume.Name, "inspect")} />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        {startButton}
        {onReload && (
          <>
            {startButton ? <Divider /> : null}
            <Button
              small
              minimal
              intent={Intent.NONE}
              title={t("Reload current list")}
              icon={IconNames.REFRESH}
              onClick={onReload}
            />
          </>
        )}
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateVolumeClose} />}
    </>
  );
};
