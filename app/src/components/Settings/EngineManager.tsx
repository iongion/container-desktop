import { useCallback, useState } from "react";
import { RadioGroup, Radio, HTMLSelect } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { useStoreState } from "../../Domain";
import { SystemServiceEngineType } from "../../Types";
import { Platforms } from "../../Native";

const RadioLabel: React.FC<{ text: string }> = ({ text }) => {
  return <span className="RadioLabel">{text}</span>;
};

export interface SystemServiceEngineManagerProps {}

export const SystemServiceEngineManager: React.FC<SystemServiceEngineManagerProps> = () => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.platform);
  const connections = useStoreState((state) => state.connections);
  const [systemServiceConnection, setSystemServiceConnection] = useState<SystemServiceEngineType>(
    platform === Platforms.Linux ? SystemServiceEngineType.native : SystemServiceEngineType.remote
  );
  const onSystemServiceConnection = useCallback((e) => {
    setSystemServiceConnection(e.currentTarget.value);
  }, []);
  console.debug(systemServiceConnection);
  const virtualizationEngines = [
    { engine: "wsl", title: t("WSL"), description: t("Windows Subsystem for Linux") },
    { engine: "lima", title: t("Lima"), description: t("MacOS Subsystem for Linux") }
  ];
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
            return <option key={connection.Name}>{connection.Name}</option>;
          })}
        </HTMLSelect>
      </Radio>
      <Radio
        labelElement={<RadioLabel text={t("Virtualized")} />}
        value="virtualized"
        checked={systemServiceConnection === SystemServiceEngineType.virtualized}
      >
        <HTMLSelect disabled={systemServiceConnection !== SystemServiceEngineType.virtualized} fill>
          {virtualizationEngines.map((engine) => {
            return <option key={engine.engine}>{engine.title}</option>;
          })}
        </HTMLSelect>
      </Radio>
    </RadioGroup>
  );
};
