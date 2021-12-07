import React, { useEffect, useRef, useState } from "react";
import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import ClipboardJS from "clipboard";

import { AppScreen, Container } from "../../Types";
import { ScreenHeader } from ".";
import { ScreenLoader } from "../ScreenLoader";
import { Notification } from "../../Notification";

import { useStoreActions } from "./Model";

import "./InspectScreen.css";

const sortAlphaNum = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

interface InspectGroupValues {
  key: string;
  value: string;
}
interface InspectGroup {
  name: string;
  title: string;
  items: InspectGroupValues[];
}

export const ID = "container.inspect";

interface ScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const clipboardRef = useRef<ClipboardJS>();
  const screenRef = useRef<HTMLDivElement>(null);
  const containerFetch = useStoreActions((actions) => actions.containerFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const container = await containerFetch({
          Id: id
        });
        setContainer(container);
      } catch (error) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [containerFetch, id]);
  useEffect(() => {
    if (!container || !screenRef.current) {
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
  }, [container, t]);
  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  const config = container.Config || { Env: [] };
  const environmentVariables = (config.Env || []).sort(sortAlphaNum).map<InspectGroupValues>((env) => {
    const [key, value] = env.split("=");
    return {
      key,
      value
    };
  });
  const volumeMounts: InspectGroupValues[] = container.Mounts.map((mount) => {
    return {
      key: mount.Source,
      value: mount.Destination
    };
  });
  const containerPorts: InspectGroupValues[] = [];
  const ports = container.NetworkSettings?.Ports;
  if (ports) {
    Object.keys(ports).forEach((portProtocol) => {
      const info = ports[portProtocol];
      info.forEach((info) => {
        const item = {
          key: `${portProtocol}`,
          value: `${info.HostIp || "0.0.0.0"}:${info.HostPort}`
        };
        containerPorts.push(item);
      });
    });
  }
  const groups: InspectGroup[] = [
    { name: "environment", title: t("Environment variables"), items: environmentVariables },
    { name: "mounts", title: t("Mounts"), items: volumeMounts },
    { name: "ports", title: t("Ports"), items: containerPorts }
  ];
  return (
    <div className="AppScreen" data-screen={ID} ref={screenRef}>
      <ScreenHeader container={container} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="container.inspect">
          <tbody>
            {groups.map((group) => {
              const items = group.items.map((item) => {
                return (
                  <tr key={`${group.name}_${item.key}`}>
                    <td>{item.key}</td>
                    <td>{item.value}</td>
                    <td>
                      <Button small minimal icon={IconNames.CLIPBOARD} data-action="copy.to.clipboard" />
                    </td>
                  </tr>
                );
              });
              return (
                <React.Fragment key={group.name}>
                  <tr key={`group_${group.name}`} data-table-row="group.name" data-group={group.name}>
                    <td colSpan={3}>{group.title}</td>
                  </tr>
                  {items}
                </React.Fragment>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Inspect";
Screen.Route = {
  Path: `/screens/container/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true
};
