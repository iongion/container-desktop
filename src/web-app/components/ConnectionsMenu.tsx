// components/ConnectionsMenu.tsx — the connections popover for the always-merged, multi-engine workspace.
//
// Lists every configured connection with its LIVE per-connection runtime (ready/failed/idle), and lets the
// user connect/disconnect each one and pick the primary (default create/pull target). Status comes from
// resourceStore.activeRuntime (mirrored from main's snapshot); actions route through appStore's
// connectOne/disconnectOne/makePrimary (per-connection, no global bootstrap reset). Engine-agnostic chrome
// via app tokens; per-engine identity via the shared EngineCell marker.
//
// The TRIGGER is supplied by the caller (`children`) — connections are managed from a single place, the
// footer status button — so this just wraps that trigger in the popover and opens UPWARD (placement "top").

import { Button, ButtonGroup, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { mdiStarOutline } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useTranslation } from "react-i18next";

import { ConnectIcon, DisconnectIcon } from "@/web-app/components/icons/ConnectionIcons";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

import "./ConnectionsMenu.css";

export const ConnectionsMenu: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const connections = useAppStore((state) => state.connections);
  const defaultId = useAppStore((state) => state.userSettings?.connector?.default);
  const connectOne = useAppStore((state) => state.connectOne);
  const disconnectOne = useAppStore((state) => state.disconnectOne);
  const makePrimary = useAppStore((state) => state.makePrimary);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);

  const runtimeById = new Map(activeRuntime.map((info) => [info.id, info]));

  // Action glyphs: custom link / broken-link for connect/disconnect (color = status, see statusIntent), mdi
  // star for "make primary".
  const connectIcon = <ConnectIcon />;
  const disconnectIcon = <DisconnectIcon />;
  const primaryIcon = <ReactIcon.Icon className="ReactIcon" path={mdiStarOutline} size={0.7} />;

  const content = (
    <Menu className="ConnectionsMenu">
      {connections.length === 0 ? (
        <MenuItem disabled text={t("No connections configured")} />
      ) : (
        connections.map((connection) => {
          const runtime = runtimeById.get(connection.id);
          const running = !!runtime?.running;
          const status = running
            ? "ready"
            : runtime?.phase === "failed"
              ? "failed"
              : runtime?.reconnecting
                ? "reconnecting"
                : "idle";
          // Status is shown by the connect/disconnect icon's COLOR (no separate dot or engine marker):
          // green = connected, red = failed, orange = reconnecting, neutral = idle/disconnected.
          const statusIntent =
            status === "ready"
              ? Intent.SUCCESS
              : status === "failed"
                ? Intent.DANGER
                : status === "reconnecting"
                  ? Intent.WARNING
                  : Intent.NONE;
          const isPrimary = connection.id === defaultId;
          return (
            <MenuItem
              key={connection.id}
              shouldDismissPopover={false}
              htmlTitle={runtime?.error || connection.name}
              text={
                <span className="ConnectionsMenuName">
                  {connection.name}
                  {isPrimary ? <span className="ConnectionsMenuPrimaryTag">{t("primary")}</span> : null}
                </span>
              }
              // Clicking an idle row connects it; connected rows expose disconnect/primary as explicit buttons.
              onClick={running ? undefined : () => connectOne(connection.id)}
              labelElement={
                <ButtonGroup variant="minimal" className="ConnectionsMenuActions">
                  {running && !isPrimary ? (
                    <Button
                      size="small"
                      icon={primaryIcon}
                      title={t("Make primary")}
                      onClick={(e) => {
                        e.stopPropagation();
                        makePrimary(connection.id);
                      }}
                    />
                  ) : null}
                  {running ? (
                    <Button
                      size="small"
                      intent={statusIntent}
                      icon={disconnectIcon}
                      title={t("Disconnect")}
                      onClick={(e) => {
                        e.stopPropagation();
                        disconnectOne(connection.id);
                      }}
                    />
                  ) : (
                    <Button
                      size="small"
                      intent={statusIntent}
                      icon={connectIcon}
                      title={t("Connect")}
                      onClick={(e) => {
                        e.stopPropagation();
                        connectOne(connection.id);
                      }}
                    />
                  )}
                </ButtonGroup>
              }
            />
          );
        })
      )}
    </Menu>
  );

  return (
    <PopoverNext content={content} placement="top-start" usePortal hasBackdrop={false}>
      {children}
    </PopoverNext>
  );
};
