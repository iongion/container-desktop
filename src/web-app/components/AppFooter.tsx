import { Navbar, NavbarDivider, NavbarHeading } from "@blueprintjs/core";

import i18n from "@/web-app/App.i18n";
import { useStoreState } from "@/web-app/domain/types";

import { ContainerEngineHost } from "@/env/Types";
import "./AppFooter.css";

export const AppFooter = () => {
  const { t } = i18n;
  const running = useStoreState((state) => state.running);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const expandSidebar = useStoreState((state) => state.userSettings.expandSidebar);
  const controller = currentConnector?.settings?.controller;
  const program = currentConnector?.settings?.program;
  const programInfo = {
    name: program?.name || "",
    version: ""
  };
  if (currentConnector?.host === ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR) {
    programInfo.version = controller?.version || "";
  } else {
    programInfo.version = program?.version || "";
  }
  return (
    <div className="AppFooter">
      <Navbar className="AppFooterNavbar">
        <NavbarHeading>
          <div className="AppFooterCurrentConnectorStatus" data-connected={running ? "yes" : "no"}></div>
          <div className="AppFooterCurrentConnector" title={currentConnector ? t("Connected to {{name}} - {{description}}", currentConnector) : t("No connection")}>
            {currentConnector ? (
              <>
                <strong>{currentConnector.name}</strong> - <span>{currentConnector.label}</span>
              </>
            ) : (
              t("Disconnected")
            )}
          </div>
        </NavbarHeading>
        {expandSidebar || !currentConnector ? null : (
          <>
            <NavbarDivider />
            <NavbarHeading>
              <div className="AppFooterCurrentProgram" title={t("Container host engine")}>
                {t("{{engine}} {{version}}", { engine: currentConnector.engine, version: programInfo.version || "" })}
              </div>
            </NavbarHeading>
          </>
        )}
      </Navbar>
    </div>
  );
};
