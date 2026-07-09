import { Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ResourceSectionRail } from "@/web-app/components/ResourceSectionRail";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";

import "./GenerateKubeScreen.css";
import i18n from "@/i18n";
import { containerSectionRailItems } from "./Navigation";
import { useContainer, useContainerKube } from "./queries";

export const ID = "container.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const engine = useAppStore((state) => state.connections.find((c) => c.id === connectionId)?.engine);
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const kubeQuery = useContainerKube(connectionId, decodedId);
  const container = containerQuery.data;
  const pending = containerQuery.isLoading || containerQuery.isFetching || kubeQuery.isLoading || kubeQuery.isFetching;
  const onScreenReload = useCallback(() => {
    containerQuery.refetch();
    kubeQuery.refetch();
  }, [containerQuery, kubeQuery]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const loading = pending;
  const contents = loading ? (
    <Spinner />
  ) : (
    <>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <ResourceSectionRail
        items={containerSectionRailItems(container, connectionId, engine)}
        activeId={ID}
        dataScreen={ID}
      >
        <div className="AppScreenContent">
          <CodeEditor value={kubeQuery.data ?? ""} mode="yaml" />
        </div>
      </ResourceSectionRail>
    </>
  );

  return (
    <div className="AppScreen" data-screen={ID} data-pending={loading ? "yes" : "no"}>
      {contents}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container kube");
Screen.Route = {
  Path: "/screens/container/$id/kube",
};
Screen.Metadata = {
  LeftIcon: IconNames.TEXT_HIGHLIGHT,
  ExcludeFromSidebar: true,
};
