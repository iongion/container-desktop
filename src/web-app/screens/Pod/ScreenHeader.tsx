import { type IconName, IconNames } from "@blueprintjs/icons";

import type { Pod } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ItemActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  pod?: Pod;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  pod,
  currentScreen,
  listRoutePath,
  listRouteIcon,
}: ScreenHeaderProps) => {
  // Keep the owning connection while moving between this resource's detail views (ids collide across engines).
  const { connId } = useRouteSearch<{ connId?: string }>();
  let currentListRoutePath = listRoutePath;
  if (pod && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/pods");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.CUBE_ADD}
      titleText={pod?.Name || pod?.Id || ""}
      rightContent={
        pod ? (
          <ItemActionsMenu pod={pod} connectionId={connId} expand isActive={(input) => input === currentScreen} />
        ) : undefined
      }
    />
  );
};
