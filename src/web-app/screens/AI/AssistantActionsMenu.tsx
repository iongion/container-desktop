// The Assistant screen header's actions: start a session (the primary CTA, which opens the start drawer)
// or stop the running one. Rendered through the shared ResourceListActions so this header matches every other
// screen's in size, spacing and order.

import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
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
            />
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
