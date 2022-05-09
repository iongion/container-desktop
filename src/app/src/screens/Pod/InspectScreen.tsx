import { useEffect, useRef, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

import { AppScreenProps, AppScreen, Pod } from "../../Types";
import { ScreenHeader } from ".";
import { CodeEditor } from "../../components/CodeEditor";

import { useStoreActions } from "../../domain/types";

import "./InspectScreen.css";
import { Spinner } from "@blueprintjs/core";

export const ID = "pod.inspect";

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
          Id: id
        });
        setPod(pod);
      } catch (error) {
        console.error("Unable to fetch at this moment", error);
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
        <CodeEditor value={`${JSON.stringify(pod || {}, null, 2)}`} mode="json" />
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
Screen.Title = "Pod Inspect";
Screen.Route = {
  Path: `/screens/pod/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.EYE_OPEN,
  ExcludeFromSidebar: true
};
