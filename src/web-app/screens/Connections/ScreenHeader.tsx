import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

import { useAppStore } from "@/web-app/stores/appStore";

import { getConnectionsUrl } from "./Navigation";

interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  expand,
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  const isRunning = useAppStore((state) => state.running);
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("connections.manage") : false}
        icon={IconNames.DATA_CONNECTION}
        text={t("Connections")}
        href={getConnectionsUrl("manage")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("connections.health") : false}
        icon={IconNames.PULSE}
        text={t("Health")}
        href={getConnectionsUrl("health")}
      />
      <AnchorButton
        variant="minimal"
        disabled={!isRunning}
        active={isActive ? isActive("connections.connection-info") : false}
        icon={IconNames.POWER}
        text={t("Connection info")}
        href={getConnectionsUrl("connection-info")}
        title={isRunning ? t("") : t("Access to this screen requires connection")}
      />
      <AnchorButton
        variant="minimal"
        disabled={!isRunning}
        active={isActive ? isActive("connections.system-info") : false}
        icon={IconNames.EYE_OPEN}
        text={t("System info")}
        href={getConnectionsUrl("system-info")}
        title={isRunning ? t("") : t("Access to this screen requires connection")}
      />
    </>
  ) : undefined;
  return <ButtonGroup>{expandAsButtons}</ButtonGroup>;
};

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  currentScreen,
  titleText,
  rightContent,
  centerContent,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader titleText={titleText} withoutSearch rightContent={rightContent} centerContent={centerContent}>
      <ScreenHeaderSectionsTabBar expand isActive={(input) => input === currentScreen} />
      {children}
    </AppScreenHeader>
  );
};
