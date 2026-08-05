import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

import { getAIScreenUrl } from "./Navigation";
import "./ScreenHeader.css";

interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

// Mirrors screens/Volume/ScreenHeader.tsx — one shared section tab bar for the AI family (the Assistant and
// its Plugins), highlighting whichever screen is active. The AI screens are
// excluded from the sidebar and reached through the header AI menu, so this bar is how they cross-link.
export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  expand,
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("ai.assistant") : false}
        icon={IconNames.CHAT}
        text={t("Assistant")}
        href={getAIScreenUrl("assistant")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("ai.plugins") : false}
        icon={IconNames.CUBE_ADD}
        text={t("Plugins")}
        href={getAIScreenUrl("plugins")}
      />
    </>
  ) : undefined;
  return <ButtonGroup className="AISectionTabBar">{expandAsButtons}</ButtonGroup>;
};

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  // The Assistant has nothing to search; a list screen does, so search is opt-in rather than suppressed for the
  // whole family.
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement>;
  // A detail sub-screen opts into the canonical ScreenHeader back affordance — the left chevron + optional
  // jump-to-list icon — instead of hand-rolling a labelled button in rightContent.
  withBack?: boolean;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  currentScreen,
  titleText,
  rightContent,
  centerContent,
  searchTerm,
  onSearch,
  withBack,
  listRoutePath,
  listRouteIcon,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader
      titleText={titleText}
      withoutSearch={!onSearch}
      searchTerm={searchTerm}
      onSearch={onSearch}
      withBack={withBack}
      listRoutePath={listRoutePath}
      listRouteIcon={listRouteIcon}
      rightContent={rightContent}
      centerContent={centerContent}
    >
      <ScreenHeaderSectionsTabBar expand isActive={(input) => input === currentScreen} />
      {children}
    </AppScreenHeader>
  );
};
