import { Button, ButtonGroup, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorkerDefinition } from "@/ai-system/core/workers";
import { createLogger } from "@/logger";
import { randomUUID } from "@/utils/randomUUID";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { Notification } from "@/web-app/Notification";

import { CreateDrawer } from "./CreateDrawer";
import { useRemoveWorker, useSaveWorker } from "./queries";

const logger = createLogger("web.ai.worker");

export interface WorkerActionsMenuProps {
  worker?: WorkerDefinition;
  withoutCreate?: boolean;
  onReload?: () => void;
}

export const WorkerActionsMenu: React.FC<WorkerActionsMenuProps> = ({ worker, withoutCreate, onReload }) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<WorkerDefinition | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const workerRemove = useRemoveWorker();
  const workerSave = useSaveWorker();

  const onCreateClick = useCallback(() => {
    setEditing(undefined);
    setDrawerOpen(true);
  }, []);
  const onEditClick = useCallback(() => {
    setEditing(worker);
    setDrawerOpen(true);
  }, [worker]);
  const onDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setEditing(undefined);
  }, []);

  const performActionCommand = useCallback(
    async (action: string) => {
      setDisabledAction(action);
      try {
        switch (action) {
          case "worker.remove":
            if (worker) {
              await workerRemove.mutateAsync(worker.id);
            }
            break;
          case "worker.duplicate":
            if (worker) {
              const now = Date.now();
              await workerSave.mutateAsync({
                ...worker,
                id: randomUUID(),
                name: t("{{name}} (copy)", { name: worker.name }),
                createdAt: now,
                updatedAt: now,
              });
            }
            break;
          default:
            break;
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
    [worker, workerRemove, workerSave, t],
  );

  const onRemove = useCallback(
    (_tag: any, confirmed: boolean) => {
      if (confirmed) {
        void performActionCommand("worker.remove");
      }
    },
    [performActionCommand],
  );

  const startButton = withoutCreate ? null : (
    <Button size="small" intent={Intent.SUCCESS} text={t("Create")} icon={IconNames.PLUS} onClick={onCreateClick} />
  );

  const editButton = worker ? (
    <Button size="small" variant="minimal" icon={IconNames.EDIT} title={t("Edit")} onClick={onEditClick} />
  ) : undefined;

  const removeWidget = worker ? (
    <ConfirmMenu onConfirm={onRemove} tag={worker.id} disabled={disabledAction === "worker.remove"} large={!!onReload}>
      <MenuItem icon={IconNames.EDIT} text={t("Edit")} onClick={onEditClick} />
      <MenuItem
        icon={IconNames.DUPLICATE}
        text={t("Duplicate")}
        disabled={disabledAction === "worker.duplicate"}
        onClick={() => void performActionCommand("worker.duplicate")}
      />
    </ConfirmMenu>
  ) : undefined;

  return (
    <>
      {onReload ? (
        <ResourceListActions
          actions={
            withoutCreate ? undefined : { icon: IconNames.PLUS, text: t("Create worker"), onClick: onCreateClick }
          }
          utilityActions={removeWidget}
          utilityActionsPlacement="before-reload"
          onReload={onReload}
        />
      ) : (
        <ButtonGroup className={worker ? "ResourceItemInlineActionsMenu" : undefined}>
          {startButton}
          {editButton}
          {removeWidget}
        </ButtonGroup>
      )}
      {drawerOpen && <CreateDrawer worker={editing} onClose={onDrawerClose} />}
    </>
  );
};
