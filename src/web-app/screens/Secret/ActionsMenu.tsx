import { Button, ButtonGroup, Divider, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Secret } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { goToScreen } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { CreateDrawer } from "./CreateDrawer";
import { getSecretUrl } from "./Navigation";
import { useRemoveSecret } from "./queries";

const logger = createLogger("web.secret");

// Secret actions menu

export interface SecretActionsMenuProps {
  secret?: Secret;
  connectionId?: string;
  withoutCreate?: boolean;
  onReload?: () => void;
}

export const SecretActionsMenu: React.FC<SecretActionsMenuProps> = ({
  secret,
  connectionId: connectionIdProp,
  withoutCreate,
  onReload,
}: SecretActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [withCreate, setWithCreate] = useState(false);
  // The row's owning connection in the merged list; falls back to the primary for the header/create usage.
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connectionIdProp || primaryConnectionId;
  const secretRemove = useRemoveSecret(connectionId);
  const performActionCommand = useCallback(
    async (action: string) => {
      const result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "secret.remove":
            if (secret) {
              result.success = await secretRemove.mutateAsync(secret.ID);
            }
            break;
          default:
            break;
        }
        Notification.show({
          message: t("Command completed"),
          intent: Intent.SUCCESS,
        });
        if (action === "secret.remove") {
          goToScreen("/screens/secrets");
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
    [secret, secretRemove, t],
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
    [performActionCommand],
  );
  const startButton = withoutCreate ? null : (
    <Button size="small" intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );
  const removeWidget = secret ? (
    <ConfirmMenu onConfirm={onRemove} tag={secret.ID} disabled={disabledAction === "secret.remove"}>
      <MenuItem icon={IconNames.EYE_OPEN} text={t("Inspect")} href={getSecretUrl(secret.ID, "inspect", connectionId)} />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      {!secret && onReload ? (
        <ResourceListActions
          actions={withoutCreate ? undefined : { icon: IconNames.PLUS, text: t("Create"), onClick: onCreateClick }}
          onReload={onReload}
        />
      ) : (
        <ButtonGroup className={secret ? "ResourceItemInlineActionsMenu" : undefined}>
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
      )}
      {withCreate && <CreateDrawer onClose={onCreateSecretClose} />}
    </>
  );
};
