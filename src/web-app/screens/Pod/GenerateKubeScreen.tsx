import { IconNames } from "@blueprintjs/icons";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./GenerateKubeScreen.css";
import { usePod, usePodKube } from "./queries";

export const ID = "pod.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const podQuery = usePod(connectionId, id);
  const kubeQuery = usePodKube(connectionId, id);
  const pod = podQuery.data;
  const pending = podQuery.isLoading || podQuery.isFetching || kubeQuery.isLoading || kubeQuery.isFetching;

  if (!pod) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={kubeQuery.data ?? ""} mode="yaml" />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod kube";
Screen.Route = {
  Path: "/screens/pod/$id/kube",
};
Screen.Metadata = {
  LeftIcon: IconNames.TEXT_HIGHLIGHT,
  ExcludeFromSidebar: true,
};
