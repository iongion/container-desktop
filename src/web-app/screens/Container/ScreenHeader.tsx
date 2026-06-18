import { type IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { Container } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";

interface ScreenHeaderProps {
  container: Container;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  onReload?: () => void;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  container,
  currentScreen,
  listRoutePath,
  listRouteIcon,
  onReload,
}: ScreenHeaderProps) => {
  const { t } = useTranslation();
  // Keep the owning connection while moving between this resource's detail views (ids collide across engines).
  const { connId } = useRouteSearch<{ connId?: string }>();
  let currentListRoutePath = listRoutePath;
  if (container && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/containers");
  }
  const nameText = container.Name || container.Id || t("- n/a -");
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={nameText.startsWith("/") ? nameText.slice(1) : nameText}
      rightContent={
        <ActionsMenu
          container={container}
          connectionId={connId}
          expand
          withInlinePlayerActions
          onReload={onReload}
          isActive={(input) => input === currentScreen}
        />
      }
    />
  );
};
