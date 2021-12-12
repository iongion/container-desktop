import { useCallback, useEffect, useState } from "react";
import { ControlGroup, InputGroup, Button, RadioGroup, Radio, HTMLSelect, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project
import { SystemServiceEngineType } from "../../Types";
import { Native, Platforms } from "../../Native";
import { Notification } from "../../Notification";
import { useStoreActions, useStoreState } from "../../domain/types";

const RadioLabel: React.FC<{ text: string }> = ({ text }) => {
  return <span className="RadioLabel">{text}</span>;
};

const WSLVirtualizationEngineSettings: React.FC = () => {
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

const LIMAVirtualizationEngineSettings: React.FC = () => {
  const { t } = useTranslation();
  const native = useStoreState((state) => state.native);
  const [programPaths, setProgramPaths] = useState<{ [key: string]: any }>({});
  const programSetPath = useStoreActions((actions) => actions.settings.programSetPath);
  const program = {
    name: "lima",
    path: ""
  };
  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const sender = e.currentTarget as HTMLElement;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath && program) {
          try {
            const newProgram = await programSetPath({ name: "lima", path: filePath });
            console.debug("Program updated", newProgram);
            setProgramPaths((prev) => ({ ...prev, [program]: filePath }));
          } catch (error) {
            console.error("Unable to change program path", error);
            Notification.show({ message: t("Unable to change program path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [programSetPath, setProgramPaths, t]
  );
  const onProgramPathChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      if (program) {
        setProgramPaths({ ...programPaths, [program]: sender.value });
      }
    },
    [programPaths]
  );
  return (<div className="VirtualizationEngineSettings" data-engine="lima">
    <ControlGroup fill={true} vertical={false}>
      <InputGroup
        fill
        id={`${program.name}_path`}
        readOnly={native}
        placeholder={"..."}
        value={programPaths[program.name] || program.path}
        onChange={onProgramPathChange}
      />
      {native ? (
        <Button
          icon={IconNames.LOCATE}
          text={t("Select")}
          title={t("Select program")}
          intent={Intent.PRIMARY}
          onClick={onProgramSelectClick}
        />
      ) : (
        <Button icon={IconNames.TICK} title={t("Accept")} />
      )}
    </ControlGroup>
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
  const onSystemServiceConnection = useCallback((e) => {
    setSystemServiceConnection(e.currentTarget.value);
  }, []);
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
        disabled={platform !== Platforms.Windows}
        labelElement={<RadioLabel text={t("WSL")} />}
        value="virtualized.wsl"
        checked={systemServiceConnection === SystemServiceEngineType.wsl}
      >
        <WSLVirtualizationEngineSettings />
      </Radio>
      <Radio
        disabled={platform !== Platforms.Mac}
        labelElement={<RadioLabel text={t("Lima")} />}
        value="virtualized.lima"
        checked={systemServiceConnection === SystemServiceEngineType.lima}
      >
        <LIMAVirtualizationEngineSettings />
      </Radio>
    </RadioGroup>
  );
};
