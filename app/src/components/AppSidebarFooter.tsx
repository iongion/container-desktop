import { Alignment, Navbar, NavbarGroup, NavbarHeading, Spinner, SpinnerSize, Intent } from "@blueprintjs/core";

import { useTranslation } from "react-i18next";

import { useStoreState } from "../domain/types";

import "./AppSidebarFooter.css";

export function AppSidebarFooter() {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const running = useStoreState((state) => state.running);
  const pendingIndicatorStyle: React.CSSProperties = {
    visibility: pending ? "visible" : "hidden"
  };
  const pendingIndicator = (
    <div className="AppSidebarFooterPendingIndicator" style={pendingIndicatorStyle}>
      <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} />
    </div>
  );
  return (
    <div className="AppSidebarFooter">
      <Navbar>
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading>{running ? t("System service is running") : t("System service is not running")}</NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>{pendingIndicator}</NavbarGroup>
      </Navbar>
    </div>
  );
}
