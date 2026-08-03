import { AnchorButton, Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContainerImage } from "@/container-client/types/image";
import { createLogger } from "@/logger";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { CreateDrawer } from "./CreateDrawer";
import { getImageUrl } from "./Navigation";
import { usePullImage, usePushImage, useRemoveImage } from "./queries";

const logger = createLogger("web.image");

interface ActionsMenuProps {
  image?: ContainerImage;
  connectionId?: string;
  withoutStart?: boolean;
  iconOnly?: boolean;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
  onReload?: () => void;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  expand,
  image,
  connectionId: connectionIdProp,
  withoutStart,
  iconOnly,
  isActive,
  onReload,
}: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // The row's owning connection in the merged list; falls back to the primary for the header/create usage.
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connectionIdProp || primaryConnectionId;
  const imagePull = usePullImage(connectionId);
  const imagePush = usePushImage(connectionId);
  const imageRemove = useRemoveImage(connectionId);
  const performActionCommand = useCallback(
    async (action: string) => {
      const result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "image.remove":
            result.success = await imageRemove.mutateAsync(image!.Id);
            break;
          case "image.pull":
            result.success = await imagePull.mutateAsync(image!.Names?.[0] || image!.FullName || image!.Name);
            break;
          case "image.push":
            result.success = await imagePush.mutateAsync({ id: image!.Id });
            break;
          default:
            break;
        }
        if (action === "image.remove") {
          goToScreen("/screens/images");
        }
      } catch (error: any) {
        logger.error("Command execution failed", error, result);
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
    [image, imagePull, imagePush, imageRemove, t],
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
    [performActionCommand],
  );
  const onActionClick = useCallback(
    async (e) => {
      const sender = e.currentTarget;
      const action = sender.getAttribute("data-action");
      performActionCommand(action);
    },
    [performActionCommand],
  );
  // List rows keep a compact, minimal inline action (no custom fill); the screenheader renders its own
  // call-to-action instead (see below), so this variant is row-only.
  const startButton = withoutStart ? null : (
    <Button
      size="small"
      variant="minimal"
      text={iconOnly ? undefined : t("Start")}
      title={t("Start")}
      icon={IconNames.PLAY}
      onClick={onCreateClick}
    />
  );
  const expandAsButtons =
    image && expand ? (
      <>
        <AnchorButton
          variant="minimal"
          active={isActive ? isActive("image.inspect") : false}
          icon={IconNames.EYE_OPEN}
          text={t("Inspect")}
          href={getImageUrl(image.Id, "inspect", connectionId)}
        />
        <AnchorButton
          variant="minimal"
          active={isActive ? isActive("image.layers") : false}
          icon={IconNames.LAYERS}
          text={t("Layers")}
          href={getImageUrl(image.Id, "layers", connectionId)}
        />
        <AnchorButton
          variant="minimal"
          active={isActive ? isActive("image.security") : false}
          icon={IconNames.CONFIRM}
          text={t("Security check")}
          href={getImageUrl(image!.Id, "security", connectionId)}
        />
      </>
    ) : undefined;
  const expandAsMenuItems =
    expand || !image ? undefined : (
      <>
        <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getImageUrl(image.Id, "inspect", connectionId)} />
        <MenuItem icon={IconNames.LAYERS} text={t("Layers")} href={getImageUrl(image.Id, "layers", connectionId)} />
        <MenuItem
          icon={IconNames.CONFIRM}
          text={t("Security check")}
          href={getImageUrl(image.Id, "security", connectionId)}
        />
      </>
    );
  const overflowMenu = image ? (
    <ConfirmMenu onConfirm={onRemove} tag={image.Id} large={!!onReload}>
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
  ) : null;
  const drawer = withCreate && image && (
    <CreateDrawer image={image} connectionId={connectionId} onClose={onCreateClose} />
  );
  // Screenheader: the primary action becomes a separate call-to-action and the utility actions (menu + reload)
  // trail in a group with the list's 8px gap — reuse ResourceListActions so size/spacing/order match the list.
  if (onReload) {
    return (
      <>
        <ResourceListActions
          actions={
            withoutStart
              ? undefined
              : { icon: IconNames.PLAY, text: t("Start"), title: t("Start"), onClick: onCreateClick }
          }
          navigation={expandAsButtons}
          utilityActions={overflowMenu}
          utilityActionsPlacement="before-reload"
          onReload={onReload}
        />
        {drawer}
      </>
    );
  }
  // List rows: a single compact ButtonGroup keeps the row-specific inline look.
  return (
    <>
      <ButtonGroup className={image ? "ResourceItemInlineActionsMenu" : undefined}>
        {startButton}
        {expandAsButtons}
        {overflowMenu}
      </ButtonGroup>
      {drawer}
    </>
  );
};
