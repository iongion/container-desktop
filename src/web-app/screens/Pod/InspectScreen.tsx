import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import i18n from "@/i18n";
import { ResourceInspectTabs } from "@/web-app/components/ResourceInspectTabs";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";
import { buildPodSummary } from "./inspectSummary";
import { usePod } from "./queries";

export const ID = "pod.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const podQuery = usePod(connectionId, id);
  const { data: pod, refetch } = podQuery;
  const onScreenReload = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!pod) {
    return <ScreenLoader screen={ID} pending={podQuery.isLoading || podQuery.isFetching} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader pod={pod} currentScreen={ID} onReload={onScreenReload} />
      <ResourceInspectTabs
        dataScreen={ID}
        summaryRows={buildPodSummary(pod)}
        summaryTable="pod.inspect-summary"
        rawValue={JSON.stringify(pod || {}, null, 2)}
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Pod Inspect");
Screen.Route = {
  Path: "/screens/pod/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.EYE_OPEN,
  ExcludeFromSidebar: true,
};
