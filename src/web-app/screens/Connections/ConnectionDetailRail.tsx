import { Alignment, AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import "@/web-app/components/InspectTabs.css";
import { getConnectionUrl } from "./Navigation";

const CONNECTION_DETAIL_VIEWS = [
  {
    screen: "connections.connection-info",
    view: "connection-info",
    label: "Connection info",
    icon: IconNames.EYE_OPEN,
  },
  { screen: "connections.system-info", view: "system-info", label: "System info", icon: IconNames.DESKTOP },
  { screen: "connections.health", view: "health", label: "Engine health", icon: IconNames.PULSE },
] as const;

interface ConnectionDetailRailProps {
  connectionId: string;
  // Active screen id, e.g. "connections.connection-info".
  currentScreen: string;
}

// Left rail navigating a connection's detail views. Reuses the Settings/Inspect rail visual (InspectTabsRail)
// but its items are route links (AnchorButton) so switching view navigates; the active item is the current
// screen.
export function ConnectionDetailRail({ connectionId, currentScreen }: ConnectionDetailRailProps) {
  const { t } = useTranslation();
  return (
    <div className="InspectTabsRail ConnectionDetailRail">
      <ButtonGroup vertical>
        {CONNECTION_DETAIL_VIEWS.map((item) => (
          <AnchorButton
            key={item.view}
            className="InspectTabItem"
            variant="minimal"
            alignText={Alignment.START}
            fill
            active={currentScreen === item.screen}
            icon={item.icon}
            text={t(item.label)}
            href={getConnectionUrl(connectionId, item.view)}
          />
        ))}
      </ButtonGroup>
    </div>
  );
}

interface ConnectionDetailLayoutProps {
  connectionId: string;
  currentScreen: string;
  children: ReactNode;
}

// The shared connection-detail content shell: the left rail beside a scrollable panel holding the active
// view's content. Drops into each detail screen in place of the bare `.AppScreenContent`.
export function ConnectionDetailLayout({ connectionId, currentScreen, children }: ConnectionDetailLayoutProps) {
  return (
    <div className="AppScreenContent InspectTabsContent">
      <ConnectionDetailRail connectionId={connectionId} currentScreen={currentScreen} />
      <div className="InspectTabsPanel ConnectionDetailPanel">{children}</div>
    </div>
  );
}
