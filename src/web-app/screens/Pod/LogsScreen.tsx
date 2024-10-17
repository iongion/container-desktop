import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import type { Pod } from "@/env/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./LogsScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "pod.logs";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(true);
  const [pod, setPod] = useState<Pod>();
  const { id } = useParams<{ id: string }>();
  const podFetch = useStoreActions((actions) => actions.pod.podFetch);

  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const pod = await podFetch({
          Id: id as any,
          withLogs: { Tail: 100 },
        });
        setPod(pod);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [podFetch, id]);

  if (!pod) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={`${pod.Logs?.stderr}`} mode="text" headerTitle={t("stderr")} />
        <CodeEditor value={`${pod.Logs?.stdout}`} mode="text" headerTitle={t("stdout")} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod Logs";
Screen.Route = {
  Path: "/screens/pod/:id/logs",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
