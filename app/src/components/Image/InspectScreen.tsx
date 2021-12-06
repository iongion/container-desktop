import { useEffect, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

import { AppScreen, ContainerImage } from "../../Types";
import { useStoreActions } from "../../Domain";
import { ScreenHeader } from ".";
import { ScreenLoader } from "../ScreenLoader";
import { CodeEditor } from "../CodeEditor";

import "./InspectScreen.css";

interface ScreenProps {}

export const ID = "image.inspect";
export const Title = "Image Inspect";

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [image, setImage] = useState<ContainerImage>();
  const { id } = useParams<{ id: string }>();
  const imageFetch = useStoreActions((actions) => actions.imageFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const image = await imageFetch({
          Id: id,
          withHistory: true
        });
        setImage(image);
      } catch (error) {
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
