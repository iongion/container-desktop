import { useCallback, useMemo, useState } from "react";
import { RadioGroup, Radio, Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

// project
import { ContainerEngine } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { IconNames } from "@blueprintjs/icons";

export interface ContainerEngineManagerProps {
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled }) => {
  const { t } = useTranslation();
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const ContainerEngines = useMemo(
    () => [
      { engine: ContainerEngine.NATIVE, label: t("Native"), active: false, enabled: true },
      {
        engine: ContainerEngine.VIRTUALIZED,
        label: t("Podman Machine"),
        active: false,
        enabled: true
      },
      { engine: ContainerEngine.REMOTE, label: t("Podman Remote"), active: false, enabled: false }
    ],
    [t]
  );
  const platform = useStoreState((state) => state.environment.platform);
  const [selectedEngine, setSelectedEngine] = useState(userConfiguration.engine);
  const onContainerEngineChange = useCallback((e) => {
    setSelectedEngine(e.currentTarget.value);
  }, []);
  const onSaveSettingsClick = useCallback((e) => {
    setUserConfiguration({ engine: selectedEngine }).finally(() => {
      Native.getInstance().exit();
      Native.getInstance().relaunch();
    });
  }, [setUserConfiguration, selectedEngine]);
  return (
    <div className="AppSettingsForm" data-form="engine">
      <div className="AppSettingsFormColumn">
        <RadioGroup
          disabled={disabled}
          className="AppSettingsFormContent"
          data-form="engine"
          label={t("Container environment")}
          onChange={onContainerEngineChange}
          selectedValue={selectedEngine}
        >
          {ContainerEngines.map((it) => {
            let restrict;
            let disabled = !it.enabled;
            const { engine, label } = it;
            if (engine === ContainerEngine.NATIVE) {
              if (platform === Platforms.Mac || platform === Platforms.Windows) {
                disabled = true;
              }
            }
            return (
              <Radio
                key={engine}
                className="AppSettingsField"
                disabled={disabled}
                labelElement={<RadioLabel text={label} highlight={userConfiguration.engine === it.engine} />}
                value={engine}
              >
                {restrict}
              </Radio>
            );
          })}
        </RadioGroup>
      </div>
      <div className="AppSettingsFormColumn">
        <Button disabled={disabled} icon={IconNames.FLOPPY_DISK} intent={Intent.PRIMARY} text={t('Save')} title={t('Save and restart')} onClick={onSaveSettingsClick} />
      </div>
    </div>
  );
};
