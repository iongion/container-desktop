import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project

import { getSettingsUrl } from "./Navigation";
import { useStoreState } from "../../domain/types";

// Actions menu
interface ActionsMenuProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ expand, isActive }) => {
  const { t } = useTranslation();
  const isRunning = useStoreState((state) => state.descriptor.running);

  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        minimal
        active={isActive ? isActive("settings.user-settings") : false}
        icon={IconNames.COG}
        text={t("User settings")}
        href={getSettingsUrl("user-settings")}
      />
      <AnchorButton
        minimal
        disabled={!isRunning}
        active={isActive ? isActive("settings.system-info") : false}
        icon={IconNames.EYE_OPEN}
        text={t("System info")}
        href={getSettingsUrl("system-info")}
        title={isRunning ? t("") : t("Access to this screen requires connection")}
      />
    </>
  ) : undefined;

  return (
    <ButtonGroup>
      {expandAsButtons}
    </ButtonGroup>
  );
};
