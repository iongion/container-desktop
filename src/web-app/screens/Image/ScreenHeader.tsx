import { type IconName, IconNames } from "@blueprintjs/icons";

import type { ContainerImage } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";
import { getImageCrumbs, imageDisplayName } from "./Navigation";

// Screen header

interface ScreenHeaderProps {
  image: ContainerImage;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  // Extra controls rendered in the header, before the tabs — used by the Security tab for its Scan CTA.
  rightExtra?: React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  image,
  currentScreen,
  listRoutePath,
  listRouteIcon,
  rightExtra,
}: ScreenHeaderProps) => {
  // Keep the owning connection while moving between this resource's detail views (ids collide across engines).
  const { connId } = useRouteSearch<{ connId?: string }>();
  let currentListRoutePath = listRoutePath;
  if (image && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/images");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={imageDisplayName(image)}
      breadcrumbs={getImageCrumbs(imageDisplayName(image), image.Id, currentScreen, connId)}
      rightContent={
        <>
          {rightExtra}
          <ActionsMenu image={image} connectionId={connId} />
        </>
      }
    />
  );
};
