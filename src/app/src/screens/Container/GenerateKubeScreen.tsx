import { useEffect, useRef, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

import { AppScreenProps, AppScreen, Container } from "../../Types";
import { ScreenHeader } from ".";
import { ScreenLoader } from "../../components/ScreenLoader";
import { CodeEditor } from "../../components/CodeEditor";

import { useStoreActions } from "../../domain/types";

import "./GenerateKubeScreen.css";
import { Spinner } from "@blueprintjs/core";

export const ID = "container.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const container = await containerFetch({
          Id: id,
          withKube: true,
        });
        setContainer(container);
      } catch (error) {
        console.error("Unable to generate at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [containerFetch, id]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const loading = pending;
  const contents = loading ? <Spinner /> : (
    <>
      <ScreenHeader container={container} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={`${container?.Kube}`} mode="yaml" />
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
Screen.Title = "Container kube";
Screen.Route = {
  Path: `/screens/container/:id/kube`
};
Screen.Metadata = {
  LeftIcon: IconNames.TEXT_HIGHLIGHT,
  ExcludeFromSidebar: true
};
