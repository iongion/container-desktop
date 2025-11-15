import { Button, ButtonGroup, Divider, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Network } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useStoreActions } from "@/web-app/domain/types";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";

import { CreateDrawer } from "./CreateDrawer";

// Network actions menu

interface ActionsMenuProps {
  network?: Network;
  withoutCreate?: boolean;
  onReload?: () => void;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ network, withoutCreate, onReload }: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  const networkFetch = useStoreActions((actions) => actions.network.networkFetch);
  const networkRemove = useStoreActions((actions) => actions.network.networkRemove);
  const performActionCommand = useCallback(
    async (
      action: string,
      { confirm }: PerformActionOptions = {
        confirm: { success: true, error: true },
      },
    ) => {
      let result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "network.remove":
            if (network) {
              result = await networkRemove(network.name);
            }
            break;
          case "network.inspect":
            if (network) {
              result = await networkFetch(network.name);
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
        if (action === "network.remove") {
          goToScreen("/screens/networks");
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
    [network, networkFetch, networkRemove, t],
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
    <Button small intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = network ? (
    <ConfirmMenu onConfirm={onRemove} tag={network.name} disabled={disabledAction === "network.remove"}></ConfirmMenu>
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
      {withCreate && <CreateDrawer onClose={onCreateClose} />}
    </>
  );
};
