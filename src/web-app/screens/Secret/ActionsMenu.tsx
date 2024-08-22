import { Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Secret } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { useStoreActions } from "@/web-app/domain/types";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";

import { CreateDrawer } from "./CreateDrawer";
import { getSecretUrl } from "./Navigation";

// Secret actions menu

export interface SecretActionsMenuProps {
  secret?: Secret;
  withoutCreate?: boolean;
}

export const SecretActionsMenu: React.FC<SecretActionsMenuProps> = ({ secret, withoutCreate }: SecretActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  const secretRemove = useStoreActions((actions) => actions.secret.secretRemove);
  const secretFetch = useStoreActions((actions) => actions.secret.secretFetch);
  const performActionCommand = useCallback(
    async (action: string) => {
      let result = { success: false, message: `No action handler for ${action}` };
      setDisabledAction(action);
      try {
        switch (action) {
          case "secret.remove":
            if (secret) {
              result = await secretRemove(secret);
            }
            break;
          case "secret.inspect":
            if (secret) {
              result = await secretFetch({ Id: secret.ID });
            }
            break;
          default:
            break;
        }
        Notification.show({ message: t("Command completed"), intent: Intent.SUCCESS });
        if (action === "secret.remove") {
          goToScreen("/screens/secrets");
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
    [secret, secretRemove, secretFetch, t]
  );
  const onCreateClick = useCallback(() => {
    setWithCreate(true);
  }, []);
  const onCreateSecretClose = useCallback(() => {
    setWithCreate(false);
  }, []);
  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("secret.remove");
      }
    },
    [performActionCommand]
  );
  const startButton = withoutCreate ? null : <Button small intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />;
  const removeWidget = secret ? (
    <ConfirmMenu onConfirm={onRemove} tag={secret.ID} disabled={disabledAction === "secret.remove"}>
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getSecretUrl(secret.ID, "inspect")} />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        {startButton}
        {removeWidget}
      </ButtonGroup>
      {withCreate && <CreateDrawer onClose={onCreateSecretClose} />}
    </>
  );
};
