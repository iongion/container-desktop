import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useMergedResources } from "@/web-app/hooks/useMergedResources";
import { useRouteParams } from "@/web-app/Navigator";
import { ConnectionDetailsActionsMenu } from "@/web-app/screens/Connections/ActionsMenu";
import { ConnectionDetailLayout } from "@/web-app/screens/Connections/ConnectionDetailRail";
import { getConnectionCrumbs, getConnectionsUrl } from "@/web-app/screens/Connections/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ConnectionHealthContent, ConnectionHealthHeader } from "./ConnectionCard";
import { buildFleet } from "./fleet";
import { buildDiagnoses, type FleetEntry, foldLevel } from "./issues";
import { engineHealthKeys } from "./queries";
import { findSubnetOverlaps } from "./subnets";
import "./EngineHealth.css";

export const ID = "connections.health";
export const View = "health";
export const Title = i18n.t("Engine health");

interface ScreenProps extends AppScreenProps {}

// Domains the cockpit's panels read; a re-check nudges main to refresh them + invalidates the df query.
const HEALTH_PANEL_DOMAINS = ["networks", "containers", "volumes"] as const;

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = decodeURIComponent(id || "");
  const { t } = useTranslation();
  const qc = useQueryClient();
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const connections = useAppStore((state) => state.connections);
  const connectors = useAppStore((state) => state.connectors);
  const allNetworks = useMergedResources("networks");

  const fleet = useMemo(
    () => buildFleet(activeRuntime, connections, connectors),
    [activeRuntime, connections, connectors],
  );
  // Fold each connection's detected issues (subnet overlaps, unreachable) into its effective verdict + diagnoses.
  const entries = useMemo<FleetEntry[]>(
    () =>
      fleet.map((card) => {
        const overlaps = findSubnetOverlaps(
          allNetworks
            .filter((network) => network.connectionId === card.id)
            .map((network) => ({
              name: network.name,
              subnets: (network.subnets ?? []).map((entry) => entry.subnet).filter(Boolean),
            })),
        );
        const diagnoses = buildDiagnoses(card, overlaps);
        return { card, diagnoses, level: foldLevel(card.verdict.level, diagnoses) };
      }),
    [fleet, allNetworks],
  );
  const selectedEntry = entries.find((entry) => entry.card.id === connectionId);
  const title = selectedEntry?.card.name || connectionId;

  const recheck = useCallback(
    (id: string) => {
      void resourceEvents.refreshMany(id, [...HEALTH_PANEL_DOMAINS]);
      qc.invalidateQueries({ queryKey: engineHealthKeys.all });
    },
    [qc],
  );
  const onReload = useCallback(() => {
    recheck(connectionId);
  }, [connectionId, recheck]);

  return (
    <div className="AppScreen EngineHealth" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        listRoutePath={getConnectionsUrl("manage")}
        listRouteIcon={IconNames.DATA_CONNECTION}
        titleIcon={IconNames.DATA_CONNECTION}
        titleText={title}
        breadcrumbs={getConnectionCrumbs(title, View, connectionId)}
        rightContent={
          <ConnectionDetailsActionsMenu connectionId={connectionId} currentScreen={ID} onReload={onReload} />
        }
      />
      <ConnectionDetailLayout connectionId={connectionId} currentScreen={ID}>
        {selectedEntry ? (
          <>
            <ConnectionHealthHeader
              key={`${selectedEntry.card.id}-header`}
              card={selectedEntry.card}
              level={selectedEntry.level}
              diagnoses={selectedEntry.diagnoses}
            />
            <ConnectionHealthContent
              key={`${selectedEntry.card.id}-content`}
              card={selectedEntry.card}
              level={selectedEntry.level}
              diagnoses={selectedEntry.diagnoses}
            />
          </>
        ) : (
          <NonIdealState
            icon={IconNames.PULSE}
            title={t("Connection health unavailable")}
            description={<p>{t("Connect this engine to see its health here.")}</p>}
          />
        )}
      </ConnectionDetailLayout>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/connections/$id/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.PULSE,
  ExcludeFromSidebar: true,
};
