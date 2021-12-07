import { useEffect, useState } from "react";
import { IconNames } from "@blueprintjs/icons";
import { useParams } from "react-router-dom";

import { AppScreen, Volume } from "../../Types";
import { AppScreenHeader } from "../AppScreenHeader";
import { CodeEditor } from "../CodeEditor";
import { ScreenLoader } from "../ScreenLoader";

import { VolumeActionsMenu } from ".";
import { useStoreActions } from "./Model";

import "./InspectScreen.css";

interface ScreenProps {}

export const ID = "volume.inspect";
export const Title = "Volume Inspect";

export const Screen: AppScreen<ScreenProps> = () => {
  const [volume, setVolume] = useState<Volume>();
  const { id } = useParams<{ id: string }>();
  const [pending, setPending] = useState(true);
  const volumeFetch = useStoreActions((actions) => actions.volumeFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const volume = await volumeFetch({
          Id: id
        });
        setVolume(volume);
      } catch (error) {
        console.error("Unable to fetch the volume at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [volumeFetch, id]);
  if (!volume) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        titleText={volume.Name}
        titleIcon={IconNames.BOX}
        rightContent={<VolumeActionsMenu volume={volume} withoutCreate />}
      />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(volume, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/volumes/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true
};
