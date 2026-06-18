import { Button, ButtonGroup, Divider, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiConsole } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PodmanMachine, PodmanMachineInspect } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

import { CreateDrawer } from "./CreateDrawer";
import { useConnectMachine, useRemoveMachine, useRestartMachine, useStopMachine } from "./queries";

// Machine actions menu

interface ActionsMenuProps {
  machine?: PodmanMachineInspect | PodmanMachine;
  connectionId?: string;
  withoutCreate?: boolean;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
  onReload?: () => void;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  machine,
  connectionId: connectionIdProp,
  withoutCreate,
  onReload,
}: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const isNative = useAppStore((state) => state.native);
  const connectionId = connectionIdProp || currentConnector?.id || "";
  const isRunning = ((machine as any)?.State || "").toLowerCase() === "running" || (machine as any)?.Running;
  const machineRemove = useRemoveMachine(connectionId);
  const machineStop = useStopMachine(connectionId);
  const machineRestart = useRestartMachine(connectionId);
  const machineConnect = useConnectMachine(connectionId);
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
          case "machine.remove":
            if (machine) {
              result.success = await machineRemove.mutateAsync(machine.Name);
            }
            break;
          case "machine.stop":
            if (machine) {
              result.success = await machineStop.mutateAsync(machine.Name);
            }
            break;
          case "machine.restart":
            if (machine) {
              result.success = await machineRestart.mutateAsync(machine.Name);
            }
            break;
          case "machine.connect":
            if (machine) {
              result.success = await machineConnect.mutateAsync(machine.Name);
            }
            break;
          default:
            break;
        }
        console.debug("Command executed", action, result);
        if (confirm?.success) {
          Notification.show({
            message: t("Command completed"),
            intent: Intent.SUCCESS,
          });
        }
        if (action === "machine.remove") {
          goToScreen("/screens/machines");
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
    [machine, machineRemove, machineRestart, machineStop, machineConnect, t],
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
        performActionCommand("machine.remove");
      }
    },
    [performActionCommand],
  );
  const onStop = useCallback(() => {
    performActionCommand("machine.stop");
  }, [performActionCommand]);
  const onRestart = useCallback(() => {
    performActionCommand("machine.restart");
  }, [performActionCommand]);
  const onOpenTerminalConsole = useCallback(async () => {
    performActionCommand("machine.connect", { confirm: { success: false } });
  }, [performActionCommand]);
  const startButton = withoutCreate ? null : (
    <Button size="small" intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = machine ? (
    <ConfirmMenu onConfirm={onRemove} tag={machine.Name} disabled={disabledAction === "machine.remove"}>
      {isNative ? (
        <MenuItem
          data-machine={machine.Name}
          icon={<ReactIcon.Icon path={mdiConsole} size={0.75} />}
          text={t("Open terminal console")}
          onClick={onOpenTerminalConsole}
          disabled={!isRunning}
          title={isRunning ? t("Machine is running") : t("Machine is not running")}
        />
      ) : null}
      <MenuItem
        data-machine={machine.Name}
        data-action="machine.stop"
        onClick={onStop}
        icon={IconNames.STOP}
        intent={Intent.NONE}
        text={t("Stop")}
        disabled={disabledAction === "machine.stop" || !isRunning}
        title={isRunning ? t("Machine is running") : t("Machine is not running")}
      />
      <MenuItem
        data-machine={machine.Name}
        data-action="machine.restart"
        onClick={onRestart}
        icon={IconNames.RESET}
        intent={Intent.NONE}
        disabled={disabledAction === "machine.restart"}
        text={isRunning ? t("Restart") : t("Start")}
      />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup className={machine ? "ResourceItemInlineActionsMenu" : undefined}>
        {startButton}
        {onReload && (
          <>
            {startButton ? <Divider /> : null}
            <Button
              size="small"
              variant="minimal"
              intent={Intent.NONE}
              title={t("Reload current list")}
              icon={IconNames.REFRESH}
              onClick={onReload}
            />
          </>
        )}
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateClose} />}
    </>
  );
};
