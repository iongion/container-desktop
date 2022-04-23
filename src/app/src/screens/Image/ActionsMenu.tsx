import { useCallback, useState } from "react";
import { AnchorButton, ButtonGroup, MenuItem, Button, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiPlayCircle } from "@mdi/js";

// project
import { ConfirmMenu } from "../../components/ConfirmMenu";
import { Notification } from "../../Notification";
import { ContainerImage } from "../../Types";
import { goToScreen } from "../../Navigator";
import { useStoreActions } from "../../domain/types";

// module
import { CreateDrawer } from "./CreateDrawer";
import { getImageUrl } from "./Navigation";

interface ActionsMenuProps {
  image: ContainerImage;
  withoutStart?: boolean;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ expand, image, withoutStart, isActive }) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  const imagePull = useStoreActions((actions) => actions.image.imagePull);
  const imagePush = useStoreActions((actions) => actions.image.imagePush);
  const imageRemove = useStoreActions((actions) => actions.image.imageRemove);
  const performActionCommand = useCallback(
    async (action: string) => {
      let result = { success: false, message: `No action handler for ${action}` };
      setDisabledAction(action);
      try {
        switch (action) {
          case "image.remove":
            result = await imageRemove(image);
            break;
          case "image.pull":
            result = await imagePull(image);
            break;
          case "image.push":
            result = await imagePush(image);
            break;
          default:
            break;
        }
        Notification.show({ message: t("Command completed"), intent: Intent.SUCCESS });
        if (action === "image.remove") {
          goToScreen("/screens/images");
        }
      } catch (error: any) {
        console.error("Command execution failed", error, result);
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
    [image, imagePull, imagePush, imageRemove, t]
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
        performActionCommand("image.remove");
      }
    },
    [performActionCommand]
  );
  const onActionClick = useCallback(
    async (e) => {
      const sender = e.currentTarget;
      const action = sender.getAttribute("data-action");
      performActionCommand(action);
    },
    [performActionCommand]
  );
  const startButton = withoutStart ? null : (
    <Button
      small
      minimal
      intent={Intent.SUCCESS}
      text={t("Start")}
      icon={<ReactIcon.Icon path={mdiPlayCircle} size={0.75} />}
      onClick={onCreateClick}
    />
  );
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        minimal
        active={isActive ? isActive("image.layers") : false}
        icon={IconNames.LAYERS}
        text={t("Layers")}
        href={getImageUrl(image.Id, "layers")}
      />
      <AnchorButton
        minimal
        active={isActive ? isActive("image.inspect") : false}
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getImageUrl(image.Id, "inspect")}
      />
    </>
  ) : undefined;
  const expandAsMenuItems = expand ? undefined : (
    <>
      <MenuItem icon={IconNames.LAYERS} text={t("Layers")} href={getImageUrl(image.Id, "layers")} />
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getImageUrl(image.Id, "inspect")} />
    </>
  );
  return (
    <>
      <ButtonGroup>
        {startButton}
        {expandAsButtons}
        <ConfirmMenu onConfirm={onRemove} tag={image.Id}>
          {expandAsMenuItems}
          <MenuItem
            data-image={image.Id}
            data-action="image.pull"
            disabled={disabledAction === "image.pull"}
            icon={IconNames.GIT_PULL}
            text={t("Pull")}
            onClick={onActionClick}
          />
          <MenuItem
            data-image={image.Id}
            data-action="image.push"
            disabled={disabledAction === "image.push"}
            icon={IconNames.GIT_PUSH}
            text={t("Push to Hub")}
            onClick={onActionClick}
          />
        </ConfirmMenu>
      </ButtonGroup>
      {withCreate && <CreateDrawer image={image} onClose={onCreateClose} />}
    </>
  );
};
