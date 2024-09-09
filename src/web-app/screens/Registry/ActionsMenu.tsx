import { Button, ButtonGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ContainerRuntime, Registry } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";

import { CreateDrawer } from "./CreateDrawer";

// Registry actions menu

interface ActionsMenuProps {
  registry?: Registry;
  withoutCreate?: boolean;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ registry, withoutCreate }: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const registryFetch = useStoreActions((actions) => actions.registry.registryFetch);
  const registryRemove = useStoreActions((actions) => actions.registry.registryRemove);
  const performActionCommand = useCallback(
    async (action: string, { confirm }: PerformActionOptions = { confirm: { success: true, error: true } }) => {
      let result = { success: false, message: `No action handler for ${action}` };
      setDisabledAction(action);
      try {
        switch (action) {
          case "registry.remove":
            if (registry) {
              result = await registryRemove(registry.name);
            }
            break;
          case "registry.inspect":
            if (registry) {
              result = await registryFetch(registry.name);
            }
            break;
          default:
            break;
        }
        if (confirm?.success) {
          Notification.show({ message: t("Command completed"), intent: Intent.SUCCESS });
        }
        if (action === "registry.remove") {
          goToScreen("/screens/registries");
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
    [registry, registryFetch, registryRemove, t]
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
        performActionCommand("registry.remove");
      }
    },
    [performActionCommand]
  );
  const canCreateRegistry = currentConnector?.runtime === ContainerRuntime.PODMAN;
  const createButton = withoutCreate ? null : (
    <Button
      small
      intent={Intent.SUCCESS}
      disabled={!canCreateRegistry}
      title={canCreateRegistry ? t("Click to configure a new registry") : t("This feature is not available with current connection engine")}
      text={t("Configure")}
      icon={IconNames.PLUS}
      onClick={onCreateClick}
    />
  );
  const removeWidget = registry ? (
    <ConfirmMenu onConfirm={onRemove} tag={registry.name} disabled={disabledAction === "registry.remove" || !registry.isRemovable}></ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        {createButton}
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateClose} />}
    </>
  );
};
