import { useCallback, useEffect, useState } from "react";
import { ControlGroup, InputGroup, Button, RadioGroup, Radio, HTMLSelect, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiLinux, mdiMicrosoftWindows, mdiApple } from '@mdi/js';

// project
import { ServiceEngineType } from "../../Types";
import { Native, Platforms } from "../../Native";
import { Notification } from "../../Notification";
import { useStoreActions, useStoreState } from "../../domain/types";

const RestrictedTo: React.FC<{ platform: Platforms }> = ({ platform }) => {
  const { t } = useTranslation();
  const platformsMap: { [key: string]: { icon: string; title: string } } = {
    [Platforms.Linux]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
    },
    [Platforms.Windows]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
    },
    [Platforms.Mac]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
    },
  };
  const info = platformsMap[platform];
  return (<div className="EngineRestrictedTo" data-platform={platform}>
    <ReactIcon.Icon path={info.icon} size={0.75} />
    <span className="EngineTitle">{info.title}</span>
    </div>);
}

const RadioLabel: React.FC<{ text: string }> = ({ text }) => {
  return <span className="RadioLabel">{text}</span>;
};

const WSLVirtualizationEngineSettings: React.FC<{disabled?: boolean}> = ({ disabled }) => {
  const platform = useStoreState((state) => state.environment.platform);
  const wslDistributions = useStoreState((state) =>
    state.settings.wslDistributions ? state.settings.wslDistributions : []
  );
  const fetchWSLDistributions = useStoreActions((actions) => actions.settings.fetchWSLDistributions);
  const [wslDistribution, setWSLDistribution] = useState(undefined);
  const onVirtualizationEngineChange = useCallback((e) => {
    setWSLDistribution(e.currentTarget.value);
  }, []);
  const isWindows = platform === Platforms.Windows;
  useEffect(() => {
    if (isWindows) {
      fetchWSLDistributions();
    }
  }, [isWindows, fetchWSLDistributions]);
  return (
    <div className="VirtualizationEngineSettings" data-engine="wsl">
      {isWindows ? (
        <HTMLSelect onChange={onVirtualizationEngineChange} value={wslDistribution} disabled={disabled}>
          {wslDistributions.map((distribution) => {
            return <option key={distribution.name}>{distribution.name}</option>;
          })}
        </HTMLSelect>
      ) : (
        <RestrictedTo platform={Platforms.Windows} />
      )}
    </div>
  );
};

const LIMAVirtualizationEngineSettings: React.FC<{disabled?: boolean}> = ({ disabled }) => {
  const { t } = useTranslation();
  const native = useStoreState((state) => state.native);
  const platform = useStoreState((state) => state.environment.platform);
  const isMac = platform === Platforms.Mac;
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
  return (
    <div className="VirtualizationEngineSettings" data-engine="lima">
      {isMac ? (
        <ControlGroup vertical={false}>
          <InputGroup
            fill
            id={`${program.name}_path`}
            readOnly={native}
            placeholder={"..."}
            value={programPaths[program.name] || program.path}
            disabled={disabled}
            onChange={onProgramPathChange}
          />
          {native ? (
            <Button
              icon={IconNames.LOCATE}
              text={t("Select")}
              title={t("Select program")}
              intent={Intent.PRIMARY}
              disabled={disabled}
              onClick={onProgramSelectClick}
            />
          ) : (
            <Button icon={IconNames.TICK} title={t("Accept")} />
          )}
        </ControlGroup>
      ) : (
        <RestrictedTo platform={Platforms.Mac} />
      )}
    </div>
  );
};

export interface SystemServiceEngineManagerProps {}

export const SystemServiceEngineManager: React.FC<SystemServiceEngineManagerProps> = () => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.environment.platform);
  const connections = useStoreState((state) => state.environment.connections);
  const engine = useStoreState((state) => state.environment.engine);
  const onEngineChange = useCallback((e) => {
    // setEngine(e.currentTarget.value);
  }, []);
  return (
    <div className="AppSettingsForm" data-form="engine">
      <RadioGroup
        className="AppSettingsFormContent"
        data-form="engine"
        label={t("System service API client")}
        onChange={onEngineChange}
        selectedValue={engine}
      >
        <Radio
          className="AppSettingsField"
          labelElement={<RadioLabel text={t("Remote with")} />}
          value="remote"
          checked={engine === ServiceEngineType.remote}
        >
          <HTMLSelect disabled={engine !== ServiceEngineType.remote}>
            {connections.map((connection) => {
              return (
                <option key={connection.Name} value={connection.Name}>
                  {connection.Name}
                </option>
              );
            })}
          </HTMLSelect>
        </Radio>
        <Radio
          className="AppSettingsField"
          disabled={platform !== Platforms.Linux}
          labelElement={<RadioLabel text={t("Native")} />}
          value="native"
          checked={engine === ServiceEngineType.native}
        >
          <RestrictedTo platform={Platforms.Linux} />
        </Radio>
        <Radio
          className="AppSettingsField"
          disabled={platform !== Platforms.Windows}
          labelElement={<RadioLabel text={t("WSL")} />}
          value="virtualized.wsl"
          checked={engine === ServiceEngineType.wsl}
        >
          <WSLVirtualizationEngineSettings disabled={engine !== ServiceEngineType.wsl} />
        </Radio>
        <Radio
          className="AppSettingsField"
          disabled={platform !== Platforms.Mac}
          labelElement={<RadioLabel text={t("Lima")} />}
          value="virtualized.lima"
          checked={engine === ServiceEngineType.lima}
        >
          <LIMAVirtualizationEngineSettings disabled={engine !== ServiceEngineType.lima} />
        </Radio>
      </RadioGroup>
    </div>
  );
};
