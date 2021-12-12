import { useCallback, useState } from "react";
import { AnchorButton, Button, Callout, ControlGroup, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiEmoticonSad } from "@mdi/js";

// project
import Environment from "../../Environment";
import { AppScreen, AppScreenProps } from "../../Types";
import { Native } from "../../Native";
import { Notification } from "../../Notification";
import { CodeEditor } from "../../components/CodeEditor";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { SystemServiceEngineManager } from "./EngineManager";

import "./Settings.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const [programPaths, setProgramPaths] = useState<{ [key: string]: any }>({});
  const { t } = useTranslation();
  const native = useStoreState((state) => state.native);
  const running = useStoreState((state) => state.running);
  const system = useStoreState((state) => state.system);
  const program = useStoreState((state) =>
    state.settings.environment ? state.settings.environment.program : state.program
  );
  const programSetPath = useStoreActions((actions) => actions.settings.programSetPath);
  const provisioned = program && program.path;
  const isValid = provisioned && program.currentVersion;
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
            const newProgram = await programSetPath({ name: "podman", path: filePath });
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

  const contentWidget = provisioned && running ? null : (
    <Callout
      className="AppSettingsCallout"
      title={t("Automatic detection failed")}
      icon={<ReactIcon.Icon path={mdiEmoticonSad} size={3} />}
    >
      <p>{t("To be able to continue, all required programs need to be installed")}</p>
    </Callout>
  );

  const engineSwitcher = Environment.features.engineSwitcher?.enabled ? (
    <SystemServiceEngineManager />
  ) : null;

  const systemDetailsViewer = provisioned && running ? (<CodeEditor value={JSON.stringify(system, null, 2)} />) : null;

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AppScreenContent">
        {contentWidget}
        <div className="AppSettingsForm" data-form="paths">
          <div
            className="AppSettingsField"
            data-field="program.path"
            data-program-name={program.name}
            data-program-present={isValid ? "yes" : "no"}
          >
            <FormGroup
              helperText={
                <div className="AppSettingsFieldProgramHelper">
                  &nbsp;
                  {isValid ? (
                    <span>{t("Detected version {{currentVersion}}", program)}</span>
                  ) : program.currentVersion ? (
                    t("The location of the {{program}} executable binary", { program: program.name })
                  ) : (
                    t("Could not detect current version")
                  )}
                </div>
              }
              label={
                <AnchorButton
                  minimal
                  icon={isValid ? IconNames.THUMBS_UP : IconNames.THUMBS_DOWN}
                  intent={isValid ? Intent.SUCCESS : Intent.DANGER}
                  text={program.title}
                  title={t("Go to {{title}} homepage", program)}
                  target="_blank"
                  href={program.homepage}
                />
              }
              labelFor={`${program.name}_path`}
              labelInfo={t("(required)")}
            >
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
            </FormGroup>
          </div>
        </div>
        {engineSwitcher}
        {systemDetailsViewer}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true
};
