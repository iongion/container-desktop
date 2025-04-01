import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "wouter";

import type { Pod } from "@/env/Types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";

export const ID = "pod.inspect";

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
        <CodeEditor value={`${JSON.stringify(pod || {}, null, 2)}`} mode="json" />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod Inspect";
Screen.Route = {
  Path: "/screens/pod/:id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.EYE_OPEN,
  ExcludeFromSidebar: true,
};
