import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

import { getTroubleshootUrl } from "./Navigation";

interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

// Mirrors screens/Connections/ScreenHeader.tsx — one shared section tab bar for the Troubleshoot family
// (the actions page + the Compatibility sub-screen), highlighting whichever screen is active.
export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  expand,
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("troubleshoot") : false}
        icon={IconNames.DIAGNOSIS}
        text={t("Troubleshoot")}
        href={getTroubleshootUrl("actions")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("troubleshoot.compatibility") : false}
        icon={IconNames.COMPARISON}
        text={t("Compatibility")}
        href={getTroubleshootUrl("compatibility")}
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
