import { Alignment, Navbar, NavbarGroup, NavbarHeading, Spinner, SpinnerSize, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ContainerEngine } from "../Types.container-app";

import { useStoreState } from "../domain/types";
import CurrentEnvironment, { PROJECT_VERSION } from "../Environment";

import "./AppSidebarFooter.css";

export function AppSidebarFooter() {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const currentConnector = useStoreState((state) => state.descriptor.currentConnector);
  const controller = currentConnector.settings.current.controller;
  const program = currentConnector.settings.current.program;
  const programInfo = {
    name: program?.name || "",
    version: ""
  };
  let programTitle = "";
  if (currentConnector?.engine === ContainerEngine.PODMAN_VIRTUALIZED) {
    programInfo.version = controller?.version || "";
    programTitle = t("Machine program version: {{version}}", program);
  } else {
    programInfo.version = program?.version || "";
  }
  const versionString = `GUI v${PROJECT_VERSION}.${CurrentEnvironment.name[0]}`;
  const programString = `CLI ${programInfo.name} ${programInfo.version}`;
  return (
    <div className="AppSidebarFooter">
      <Navbar>
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading>
            <span className="AppSidebarVersionString">{versionString}</span> &nbsp; / &nbsp;
            <span className="AppSidebarProgramString" title={programTitle}>{programString}</span>
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT} className="AppSidebarFooterRightColumn">
          <div className="AppSidebarFooterPendingIndicator">
            {pending ? <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} /> : <>&nbsp;</>}
          </div>
        </NavbarGroup>
      </Navbar>
    </div>
  );
}
