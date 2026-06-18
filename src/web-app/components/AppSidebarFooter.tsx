import { Alignment, AnchorButton, Intent, Navbar, NavbarGroup, Spinner, SpinnerSize } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";

import "./AppSidebarFooter.css";

// The sidebar footer now holds ONLY the settings cog. The theme toggle moved to the app header, the
// expand/collapse toggle moved to the top of the sidebar, and the GUI/CLI version line was dropped (it was a
// single-connection artifact — per-engine versions now live permanently in the app footer).
export function AppSidebarFooter() {
  const { t } = useTranslation();
  const pending = useAppStore((state) => state.pending);
  const rightContent = pending ? (
    <div className="AppSidebarFooterPendingIndicator">
      <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} />
    </div>
  ) : (
    <AnchorButton
      className="AppSidebarSettingsButton"
      variant="minimal"
      icon={IconNames.COG}
      href={pathTo("/screens/settings/user-settings")}
      title={t("Settings")}
      aria-label={t("Settings")}
    />
  );
  return (
    <div className="AppSidebarFooter">
      <Navbar className="AppSidebarFooterNavbar">
        <NavbarGroup align={Alignment.END} className="AppSidebarFooterRightColumn">
          {rightContent}
        </NavbarGroup>
      </Navbar>
    </div>
  );
}
