import { AnchorButton, Button, ButtonGroup, Divider, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiPlayCircle } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useStoreActions } from "@/web-app/domain/types";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";

import { ContainerImage } from "@/env/Types";
import { CreateDrawer } from "./CreateDrawer";
import { getImageUrl } from "./Navigation";

interface ActionsMenuProps {
  image?: ContainerImage;
  withoutStart?: boolean;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
  onReload?: () => void;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ expand, image, withoutStart, isActive, onReload }: ActionsMenuProps) => {
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
            result = await imageRemove(image!);
            break;
          case "image.pull":
            result = await imagePull(image!);
            break;
          case "image.push":
            result = await imagePush(image!);
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
    <Button small minimal intent={Intent.SUCCESS} text={t("Start")} icon={<ReactIcon.Icon path={mdiPlayCircle} size={0.75} />} onClick={onCreateClick} />
  );
  const expandAsButtons =
    image && expand ? (
      <>
        <AnchorButton minimal active={isActive ? isActive("image.layers") : false} icon={IconNames.LAYERS} text={t("Layers")} href={getImageUrl(image.Id, "layers")} />
        <AnchorButton minimal active={isActive ? isActive("image.inspect") : false} icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getImageUrl(image.Id, "inspect")} />
        <AnchorButton
          minimal
          active={isActive ? isActive("image.security") : false}
          icon={IconNames.CONFIRM}
          text={t("Security")}
          intent={Intent.DANGER}
          href={getImageUrl(image!.Id, "security")}
        />
      </>
    ) : undefined;
  const expandAsMenuItems =
    expand || !image ? undefined : (
      <>
        <MenuItem icon={IconNames.LAYERS} text={t("Layers")} href={getImageUrl(image.Id, "layers")} />
        <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getImageUrl(image.Id, "inspect")} />
        <MenuItem icon={IconNames.CONFIRM} text={t("Security check")} href={getImageUrl(image.Id, "security")} />
      </>
    );
  return (
    <>
      <ButtonGroup>
        {startButton}
        {onReload && (
          <>
            {startButton ? <Divider /> : null}
            <Button small minimal intent={Intent.NONE} title={t("Reload current list")} icon={IconNames.REFRESH} onClick={onReload} />
          </>
        )}
        {expandAsButtons}
        {image ? (
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
        ) : null}
      </ButtonGroup>
      {withCreate && image && <CreateDrawer image={image} onClose={onCreateClose} />}
    </>
  );
};
