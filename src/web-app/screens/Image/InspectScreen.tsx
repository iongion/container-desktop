import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ContainerImage } from "@/env/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";

export const ID = "image.inspect";
export const Title = "Image Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [image, setImage] = useState<ContainerImage>();
  const { id } = useParams<{ id: string }>();
  const imageFetch = useStoreActions((actions) => actions.image.imageFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const image = await imageFetch({
          Id: decodeURIComponent(id as any),
          withHistory: true
        });
        setImage(image);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [imageFetch, id]);
  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(image, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/image/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true
};
