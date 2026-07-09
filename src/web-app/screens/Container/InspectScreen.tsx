import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InspectSummary } from "@/web-app/components/InspectSummary";
import type { InspectTabSection } from "@/web-app/components/InspectTabs";
import { PropertyValueTable } from "@/web-app/components/PropertyValueTable";
import { ResourceInspectTabs } from "@/web-app/components/ResourceInspectTabs";
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
import { useContainer } from "./queries";

export const ID = "container.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
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

  // Data-bearing tabs between Summary and Raw, present only when the container has them. Env vars keep the
  // sortable Property/Value table (InspectSummary); Ports are a fixed (unsorted) Container → Host table with
  // port icons; Mounts stay a sortable table relabeled Container → Host, default ascending by Container path.
  const middle: InspectTabSection[] = [];
  if (envRows.length > 0) {
    middle.push({
      id: "env",
      label: t("Env vars"),
      icon: IconNames.VARIABLE,
      count: envRows.length,
      body: <InspectSummary rows={envRows} dataTable="container.inspect-env" />,
    });
  }
  if (portRows.length > 0) {
    middle.push({
      id: "ports",
      label: t("Ports"),
      icon: IconNames.GLOBE_NETWORK,
      count: portRows.length,
      body: (
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
      ),
    });
  }
  if (mountRows.length > 0) {
    middle.push({
      id: "mounts",
      label: t("Mounts"),
      icon: IconNames.FOLDER_CLOSE,
      count: mountRows.length,
      body: (
        <PropertyValueTable
          rows={mountRows}
          dataTable="container.inspect-mounts"
          className="InspectSummary"
          propertyLabel={t("Container")}
          valueLabel={t("Host")}
        />
      ),
    });
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <ResourceInspectTabs
        dataScreen={ID}
        summaryRows={buildContainerSummary(container)}
        summaryTable="container.inspect-summary"
        rawValue={JSON.stringify(container, null, 2)}
        middle={middle}
      />
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
