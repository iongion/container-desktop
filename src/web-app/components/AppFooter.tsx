import { Button, Intent, Navbar, NavbarDivider, NavbarHeading, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import i18n from "@/web-app/App.i18n";
import { ConnectionsMenu } from "@/web-app/components/ConnectionsMenu";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import "./AppFooter.css";

export const AppFooter = () => {
  const { t } = i18n;
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
        <NavbarHeading className="AppFooterStatus">
          {/* Engine glyph (moved here from the sidebar footer) sits IN FRONT OF — not inside — the
              connections status button; themed per engine via CSS, scaled to match the count badge. */}
          <span className="AppFooterEngineIcon" aria-hidden="true" />
          {/* Single entry point for connections: this status button opens the connect/disconnect menu
              (the caret-up end icon hints the popover opens upward). */}
          <ConnectionsMenu>
            <Button
              className="AppFooterConnectionsButton"
              variant="minimal"
              size="small"
              data-connected={isConnected ? "yes" : "no"}
              endIcon={IconNames.CARET_UP}
              aria-label={t("Connections")}
              title={isConnected ? connected.map((info) => info.name).join(", ") : t("No connection")}
            >
              <Tag
                className="AppFooterCurrentConnectorBadge"
                round
                intent={isConnected ? Intent.SUCCESS : Intent.DANGER}
                data-connected={isConnected ? "yes" : "no"}
              >
                {connectedCount}
              </Tag>
              <span className="AppFooterCurrentConnector">{isConnected ? t("Connected") : t("Disconnected")}</span>
            </Button>
          </ConnectionsMenu>
        </NavbarHeading>
        {!isConnected ? null : (
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
