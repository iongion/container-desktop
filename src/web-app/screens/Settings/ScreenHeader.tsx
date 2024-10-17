import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

import { useStoreState } from "@/web-app/domain/types";

import { getSettingsUrl } from "./Navigation";
interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  expand,
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  const isRunning = useStoreState((state) => state.running);
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        minimal
        active={isActive ? isActive("settings-settings") : false}
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
  return <ButtonGroup>{expandAsButtons}</ButtonGroup>;
};

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  currentScreen,
  titleText,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader
      titleText={titleText}
      withoutSearch
      rightContent={<ScreenHeaderSectionsTabBar expand isActive={(input) => input === currentScreen} />}
    >
      {children}
    </AppScreenHeader>
  );
};
