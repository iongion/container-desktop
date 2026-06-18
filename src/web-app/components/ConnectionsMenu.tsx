// components/ConnectionsMenu.tsx — header popover for the always-merged, multi-engine workspace.
//
// Lists every configured connection with its LIVE per-connection runtime (ready/failed/idle), and lets the
// user connect/disconnect each one and pick the primary (default create/pull target). Status comes from
// resourceStore.activeRuntime (mirrored from main's snapshot); actions route through appStore's
// connectOne/disconnectOne/makePrimary (per-connection, no global bootstrap reset). Engine-agnostic chrome
// via app tokens; per-engine identity via the shared EngineCell marker.

import { Button, ButtonGroup, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { EngineCell } from "@/web-app/components/EngineCell";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

import "./ConnectionsMenu.css";

export const ConnectionsMenu: React.FC = () => {
  const { t } = useTranslation();
  const connections = useAppStore((state) => state.connections);
  const defaultId = useAppStore((state) => state.userSettings?.connector?.default);
  const connectOne = useAppStore((state) => state.connectOne);
  const disconnectOne = useAppStore((state) => state.disconnectOne);
  const makePrimary = useAppStore((state) => state.makePrimary);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);

  const runtimeById = new Map(activeRuntime.map((info) => [info.id, info]));
  const connectedCount = activeRuntime.filter((info) => info.running).length;

  const content = (
    <div className="ConnectionsMenuPanel">
      <div className="ConnectionsMenuHeading">{t("Connections")}</div>
      {connections.length === 0 ? (
        <div className="ConnectionsMenuEmpty">{t("No connections configured")}</div>
      ) : (
        connections.map((connection) => {
          const runtime = runtimeById.get(connection.id);
          const running = !!runtime?.running;
          const status = running ? "ready" : runtime?.phase === "failed" ? "failed" : "idle";
          const isPrimary = connection.id === defaultId;
          return (
            <div className="ConnectionsMenuRow" key={connection.id} data-running={running ? "yes" : "no"}>
              <span className="ConnectionsMenuStatus" data-status={status} title={runtime?.error || t(status)} />
              <EngineCell engine={connection.engine} connectionName={connection.name} />
              <span className="ConnectionsMenuName" title={runtime?.error || connection.name}>
                {connection.name}
                {isPrimary ? <span className="ConnectionsMenuPrimaryTag">{t("primary")}</span> : null}
              </span>
              <ButtonGroup variant="minimal" className="ConnectionsMenuActions">
                {running && !isPrimary ? (
                  <Button
                    size="small"
                    icon={IconNames.STAR_EMPTY}
                    title={t("Make primary")}
                    onClick={() => makePrimary(connection.id)}
                  />
                ) : null}
                {running ? (
                  <Button
                    size="small"
                    icon={IconNames.OFFLINE}
                    title={t("Disconnect")}
                    onClick={() => disconnectOne(connection.id)}
                  />
                ) : (
                  <Button
                    size="small"
                    icon={IconNames.POWER}
                    title={t("Connect")}
                    onClick={() => connectOne(connection.id)}
                  />
                )}
              </ButtonGroup>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <PopoverNext content={content} placement="bottom-end" usePortal hasBackdrop={false}>
      <Button
        className="AppHeaderActionButton ConnectionsMenuButton"
        variant="minimal"
        icon={IconNames.DATA_CONNECTION}
        text={String(connectedCount)}
        title={t("Engines — {{count}} connected", { count: connectedCount })}
        aria-label={t("Connections")}
      />
    </PopoverNext>
  );
};
