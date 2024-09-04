import { IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { Container } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";

interface ScreenHeaderProps {
  container: Container;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ container, currentScreen, listRoutePath, listRouteIcon }: ScreenHeaderProps) => {
  const { t } = useTranslation();
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
      rightContent={<ActionsMenu container={container} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
