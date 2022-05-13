import { useCallback, useState } from "react";
import { AnchorButton, ButtonGroup, MenuItem, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { Network } from "../../Types.container-app";

// project
import { ConfirmMenu } from "../../components/ConfirmMenu";
import { Notification } from "../../Notification";
import { goToScreen } from "../../Navigator";

import { useStoreActions } from "../../domain/types";
import { getNetworkUrl } from "./Navigation";

// Actions menu
interface ActionsMenuProps {
  network: Network;
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ network, expand, isActive }) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const networkFetch = useStoreActions((actions) => actions.network.networkFetch);
  const networkRemove = useStoreActions((actions) => actions.network.networkRemove);
  const performActionCommand = useCallback(
    async (action: string, { confirm }: PerformActionOptions = { confirm: { success: true, error: true } }) => {
      setDisabledAction(action);
      try {
        // TODO: Improve notifications
        let success = false;
        let notifyFailure = true;
        switch (action) {
          case "network.inspect":
            await networkFetch(network.name);
            break;
          case "network.remove":
            success = await networkRemove(network.name);
            break;
          default:
            break;
        }
        if (notifyFailure && !success) {
          Notification.show({ message: t("Command failed"), intent: Intent.DANGER });
        }
        if (action === "network.remove") {
          goToScreen("/screens/networks");
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
    [network, networkFetch, networkRemove, t]
  );
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("network.remove");
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

  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        minimal
        active={isActive ? isActive("network.inspect") : false}
        icon={IconNames.EYE_OPEN}
        text={t("Inspect")}
        href={getNetworkUrl(network.id, "inspect")}
      />
    </>
  ) : undefined;
  const expandAsMenuItems = expand ? undefined : (
    <>
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getNetworkUrl(network.id, "inspect")} />
    </>
  );

  return (
    <ButtonGroup>
      {expandAsButtons}
      <ConfirmMenu onConfirm={onRemove} tag={network.id} disabled={disabledAction === "network.remove"}>
        {expandAsMenuItems}
      </ConfirmMenu>
    </ButtonGroup>
  );
};
