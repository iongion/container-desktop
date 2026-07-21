import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

interface ScreenHeaderSectionsTabBarProps {
  expand?: boolean;
  isActive?: (screen: string) => boolean;
}

// Mirrors screens/Troubleshoot/ScreenHeader.tsx — one shared section tab bar for the AI family (the Assistant, the
// multi-agent Goal screen and the Workers library), highlighting whichever screen is active. The AI screens are
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
        href={pathTo("/screens/ai/assistant")}
      />
      <AnchorButton
        variant="minimal"
        // A single run lives under the Goals list, so the run screen keeps this tab lit rather than
        // leaving the bar with nothing active while you watch a run.
        active={isActive ? isActive("ai.goals") || isActive("ai.goal") : false}
        icon={IconNames.GRAPH}
        text={t("Goals")}
        href={pathTo("/screens/ai/goals")}
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
  return <ButtonGroup>{expandAsButtons}</ButtonGroup>;
};

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  // The conversational screens (Assistant, a single Goal run) have nothing to search. The list
  // screens (Goals, Workers) do, so search is opt-in rather than suppressed for the whole family.
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement>;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  currentScreen,
  titleText,
  rightContent,
  centerContent,
  searchTerm,
  onSearch,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader
      titleText={titleText}
      withoutSearch={!onSearch}
      searchTerm={searchTerm}
      onSearch={onSearch}
      rightContent={rightContent}
      centerContent={centerContent}
    >
      <ScreenHeaderSectionsTabBar expand isActive={(input) => input === currentScreen} />
      {children}
    </AppScreenHeader>
  );
};
