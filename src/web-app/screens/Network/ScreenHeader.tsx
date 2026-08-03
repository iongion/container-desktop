import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { Network } from "@/container-client/types/network";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";
import { getNetworkCrumbs, getNetworksUrl } from "./Navigation";

import "./ScreenHeader.css";

interface ScreenHeaderSectionsTabBarProps {
  isActive?: (screen: string) => boolean;
}

// The Networks navbar tab navigator — mirrors screens/Volume/ScreenHeader.tsx (one shared section tab bar), two
// sections: the Networks list and the Reachability debugger. Dropped into each screen's AppScreenHeader.
export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  return (
    <ButtonGroup className="NetworkHeaderTabs">
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("networks.manage") : false}
        icon={IconNames.HEAT_GRID}
        text={t("Networks")}
        href={getNetworksUrl("manage")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("networks.reachability") : false}
        icon={IconNames.GLOBE_NETWORK}
        text={t("Reachability")}
        href={getNetworksUrl("reachability")}
      />
    </ButtonGroup>
  );
};

// Screen header

interface ScreenHeaderProps {
  network: Network;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  onReload?: () => void;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  network,
  currentScreen,
  listRoutePath,
  listRouteIcon,
  onReload,
}: ScreenHeaderProps) => {
  // Keep the owning connection while moving between this resource's detail views (ids collide across engines).
  const { connId } = useRouteSearch<{ connId?: string }>();
  let currentListRoutePath = listRoutePath;
  if (network && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/networks");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.GRAPH}
      titleText={network.name || network.id || ""}
      breadcrumbs={getNetworkCrumbs(network.name || network.id || "", connId)}
      rightContent={<ActionsMenu withoutCreate network={network} connectionId={connId} onReload={onReload} />}
    />
  );
};
