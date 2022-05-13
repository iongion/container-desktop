import React, { useEffect, useRef, useState } from "react";
import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import ClipboardJS from "clipboard";

import { AppScreenProps, AppScreen } from "../../Types";
import { ScreenHeader } from ".";
import { ScreenLoader } from "../../components/ScreenLoader";
import { Notification } from "../../Notification";

import { useStoreActions } from "../../domain/types";

import "./InspectScreen.css";
import { Network } from "../../Types.container-app";

export const ID = "network.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [network, setNetwork] = useState<Network>();
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();
  const clipboardRef = useRef<ClipboardJS>();
  const screenRef = useRef<HTMLDivElement>(null);
  const networkFetch = useStoreActions((actions) => actions.network.networkFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const network = await networkFetch(name);
        setNetwork(network);
      } catch (error) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [networkFetch, name]);
  useEffect(() => {
    if (!network || !screenRef.current) {
      return;
    }
    if (clipboardRef.current) {
      clipboardRef.current.destroy();
    }
    clipboardRef.current = new ClipboardJS(screenRef.current.querySelectorAll('[data-action="copy.to.clipboard"]'), {
      text: (trigger: Element): string => {
        Notification.show({ message: t("The value was copied to clipboard"), intent: Intent.SUCCESS });
        return (
          trigger.parentElement?.parentElement?.querySelector<HTMLTableCellElement>("tr td:nth-child(2)")?.innerText ||
          ""
        );
      }
    });
  }, [network, t]);
  if (!network) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID} ref={screenRef}>
      <ScreenHeader network={network} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="network.inspect">
          <tbody>

          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Network Inspect";
Screen.Route = {
  Path: `/screens/network/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.AREA_OF_INTEREST,
  ExcludeFromSidebar: true
};
