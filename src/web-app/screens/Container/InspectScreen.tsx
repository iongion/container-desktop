import { IconNames } from "@blueprintjs/icons";
import { type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { PropertyValueTable } from "@/web-app/components/PropertyValueTable";
import { ResourceSectionRail } from "@/web-app/components/ResourceSectionRail";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./InspectScreen.css";
import i18n from "@/i18n";
import {
  buildContainerEnvRows,
  buildContainerMountRows,
  buildContainerPortRows,
  buildContainerSummary,
} from "./inspectSummary";
import { containerSectionRailItems } from "./Navigation";
import { useContainer } from "./queries";

export const ID = "container.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId, section } = useRouteSearch<{ connId?: string; section?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const engine = useAppStore((state) => state.connections.find((c) => c.id === connectionId)?.engine);
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const { data: container, refetch } = containerQuery;
  const pending = containerQuery.isLoading || containerQuery.isFetching;
  const onScreenReload = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const envRows = buildContainerEnvRows(container);
  const portRows = buildContainerPortRows(container);
  const mountRows = buildContainerMountRows(container);

  // One flat rail (containerSectionRailItems) drives the whole container detail; this screen renders just the
  // facet the `?section=` selector asks for (default = the Summary panel, i.e. "Inspect"). Env vars keep the
  // sortable Property/Value table; Ports are a fixed Container → Host table with port icons; Mounts a sortable
  // Container → Host table; Raw is the Tree | JSON viewer.
  const facetBodies: Record<string, ReactNode> = {
    summary: <InspectSummary rows={buildContainerSummary(container)} dataTable="container.inspect-summary" />,
    raw: <InspectRawJson value={JSON.stringify(container, null, 2)} />,
  };
  if (envRows.length > 0) {
    facetBodies.env = <InspectSummary rows={envRows} dataTable="container.inspect-env" />;
  }
  if (portRows.length > 0) {
    facetBodies.ports = (
      <PropertyValueTable
        rows={portRows}
        dataTable="container.inspect-ports"
        className="InspectSummary"
        sortable={false}
        propertyLabel={t("Container")}
        valueLabel={t("Host")}
        propertyIcon={IconNames.CUBE}
        valueIcon={IconNames.DESKTOP}
      />
    );
  }
  if (mountRows.length > 0) {
    facetBodies.mounts = (
      <PropertyValueTable
        rows={mountRows}
        dataTable="container.inspect-mounts"
        className="InspectSummary"
        propertyLabel={t("Container")}
        valueLabel={t("Host")}
      />
    );
  }
  const activeSection = section && facetBodies[section] ? section : "summary";
  const activeId = activeSection === "summary" ? ID : `container.inspect.${activeSection}`;

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <ResourceSectionRail
        items={containerSectionRailItems(container, connectionId, engine)}
        activeId={activeId}
        dataScreen={ID}
      >
        <div className="AppScreenContent">{facetBodies[activeSection]}</div>
      </ResourceSectionRail>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container Inspect");
Screen.Route = {
  Path: "/screens/container/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
