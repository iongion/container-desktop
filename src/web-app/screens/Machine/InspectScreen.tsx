import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { PodmanMachine } from "@/env/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";

import "./InspectScreen.css";

export const ID = "machine.inspect";
export const Title = "Machine Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [machine, setMachine] = useState<PodmanMachine>();
  const { name } = useParams<{ name: string }>();
  const machineInspect = useStoreActions((actions) => actions.machine.machineInspect);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const machine = await machineInspect({
          Name: name as string
        });
        setMachine(machine);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [machineInspect, name]);
  if (!machine) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader machine={machine} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(machine, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/machines/:name/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID,
  ExcludeFromSidebar: true
};
