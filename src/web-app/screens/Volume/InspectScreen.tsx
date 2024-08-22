import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Volume } from "@/env/Types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";

import { VolumeActionsMenu } from ".";
import "./InspectScreen.css";

export const ID = "volume.inspect";
export const Title = "Volume Inspect";

export interface ScreenProps extends AppScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const [volume, setVolume] = useState<Volume>();
  const { id } = useParams<{ id: string }>();
  const [pending, setPending] = useState(true);
  const volumeFetch = useStoreActions((actions) => actions.volume.volumeFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const volume = await volumeFetch({
          Id: id as any
        });
        setVolume(volume);
      } catch (error: any) {
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
      <AppScreenHeader withoutSearch withBack titleText={volume.Name} titleIcon={IconNames.DATABASE} rightContent={<VolumeActionsMenu volume={volume} withoutCreate />} />
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
  LeftIcon: IconNames.DATABASE,
  ExcludeFromSidebar: true
};
