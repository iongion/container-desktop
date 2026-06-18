import { Intent, Navbar, NavbarDivider, NavbarHeading, Tag } from "@blueprintjs/core";
import i18n from "@/web-app/App.i18n";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import "./AppFooter.css";

export const AppFooter = () => {
  const { t } = i18n;
  const expandSidebar = useAppStore((state) => state.userSettings.expandSidebar);
  // Always-merged workspace: the footer reflects EVERY connected engine, not just the primary. The per-
  // connection runtime (mirrored from main) carries each engine's REAL detected version.
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const connected = activeRuntime.filter((info) => info.running);
  const connectedCount = connected.length;
  const isConnected = connectedCount > 0;
  const engines = connected.map((info) => ({
    id: info.id,
    name: info.name,
    label: info.version ? `${info.engine} ${info.version}` : info.engine,
  }));
  return (
    <div className="AppFooter">
      <Navbar className="AppFooterNavbar">
        <NavbarHeading>
          <Tag
            className="AppFooterCurrentConnectorBadge"
            round
            intent={isConnected ? Intent.SUCCESS : Intent.DANGER}
            data-connected={isConnected ? "yes" : "no"}
            htmlTitle={isConnected ? connected.map((info) => info.name).join(", ") : t("No connection")}
          >
            {connectedCount}
          </Tag>
          <div
            className="AppFooterCurrentConnector"
            title={isConnected ? connected.map((info) => info.name).join(", ") : t("No connection")}
          >
            {isConnected ? t("Connected") : t("Disconnected")}
          </div>
        </NavbarHeading>
        {expandSidebar || !isConnected ? null : (
          <>
            <NavbarDivider />
            <NavbarHeading>
              <div className="AppFooterCurrentProgram" title={t("Container host engines")}>
                {engines.map((engine, index) => (
                  <span key={engine.id} className="AppFooterEngineVersion" title={engine.name}>
                    {index > 0 ? <span className="AppFooterEngineVersionSep"> · </span> : null}
                    {engine.label}
                  </span>
                ))}
              </div>
            </NavbarHeading>
          </>
        )}
      </Navbar>
    </div>
  );
};
