import { useCallback, useEffect, useState } from "react";
import { RadioGroup, Radio, HTMLSelect } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

// project
import { SystemServiceEngineType } from "../../Types";
import { Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";

const RadioLabel: React.FC<{ text: string }> = ({ text }) => {
  return <span className="RadioLabel">{text}</span>;
};

const WSLVirtualizationEngineSettings: React.FC<any> = () => {
  // const { t } = useTranslation();
  const wslDistributions = useStoreState((state) =>
    state.settings.wslDistributions ? state.settings.wslDistributions : []
  );
  const fetchWSLDistributions = useStoreActions((actions) => actions.settings.fetchWSLDistributions);
  const [wslDistribution, setWSLDistribution] = useState(undefined);
  const onVirtualizationEngineChange = useCallback((e) => {
    setWSLDistribution(e.currentTarget.value);
  }, []);
  useEffect(() => {
    fetchWSLDistributions();
  }, [fetchWSLDistributions]);
  return (<div className="VirtualizationEngineSettings" data-engine="wsl">
    <HTMLSelect fill onChange={onVirtualizationEngineChange} value={wslDistribution}>
      {wslDistributions.map((distribution) => {
        return <option key={distribution.name}>{distribution.name}</option>;
      })}
    </HTMLSelect>
  </div>);
};

export interface SystemServiceEngineManagerProps {}

export const SystemServiceEngineManager: React.FC<SystemServiceEngineManagerProps> = () => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.platform);
  const connections = useStoreState((state) => state.connections);
  const [systemServiceConnection, setSystemServiceConnection] = useState<SystemServiceEngineType>(
    platform === Platforms.Linux ? SystemServiceEngineType.native : SystemServiceEngineType.remote
  );
  const [virtualizationEngine, setVirtualizationEngine] = useState(platform === Platforms.Windows ? 'wsl' : undefined);
  const onSystemServiceConnection = useCallback((e) => {
    setSystemServiceConnection(e.currentTarget.value);
  }, []);
  const onVirtualizationEngineChange = useCallback((e) => {
    setVirtualizationEngine(e.currentTarget.value);
  }, []);
  const virtualizationEngines = [
    { engine: "wsl", title: t("WSL"), description: t("Windows Subsystem for Linux") },
    { engine: "lima", title: t("Lima"), description: t("MacOS Subsystem for Linux") }
  ];
  let virtualizationConfiguration = null;
  console.debug(virtualizationEngine);
  if (virtualizationEngine === "wsl") {
    virtualizationConfiguration = <WSLVirtualizationEngineSettings />;
  }
  return (
    <RadioGroup
      label={t("System service")}
      onChange={onSystemServiceConnection}
      selectedValue={systemServiceConnection}
    >
      <Radio
        labelElement={<RadioLabel text={t("Native")} />}
        value="native"
        checked={systemServiceConnection === SystemServiceEngineType.native}
      />
      <Radio
        labelElement={<RadioLabel text={t("Remote with")} />}
        value="remote"
        checked={systemServiceConnection === SystemServiceEngineType.remote}
      >
        <HTMLSelect disabled={systemServiceConnection !== SystemServiceEngineType.remote} fill>
          {connections.map((connection) => {
            return <option key={connection.Name} value={connection.Name}>{connection.Name}</option>;
          })}
        </HTMLSelect>
      </Radio>
      <Radio
        labelElement={<RadioLabel text={t("Virtualized")} />}
        value="virtualized"
        checked={systemServiceConnection === SystemServiceEngineType.virtualized}
      >
        <HTMLSelect disabled={systemServiceConnection !== SystemServiceEngineType.virtualized} fill onChange={onVirtualizationEngineChange} value={virtualizationEngine}>
          {virtualizationEngines.map((engine) => {
            return <option key={engine.engine} value={engine.engine}>{engine.title}</option>;
          })}
        </HTMLSelect>
        {virtualizationConfiguration}
      </Radio>
    </RadioGroup>
  );
};
