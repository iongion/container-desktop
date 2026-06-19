import { Alignment, Button, Intent, Navbar, NavbarDivider, NavbarGroup, NavbarHeading, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import i18n from "@/web-app/App.i18n";
import { AppTheme } from "@/web-app/App.types";
import { ConnectionsMenu } from "@/web-app/components/ConnectionsMenu";
import { buildEngineInventory, EngineVersionsMenu } from "@/web-app/components/EngineVersionsMenu";
import { NotificationBell } from "@/web-app/components/NotificationCenter/NotificationBell";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import "./AppFooter.css";

interface AppFooterProps {
  variant?: "workspace" | "bootstrap";
}

function normalizeFooterTheme(theme?: string): AppTheme {
  return theme === "light" || theme === AppTheme.LIGHT ? AppTheme.LIGHT : AppTheme.DARK;
}

export const AppFooter = ({ variant = "workspace" }: AppFooterProps) => {
  const { t } = i18n;
  const theme = useAppStore((state) => normalizeFooterTheme(state.userSettings.theme));
  const connections = useAppStore((state) => state.connections);
  const connectors = useAppStore((state) => state.connectors);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const onThemeToggleClick = useCallback(() => {
    setGlobalUserSettings({ theme: theme === AppTheme.DARK ? AppTheme.LIGHT : AppTheme.DARK });
  }, [theme, setGlobalUserSettings]);
  // Always-merged workspace: the footer reflects EVERY connected engine, not just the primary. The per-
  // connection runtime (mirrored from main) carries each engine's REAL detected version.
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const connected = activeRuntime.filter((info) => info.running);
  const connectedCount = connected.length;
  const isConnected = connectedCount > 0;
  const engineInventory = buildEngineInventory(connections, connectors, activeRuntime);
  const showConnectionStatus = variant === "workspace";
  return (
    <div className="AppFooter" data-variant={variant}>
      <Navbar className="AppFooterNavbar">
        {showConnectionStatus ? (
          <>
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
            {engineInventory.engineCount === 0 ? null : (
              <>
                <NavbarDivider />
                <NavbarHeading className="AppFooterEngineVersions">
                  <EngineVersionsMenu inventory={engineInventory} />
                </NavbarHeading>
              </>
            )}
          </>
        ) : (
          <NavbarHeading className="AppFooterBootstrapEngine">
            <span className="AppFooterEngineIcon" aria-hidden="true" />
          </NavbarHeading>
        )}
        <NavbarGroup align={Alignment.END} className="AppFooterActions">
          <Button
            className="AppFooterActionButton"
            variant="minimal"
            icon={theme === AppTheme.DARK ? IconNames.MOON : IconNames.FLASH}
            onClick={onThemeToggleClick}
            title={t("Toggle {{mode}} mode", { mode: theme === AppTheme.DARK ? t("light") : t("dark") })}
            aria-label={t("Toggle theme")}
          />
          <NavbarDivider />
          <NotificationBell />
        </NavbarGroup>
      </Navbar>
    </div>
  );
};
