import { IconNames } from "@blueprintjs/icons";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";
import { usePod } from "./queries";

export const ID = "pod.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const podQuery = usePod(connectionId, id);
  const pod = podQuery.data;

  if (!pod) {
    return <ScreenLoader screen={ID} pending={podQuery.isLoading || podQuery.isFetching} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={`${JSON.stringify(pod || {}, null, 2)}`} mode="json" />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod Inspect";
Screen.Route = {
  Path: "/screens/pod/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.EYE_OPEN,
  ExcludeFromSidebar: true,
};
