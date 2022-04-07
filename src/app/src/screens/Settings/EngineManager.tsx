import { useCallback, useMemo, useState } from "react";
import { RadioGroup, Radio, Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

// project
import { ContainerEngine } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { IconNames } from "@blueprintjs/icons";

export interface ContainerEngineManagerProps {}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = () => {
  const { t } = useTranslation();
  const programSetEngine = useStoreActions((actions) => actions.settings.programSetEngine);
  const environmentEngine = useStoreState((state) => state.environment.engine);
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
  const [selectedEngine, setSelectedEngine] = useState(environmentEngine);
  const onContainerEngineChange = useCallback((e) => {
    setSelectedEngine(e.currentTarget.value);
  }, []);
  const onSaveSettingsClick = useCallback((e) => {
    programSetEngine(selectedEngine).finally(() => {
      Native.getInstance().exit();
      Native.getInstance().relaunch();
    });
  }, [programSetEngine, selectedEngine]);
  return (
    <div className="AppSettingsForm" data-form="engine">
      <div className="AppSettingsFormColumn">
        <RadioGroup
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
                labelElement={<RadioLabel text={label} highlight={environmentEngine === it.engine} />}
                value={engine}
              >
                {restrict}
              </Radio>
            );
          })}
        </RadioGroup>
      </div>
      <div className="AppSettingsFormColumn">
        <Button icon={IconNames.FLOPPY_DISK} intent={Intent.PRIMARY} text={t('Save')} title={t('Save and restart')} onClick={onSaveSettingsClick} />
      </div>
    </div>
  );
};
