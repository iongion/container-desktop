// The Assistant screen header's actions: start a session (the primary CTA, which opens the start drawer), open what
// the running one can reach, or stop it. Rendered through the shared ResourceListActions so this header matches every
// other screen's in size, spacing and order.
//
// Workspace and VS Code live in the "…" overflow rather than in the header row: they are things you do occasionally,
// the row's width belongs to the session's name, and a menu holding one destructive item was a menu wasted.

import { Intent, MenuDivider, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { getHostRuntime } from "@/platform/provider";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { Notification } from "@/web-app/Notification";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

import { StartSessionDrawer } from "./StartSessionDrawer";

export interface AssistantActionsMenuProps {
  navigation?: React.ReactNode;
  onReload: () => void;
}

export const AssistantActionsMenu: React.FC<AssistantActionsMenuProps> = ({
  navigation,
  onReload,
}: AssistantActionsMenuProps) => {
  const { t } = useTranslation();
  const status = useCodingAgentStore((state) => state.status);
  const stop = useCodingAgentStore((state) => state.stop);
  const workspacePath = useCodingAgentStore((state) => state.spec?.workspacePath);
  const [withStart, setWithStart] = useState(false);
  const running = status === "ready";
  const starting = status === "starting";

  const onStartClick = useCallback(() => setWithStart(true), []);
  const onStartClose = useCallback(() => setWithStart(false), []);
  // Stopping removes the container pair, so it is the ConfirmMenu's confirmed action rather than a plain button.
  const onStopConfirm = useCallback(
    (_tag: unknown, confirmed: boolean) => {
      if (confirmed) void stop();
    },
    [stop],
  );
  const onOpenWorkspace = useCallback(() => {
    if (workspacePath) void getHostRuntime().windowControl.openPath(workspacePath);
  }, [workspacePath]);
  // VS Code may simply not be installed, and the vscode:// handler answers that. Saying so beats a menu item that
  // looks like it did something.
  const onOpenInVSCode = useCallback(async () => {
    if (!workspacePath) return;
    const opened = await getHostRuntime().dialogs.openInVSCode(workspacePath);
    if (!opened) {
      Notification.show({ message: t("Unable to open VS Code on this machine."), intent: Intent.WARNING });
    }
  }, [workspacePath, t]);

  return (
    <>
      <ResourceListActions
        actions={
          running
            ? undefined
            : {
                icon: IconNames.PLAY,
                text: t("Start session"),
                title: t("Start an assistant session"),
                onClick: onStartClick,
                disabled: starting,
                loading: starting,
              }
        }
        navigation={navigation}
        utilityActions={
          running ? (
            <ConfirmMenu
              large
              onConfirm={onStopConfirm}
              actionText={t("Stop session")}
              title={t("Stop this session? Its containers are removed.")}
            >
              {/* Two ways into the SAME folder — open it, or open it as a project. */}
              <MenuItem
                className="AssistantSessionWorkspace"
                icon={IconNames.FOLDER_OPEN}
                text={t("Workspace")}
                title={workspacePath}
                disabled={!workspacePath}
                onClick={onOpenWorkspace}
              />
              <MenuItem
                className="AssistantSessionEditor"
                icon={IconNames.CODE}
                text={t("VS Code")}
                title={t("Open {{path}} as a VS Code workspace", { path: workspacePath ?? "" })}
                disabled={!workspacePath}
                onClick={() => void onOpenInVSCode()}
              />
              <MenuDivider />
            </ConfirmMenu>
          ) : undefined
        }
        utilityActionsPlacement="before-reload"
        reloadDisabled={!running}
        onReload={onReload}
      />
      {withStart && <StartSessionDrawer onClose={onStartClose} />}
    </>
  );
};
