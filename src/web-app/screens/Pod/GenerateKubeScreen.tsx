import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "wouter";

import type { Pod } from "@/env/Types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";

import { ScreenHeader } from ".";
import "./GenerateKubeScreen.css";

export const ID = "pod.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
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
          withKube: true,
        });
        setPod(pod);
      } catch (error: any) {
        console.error("Unable to generate at this moment", error);
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
        <CodeEditor value={`${pod?.Kube}`} mode="yaml" />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod kube";
Screen.Route = {
  Path: "/screens/pod/:id/kube",
};
Screen.Metadata = {
  LeftIcon: IconNames.TEXT_HIGHLIGHT,
  ExcludeFromSidebar: true,
};
