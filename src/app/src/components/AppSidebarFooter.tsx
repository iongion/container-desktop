import { Alignment, Navbar, NavbarGroup, NavbarHeading, Spinner, SpinnerSize, Intent } from "@blueprintjs/core";

import { useStoreState } from "../domain/types";
import CurrentEnvironment, { PROJECT_VERSION } from "../Environment";

import "./AppSidebarFooter.css";

export function AppSidebarFooter() {
  const pending = useStoreState((state) => state.pending);
  const program = useStoreState((state) => state.environment.currentEngine.settings.current.program);
  const pendingIndicatorStyle: React.CSSProperties = {
    visibility: pending ? "visible" : "hidden"
  };
  const pendingIndicator = (
    <div className="AppSidebarFooterPendingIndicator" style={pendingIndicatorStyle}>
      <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} />
    </div>
  );
  const versionString = `GUI v${PROJECT_VERSION}.${CurrentEnvironment.name[0]}`;
  const programString = `CLI ${program.name} ${program.version}`;
  return (
    <div className="AppSidebarFooter">
      <Navbar>
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading>
            <span className="AppSidebarVersionString">{versionString}</span> &nbsp; / &nbsp;
            <span className="AppSidebarProgramString">{programString}</span>
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          {pendingIndicator}
        </NavbarGroup>
      </Navbar>
    </div>
  );
}
