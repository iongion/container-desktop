import { useCallback, useState } from "react";
import { AnchorButton, ButtonGroup, MenuItem, Intent, Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project
import { ConfirmMenu } from "../../components/ConfirmMenu";
import { Notification } from "../../Notification";
import { goToScreen } from "../../Navigator";

import { useStoreActions } from "../../domain/types";
import { getPodUrl } from "./Navigation";
import { CreateDrawer } from "./CreateDrawer";
import { Pod, PodStatusList } from "../../Types.container-app";

// Actions menu
interface ListActionsMenuProps {
  withoutCreate?: boolean;
}
interface ItemActionsMenuProps {
  pod: Pod;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ItemActionsMenu: React.FC<ItemActionsMenuProps> = ({ pod, expand, isActive }) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const podFetch = useStoreActions((actions) => actions.pod.podFetch);
  const podPause = useStoreActions((actions) => actions.pod.podPause);
  const podUnpause = useStoreActions((actions) => actions.pod.podUnpause);
  const podStop = useStoreActions((actions) => actions.pod.podStop);
  const podRestart = useStoreActions((actions) => actions.pod.podRestart);
  const podRemove = useStoreActions((actions) => actions.pod.podRemove);
  const performActionCommand = useCallback(
    async (action: string, { confirm }: PerformActionOptions = { confirm: { success: true, error: true } }) => {
      setDisabledAction(action);
      try {
        // TODO: Improve notifications
        let success = false;
        let notifyFailure = true;
        switch (action) {
          case "pod.inspect":
            await podFetch(pod);
            break;
          case "pod.stop":
            success = await podStop(pod);
            break;
          case "pod.pause":
            success = await podPause(pod);
            break;
          case "pod.unpause":
            success = await podUnpause(pod);
            break;
          case "pod.restart":
            success = await podRestart(pod);
            break;
          case "pod.remove":
            success = await podRemove(pod);
            break;
          default:
            break;
        }
        if (notifyFailure && !success) {
          Notification.show({ message: t("Command failed"), intent: Intent.DANGER });
        }
        if (action === "pod.remove") {
          goToScreen("/screens/pods");
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
    [pod, podFetch, podPause, podUnpause, podStop, podRestart, podRemove, t]
  );
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("pod.remove");
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

  const isKubeDisabled = pod.Containers.length <= 1;
  const kubeTitle = isKubeDisabled ? t("Unable to generate kube - pod only has an infra container") : "";

  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        minimal
        active={isActive ? isActive("pod.logs") : false}
        icon={IconNames.LIST}
        text={t("Logs")}
        href={getPodUrl(pod.Id, "logs")}
      />
      <AnchorButton
        minimal
        active={isActive ? isActive("pod.processes") : false}
        icon={IconNames.LIST_DETAIL_VIEW}
        text={t("Processes")}
        href={getPodUrl(pod.Id, "processes")}
      />
      <AnchorButton
        minimal
        active={isActive ? isActive("pod.inspect") : false}
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getPodUrl(pod.Id, "inspect")}
      />
      <AnchorButton
        minimal
        disabled={isKubeDisabled}
        active={isActive ? isActive("pod.kube") : false}
        icon={IconNames.TEXT_HIGHLIGHT}
        text={t("Kube")}
        href={getPodUrl(pod.Id, "kube")}
        title={kubeTitle}
      />
    </>
  ) : undefined;
  const expandAsMenuItems = expand ? undefined : (
    <>
      <MenuItem icon={IconNames.LIST} text={t("Logs")} href={getPodUrl(pod.Id, "logs")} />
      <MenuItem icon={IconNames.LIST_DETAIL_VIEW} text={t("Processes")} href={getPodUrl(pod.Id, "processes")} />
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getPodUrl(pod.Id, "inspect")} />
      <MenuItem icon={IconNames.TEXT_HIGHLIGHT} text={t("Kube")} href={getPodUrl(pod.Id, "kube")} disabled={isKubeDisabled} title={kubeTitle} />
    </>
  );

  const isRunning = pod.Status === PodStatusList.RUNNING;
  const isPaused = pod.Status === PodStatusList.PAUSED;
  const isStopped = pod.Status === PodStatusList.STOPPED;
  // TODO: State machine - manage transitional states
  const canPauseUnpause = isRunning || isPaused;
  const canStop = isRunning && !isStopped;
  const canRestart = !isPaused;

  return (
    <>
      <ButtonGroup>
        {expandAsButtons}
        <ConfirmMenu onConfirm={onRemove} tag={pod.Id} disabled={disabledAction === "pod.remove"}>
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
      </ButtonGroup>
    </>
  );
};

export const ListActionsMenu: React.FC<ListActionsMenuProps> = ({ withoutCreate }) => {
  const { t } = useTranslation();
  const [withCreate, setWithCreate] = useState(false);
  const onCreateClick = useCallback(() => {
    setWithCreate(true);
  }, []);
  const onCreateSecretClose = useCallback(() => {
    setWithCreate(false);
  }, []);
  const startButton = withoutCreate ? null : (
    <Button small intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  return (
    <>
      <ButtonGroup>
        {startButton}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateSecretClose} />}
    </>
  );
};
