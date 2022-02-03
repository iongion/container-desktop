import { useEffect, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

// project
import { AppScreenProps, AppScreen, ContainerImage } from "../../Types";
import { ScreenLoader } from "../../components/ScreenLoader";
import { CodeEditor } from "../../components/CodeEditor";
import { useStoreActions } from "../../domain/types";

// module
import { ScreenHeader } from ".";

import "./InspectScreen.css";


export const ID = "image.inspect";
export const Title = "Image Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [image, setImage] = useState<ContainerImage>();
  const { id } = useParams<{ id: string }>();
  const fetchOne = useStoreActions((actions) => actions.image.fetchOne);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const image = await fetchOne({
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
  }, [fetchOne, id]);
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
