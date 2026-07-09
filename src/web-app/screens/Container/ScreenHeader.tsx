import { type IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { Container } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";
import { ContainerStatusPill } from "./ContainerStatusPill";
import { getContainerCrumbs } from "./Navigation";

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
  const displayName = nameText.startsWith("/") ? nameText.slice(1) : nameText;
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={displayName}
      breadcrumbs={getContainerCrumbs(displayName, container.Id, currentScreen, connId)}
      rightContent={
        // Sections (Inspect/Logs/Processes/Kube) live in the left rail now; the header keeps the container's
        // health+state pill, the inline player actions (pause/stop/play) and the "…" menu.
        <>
          <ContainerStatusPill container={container} />
          <ActionsMenu container={container} connectionId={connId} withInlinePlayerActions onReload={onReload} />
        </>
      }
    />
  );
};
