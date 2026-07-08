import { Button, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { CopyButton } from "@/web-app/components/CopyButton";
import { useMergedResources } from "@/web-app/hooks/useMergedResources";
import { ScreenHeader } from "@/web-app/screens/Connections/ScreenHeader";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ConnectionCard } from "./ConnectionCard";
import { buildFleet } from "./fleet";
import { buildDiagnoses, type FleetEntry, foldLevel, serializeDiagnostics, summarizeEntries } from "./issues";
import { engineHealthKeys } from "./queries";
import { findSubnetOverlaps } from "./subnets";
import "./EngineHealth.css";

// A Connections sub-screen (reached via the Connections section tab bar, not the sidebar).
export const ID = "connections.health";

interface ScreenProps extends AppScreenProps {}

// Domains the cockpit's panels read; a re-check nudges main to refresh them + invalidates the df query.
const HEALTH_PANEL_DOMAINS = ["networks", "containers", "volumes"] as const;

// Engine Health — the GLOBAL fleet-health cockpit (all connections at once, grouped by connection). Unified
// theme, NO ConnectionSelect. Each connection is a collapsible card (verdict-colored border; healthy collapsed).
export const Screen: AppScreen<ScreenProps> = () => {
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
  const summary = useMemo(() => summarizeEntries(entries), [entries]);
  const diagnostics = useMemo(() => serializeDiagnostics(entries), [entries]);

  // Collapse state: healthy cards collapse by default; a user toggle overrides that per connection.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isExpanded = useCallback(
    (entry: FleetEntry) => overrides[entry.card.id] ?? entry.level !== "healthy",
    [overrides],
  );
  const toggle = useCallback(
    (entry: FleetEntry) =>
      setOverrides((prev) => ({ ...prev, [entry.card.id]: !(prev[entry.card.id] ?? entry.level !== "healthy") })),
    [],
  );

  const recheck = useCallback(
    (id: string) => {
      void resourceEvents.refreshMany(id, [...HEALTH_PANEL_DOMAINS]);
      qc.invalidateQueries({ queryKey: engineHealthKeys.all });
    },
    [qc],
  );
  const rerunAll = useCallback(() => {
    for (const entry of entries) {
      recheck(entry.card.id);
    }
  }, [entries, recheck]);

  // Single header: the shared Connections tab bar (left) + the fleet-status widget, Copy diagnostics and Re-run
  // (right). No separate summary strip.
  const headerActions = (
    <div className="EngineHealthHead">
      <span className="fleetCounts">
        <span className="fb ok">
          <span className="dot ok" />
          <b>{summary.healthy}</b> {t("healthy")}
        </span>
        <span className="fb warn">
          <span className="dot warn" />
          <b>{summary.degraded}</b> {t("degraded")}
        </span>
        <span className="fb err">
          <span className="dot err" />
          <b>{summary.unreachable}</b> {t("unreachable")}
        </span>
        <span className="fbCount">{t("{{count}} connections", { count: summary.total })}</span>
      </span>
      <CopyButton icon={IconNames.DUPLICATE} variant="minimal" text={diagnostics} title={t("Copy diagnostics")} />
      <Button variant="minimal" icon={IconNames.REFRESH} title={t("Re-run all checks")} onClick={rerunAll} />
    </div>
  );

  return (
    <div className="AppScreen EngineHealth" data-screen={ID}>
      <ScreenHeader currentScreen={ID} rightContent={headerActions} />
      <div className="AppScreenContent">
        {entries.length === 0 ? (
          <NonIdealState
            icon={IconNames.PULSE}
            title={t("No connected engines")}
            description={<p>{t("Connect an engine to see its fleet health here.")}</p>}
          />
        ) : (
          entries.map((entry) => (
            <ConnectionCard
              key={entry.card.id}
              card={entry.card}
              level={entry.level}
              diagnoses={entry.diagnoses}
              expanded={isExpanded(entry)}
              onToggle={() => toggle(entry)}
              onRecheck={() => recheck(entry.card.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Engine Health");
Screen.Route = {
  Path: "/screens/connections/health",
};
Screen.Metadata = {
  LeftIcon: IconNames.PULSE,
  ExcludeFromSidebar: true,
};
