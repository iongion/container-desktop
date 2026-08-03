import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import "./ScreenHeader.css";

interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

// Mirrors screens/Troubleshoot/ScreenHeader.tsx — one shared section tab bar for the AI family (the multi-agent
// Runs screen and the Workers library), highlighting whichever screen is active. The AI screens are excluded from
// the sidebar and reached through the header AI menu, so this bar is how they cross-link.
export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  expand,
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  const expandAsButtons = expand ? (
    <>
      <AnchorButton
        variant="minimal"
        // A single run lives under the Runs list, so the run screen keeps this tab lit rather than
        // leaving the bar with nothing active while you watch a run.
        active={isActive ? isActive("ai.runs") || isActive("ai.run") : false}
        icon={IconNames.GRAPH}
        text={t("Runs")}
        href={pathTo("/screens/ai/runs")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("ai.workers") : false}
        icon={IconNames.PEOPLE}
        text={t("Workers")}
        href={pathTo("/screens/ai/workers")}
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
  // The execution screens (Assistant, a single Run) have nothing to search. The list
  // screens (Runs, Workers) do, so search is opt-in rather than suppressed for the whole family.
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement>;
  // A detail sub-screen (a single Run) opts into the canonical ScreenHeader back affordance — the
  // left chevron + optional jump-to-list icon — instead of hand-rolling a labelled button in rightContent.
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
