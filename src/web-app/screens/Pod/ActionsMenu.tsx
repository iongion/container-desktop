import { AnchorButton, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { type Pod, PodStatusList } from "@/container-client/types/pod";
import { createLogger } from "@/logger";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { CreateDrawer } from "./CreateDrawer";
import { getPodUrl } from "./Navigation";
import { usePausePod, useRemovePod, useRestartPod, useStopPod, useUnpausePod } from "./queries";

const logger = createLogger("web.pod");

// Actions menu
interface ListActionsMenuProps {
  withoutCreate?: boolean;
  onReload?: () => void;
}
interface ItemActionsMenuProps {
  pod: Pod;
  connectionId?: string;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
  onReload?: () => void;
}

export const ItemActionsMenu: React.FC<ItemActionsMenuProps> = ({
  pod,
  connectionId: connectionIdProp,
  expand,
  isActive,
  onReload,
}: ItemActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const currentConnector = useAppStore((state) => state.currentConnector);
  // The row's owning connection in the merged list; falls back to the primary for header/detail usage.
  const primaryConnectionId = currentConnector?.id || "";
  const connectionId = connectionIdProp || primaryConnectionId;
  const podPause = usePausePod(connectionId);
  const podUnpause = useUnpausePod(connectionId);
  const podStop = useStopPod(connectionId);
  const podRestart = useRestartPod(connectionId);
  const podRemove = useRemovePod(connectionId);
  const performActionCommand = useCallback(
    async (action: string) => {
      setDisabledAction(action);
      try {
        // TODO: Improve notifications
        let success = false;
        const notifyFailure = true;
        switch (action) {
          case "pod.stop":
            success = await podStop.mutateAsync(pod.Id);
            break;
          case "pod.pause":
            success = await podPause.mutateAsync(pod.Id);
            break;
          case "pod.unpause":
            success = await podUnpause.mutateAsync(pod.Id);
            break;
          case "pod.restart":
            success = await podRestart.mutateAsync(pod.Id);
            break;
          case "pod.remove":
            success = await podRemove.mutateAsync(pod.Id);
            break;
          default:
            break;
        }
        if (notifyFailure && !success) {
          Notification.show({
            message: t("Command failed"),
            intent: Intent.DANGER,
          });
        }
        if (action === "pod.remove") {
          goToScreen("/screens/pods");
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
    [pod, podPause, podUnpause, podStop, podRestart, podRemove, t],
  );
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("pod.remove");
      }
    },
    [performActionCommand],
  );
  const onActionClick = useCallback(
    async (e) => {
      const sender = e.currentTarget;
      const action = sender.getAttribute("data-action");
      performActionCommand(action || "");
    },
    [performActionCommand],
  );

  const isKubeAvailable = currentConnector?.capabilities?.extensions.kube === true;
  const isKubeDisabled = !isKubeAvailable || pod.Containers.length <= 1;
  const kubeTitle = !isKubeAvailable
    ? t("Kube generation is not available for this connection")
    : isKubeDisabled
      ? t("Unable to generate kube - pod only has an infra container")
      : "";

  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("pod.inspect") : false}
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getPodUrl(pod.Id, "inspect", connectionId)}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("pod.logs") : false}
        icon={IconNames.LIST}
        text={t("Logs")}
        href={getPodUrl(pod.Id, "logs", connectionId)}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("pod.processes") : false}
        icon={IconNames.LIST_COLUMNS}
        text={t("Processes")}
        href={getPodUrl(pod.Id, "processes", connectionId)}
      />
      <AnchorButton
        variant="minimal"
        disabled={isKubeDisabled}
        active={isActive ? isActive("pod.kube") : false}
        icon={IconNames.TEXT_HIGHLIGHT}
        text={t("Kube")}
        href={getPodUrl(pod.Id, "kube", connectionId)}
        title={kubeTitle}
      />
    </>
  ) : undefined;
  const expandAsMenuItems = expand ? undefined : (
    <>
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getPodUrl(pod.Id, "inspect", connectionId)} />
      <MenuItem icon={IconNames.LIST} text={t("Logs")} href={getPodUrl(pod.Id, "logs", connectionId)} />
      <MenuItem
        icon={IconNames.LIST_COLUMNS}
        text={t("Processes")}
        href={getPodUrl(pod.Id, "processes", connectionId)}
      />
      <MenuItem
        icon={IconNames.TEXT_HIGHLIGHT}
        text={t("Kube")}
        href={getPodUrl(pod.Id, "kube", connectionId)}
        disabled={isKubeDisabled}
        title={kubeTitle}
      />
    </>
  );

  const isRunning = pod.Status === PodStatusList.RUNNING;
  const isPaused = pod.Status === PodStatusList.PAUSED;
  const isStopped = pod.Status === PodStatusList.STOPPED;
  // TODO: State machine - manage transitional states
  const canPauseUnpause = isRunning || isPaused;
  const canStop = isRunning && !isStopped;
  const canRestart = !isPaused;

  const overflowMenu = (
    <ConfirmMenu onConfirm={onRemove} tag={pod.Id} disabled={disabledAction === "pod.remove"} large={!!onReload}>
      {expandAsMenuItems}
      <MenuItem
        data-pod={pod.Id}
        data-action={isPaused ? "pod.unpause" : "pod.pause"}
        disabled={!canPauseUnpause}
        icon={IconNames.PAUSE}
        text={isPaused ? t("Resume") : t("Pause")}
        onClick={onActionClick}
      />
      <MenuItem
        data-pod={pod.Id}
        data-action="pod.stop"
        disabled={!canStop}
        icon={IconNames.STOP}
        text={t("Stop")}
        onClick={onActionClick}
      />
      <MenuItem
        data-pod={pod.Id}
        data-action="pod.restart"
        disabled={!canRestart}
        icon={IconNames.RESET}
        text={t("Restart")}
        onClick={onActionClick}
      />
    </ConfirmMenu>
  );
  // Detail screenheader: nav + overflow + reload via the shared ResourceListActions (matches the list header).
  if (onReload) {
    return (
      <ResourceListActions
        navigation={expandAsButtons}
        utilityActions={overflowMenu}
        utilityActionsPlacement="before-reload"
        onReload={onReload}
      />
    );
  }
  // List rows: one compact inline ButtonGroup.
  return (
    <ButtonGroup className="ResourceItemInlineActionsMenu">
      {expandAsButtons}
      {overflowMenu}
    </ButtonGroup>
  );
};

export const ListActionsMenu: React.FC<ListActionsMenuProps> = ({ withoutCreate, onReload }: ListActionsMenuProps) => {
  const { t } = useTranslation();
  const [withCreate, setWithCreate] = useState(false);
  const onCreateClick = useCallback(() => {
    setWithCreate(true);
  }, []);
  const onCreateSecretClose = useCallback(() => {
    setWithCreate(false);
  }, []);
  return (
    <>
      {onReload ? (
        <ResourceListActions
          actions={withoutCreate ? undefined : { icon: IconNames.PLUS, text: t("Create"), onClick: onCreateClick }}
          onReload={onReload}
        />
      ) : null}
      {withCreate && <CreateDrawer onClose={onCreateSecretClose} />}
    </>
  );
};
