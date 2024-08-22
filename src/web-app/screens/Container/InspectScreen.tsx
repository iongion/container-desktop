import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { Container } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { Notification } from "@/web-app/Notification";
import { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./InspectScreen.css";

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

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const container = await containerFetch({
          Id: decodeURIComponent(id as any)
        });
        setContainer(container);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [containerFetch, id]);

  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const contentNode = e.currentTarget?.parentNode.closest("tr").querySelector("td:nth-child(2)");
      await navigator.clipboard.writeText(contentNode?.innerText || "");
      Notification.show({ message: t("The value was copied to clipboard"), intent: Intent.SUCCESS });
    },
    [t]
  );

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
      const info = Array.isArray(ports[portProtocol]) ? ports[portProtocol] : [];
      info.forEach((info) => {
        const item = {
          key: `${portProtocol}`,
          value: `${info.HostIp}`.indexOf("::") !== -1 ? `${info.HostIp || "0.0.0.0"}${info.HostPort}` : `${info.HostIp || "0.0.0.0"}:${info.HostPort}`
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
        <HTMLTable compact striped className="AppDataTable" data-table="container.inspect">
          <tbody>
            {groups.map((group) => {
              const items = group.items.map((item) => {
                return (
                  <tr key={`${group.name}_${item.key}_${item.value}`}>
                    <td>{item.key}</td>
                    <td>{item.value}</td>
                    <td>
                      <Button small minimal icon={IconNames.CLIPBOARD} onClick={onCopyToClipboardClick} />
                    </td>
                  </tr>
                );
              });
              return (
                <React.Fragment key={group.name}>
                  <tr key={`group_${group.name}`} data-table-row="group.name" data-section-group={group.name}>
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
