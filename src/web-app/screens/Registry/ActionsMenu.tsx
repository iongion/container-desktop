import { useCallback, useState } from "react";
import { ButtonGroup, Button, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { Registry } from "../../Types.container-app";

// project
import { ConfirmMenu } from "../../components/ConfirmMenu";
import { Notification } from "../../Notification";
import { goToScreen } from "../../Navigator";
import { useStoreActions } from "../../domain/types";

// module
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

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ registry, withoutCreate }) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
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
  const startButton = withoutCreate ? null : (
    <Button small intent={Intent.SUCCESS} text={t("Configure")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = registry ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={registry.name}
      disabled={disabledAction === "registry.remove" || !registry.isRemovable}
    ></ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        {startButton}
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateClose} />}
    </>
  );
};
