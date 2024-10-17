import { Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import type { Container } from "@/env/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";

import "./GenerateKubeScreen.css";

export const ID = "container.kube";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
  const onScreenReload = useCallback(async () => {
    try {
      setPending(true);
      const container = await containerFetch({
        Id: decodeURIComponent(id as any),
        withKube: true,
      });
      setContainer(container);
    } catch (error: any) {
      console.error("Unable to generate at this moment", error);
    } finally {
      setPending(false);
    }
  }, [containerFetch, id]);

  useEffect(() => {
    onScreenReload();
  }, [onScreenReload]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const loading = pending;
  const contents = loading ? (
    <Spinner />
  ) : (
    <>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
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
  Path: "/screens/container/:id/kube",
};
Screen.Metadata = {
  LeftIcon: IconNames.TEXT_HIGHLIGHT,
  ExcludeFromSidebar: true,
};
