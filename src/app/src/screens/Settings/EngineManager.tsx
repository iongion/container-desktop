import { useCallback, useMemo } from "react";
import { RadioGroup, Radio, FormGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

// project
import { ContainerEngine } from "../../Types";
import { Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";

export interface ContainerEngineManagerProps {
  helperText?: string;
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled, helperText }) => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.environment.platform);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const ContainerEngines = useMemo(
    () => {
      const engines = [
        { engine: ContainerEngine.NATIVE, label: t("Native"), active: false, enabled: true },
        {
          engine: ContainerEngine.VIRTUALIZED,
          label: t("Podman Machine"),
          active: false,
          enabled: true
        },
        // { engine: ContainerEngine.REMOTE, label: t("Podman Remote"), active: false, enabled: false },
        {
          engine: ContainerEngine.SUBSYSTEM_LIMA,
          label: t("LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        // {
        //   engine: ContainerEngine.SUBSYSTEM_WSL,
        //   label: t("WSL"),
        //   active: false,
        //   enabled: platform === Platforms.Windows
        // }
      ];
      return engines;
    },
    [t, platform]
  );
  const selectedEngine = userConfiguration.engine;
  const onContainerEngineChange = useCallback((e) => {
    setUserConfiguration({ engine: e.currentTarget.value });
  }, [setUserConfiguration]);
  return (
    <div className="AppSettingsForm" data-form="engine">
      <div className="AppSettingsFormColumn">
        <FormGroup helperText={helperText}>
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
              restrict = <RestrictedTo engine={engine} />;
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
        </FormGroup>
      </div>
    </div>
  );
};
