import { useCallback, useState } from "react";
import { ButtonGroup, MenuItem, Button, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project
import { ConfirmMenu } from "../../components/ConfirmMenu";
import { Notification } from "../../Notification";
import { goToScreen } from "../../Navigator";
import { useStoreActions } from "../../domain/types";

// module
import { getVolumeUrl } from "./Navigation";
import { CreateDrawer } from "./CreateDrawer";
import { Volume } from "../../Types.container-app";

export interface VolumeActionsMenuProps {
  volume?: Volume;
  withoutCreate?: boolean;
}

export const VolumeActionsMenu: React.FC<VolumeActionsMenuProps> = ({ volume, withoutCreate }) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // const volumeCreate = useStoreActions((actions) => actions.volumeCreate);
  const volumeRemove = useStoreActions((actions) => actions.volume.volumeRemove);
  const volumeFetch = useStoreActions((actions) => actions.volume.volumeFetch);
  const performActionCommand = useCallback(
    async (action: string) => {
      let result = { success: false, message: `No action handler for ${action}` };
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
        Notification.show({ message: t("Command completed"), intent: Intent.SUCCESS });
        if (action === "volume.remove") {
          goToScreen("/screens/volumes");
        }
      } catch (error: any) {
        console.error("Command execution failed", error);
        Notification.show({
          message: t("Command did not execute properly - {{message}} {{data}}", {
            message: error.message,
            data: error.data
          }),
          intent: Intent.DANGER
        });
      }
      setDisabledAction(undefined);
    },
    [volume, volumeRemove, volumeFetch, t]
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
    [performActionCommand]
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
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateVolumeClose} />}
    </>
  );
};
