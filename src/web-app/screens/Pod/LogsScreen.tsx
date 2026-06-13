import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./LogsScreen.css";
import { usePod, usePodLogs } from "./queries";

interface ScreenProps extends AppScreenProps {}

export const ID = "pod.logs";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const podQuery = usePod(connectionId, id);
  const logsQuery = usePodLogs(connectionId, id, 100);
  const pod = podQuery.data;
  const pending = podQuery.isLoading || podQuery.isFetching || logsQuery.isLoading || logsQuery.isFetching;

  if (!pod) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={`${logsQuery.data?.stderr ?? ""}`} mode="text" headerTitle={t("stderr")} />
        <CodeEditor value={`${logsQuery.data?.stdout ?? ""}`} mode="text" headerTitle={t("stdout")} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod Logs";
Screen.Route = {
  Path: "/screens/pod/$id/logs",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
