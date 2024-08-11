import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

// project
import { AppScreen, AppScreenProps } from "../../Types";
import { CodeEditor } from "../../components/CodeEditor";
import { ScreenLoader } from "../../components/ScreenLoader";
import { useStoreActions } from "../../domain/types";

import { Network } from "../../Types.container-app";
// module
import { ScreenHeader } from ".";

import "./InspectScreen.css";

export const ID = "network.inspect";
export const Title = "Network Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [network, setNetwork] = useState<Network>();
  const { name } = useParams<{ name: string }>();
  const networkFetch = useStoreActions((actions) => actions.network.networkFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const network = await networkFetch(name);
        setNetwork(network);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [networkFetch, name]);
  if (!network) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader network={network} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(network, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/network/:name/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  ExcludeFromSidebar: true
};
