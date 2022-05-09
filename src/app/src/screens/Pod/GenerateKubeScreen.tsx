import { useEffect, useRef, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

import { AppScreenProps, AppScreen, Pod } from "../../Types";
import { ScreenHeader } from ".";
import { CodeEditor } from "../../components/CodeEditor";

import { useStoreActions } from "../../domain/types";

import "./ProcessesScreen.css";
import { Spinner } from "@blueprintjs/core";

export const ID = "pod.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [pod, setPod] = useState<Pod>();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const podFetch = useStoreActions((actions) => actions.pod.podFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const pod = await podFetch({
          Id: id,
          WithKube: true,
        });
        setPod(pod);
      } catch (error) {
        console.error("Unable to generate at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [podFetch, id]);

  const loading = (pending || !pod);
  const contents = loading ? <Spinner /> : (
    <>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={`${pod?.Kube}`} mode="yaml" />
      </div>
    </>
  );

  return (
    <div className="AppScreen" data-screen={ID} data-pending={loading ? "yes" : "no"} ref={screenRef}>
      {contents}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod kube";
Screen.Route = {
  Path: `/screens/pod/:id/kube`
};
Screen.Metadata = {
  LeftIcon: IconNames.LIST_DETAIL_VIEW,
  ExcludeFromSidebar: true
};
