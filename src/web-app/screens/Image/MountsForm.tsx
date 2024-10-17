import { Button, FormGroup, H5, Icon, InputGroup } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";

import type { ContainerImageMount } from "@/env/Types";
import { useStoreState } from "@/web-app/domain/types";

import { Application } from "@/container-client/Application";
import "./MountsForm.css";

export const createMount = (): MountFormContainerImageMount => {
  return {
    guid: v4(),
    driver: "local",
    type: "bind",
    access: "ro",
    size: 512,
    source: "",
    destination: "",
  };
};
export interface MountFormContainerImageMount extends ContainerImageMount {
  guid: string;
}
export interface MountFormAction {
  icon: IconName;
  data: any;
  handler?: MountFormActionHandler;
}
export type MountFormActionHandler = (action: MountFormAction, mount: MountFormContainerImageMount) => void;

export interface MountFormProps {
  disabled?: boolean;
  mount: MountFormContainerImageMount;
  mountIndex: number;
  action: MountFormAction;
}

export const MountForm: React.FC<MountFormProps> = ({ disabled, mount, mountIndex, action }: MountFormProps) => {
  const { t } = useTranslation();
  const isNative = useStoreState((state) => state.native);

  const { control, setValue } = useFormContext<{
    mounts: MountFormContainerImageMount[];
  }>();

  const onVolumeHostPathSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const instance = Application.getInstance();
      const result = await instance.openFileSelector({ directory: true });
      const filePath = result.filePaths[0];
      if (!result.canceled && filePath) {
        setValue(`mounts.${mountIndex}.source`, filePath);
      }
    },
    [setValue, mountIndex],
  );

  const onActionClick = useCallback(() => {
    if (action.handler) {
      action.handler(action, mount);
    }
  }, [action, mount]);

  return (
    <div className="ContainerMount" data-mount-index={mountIndex}>
      <div className="ContainerMountProperties">
        <Controller
          control={control}
          name={`mounts.${mountIndex}.source`}
          defaultValue={mount.source}
          render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
            const pathSelectButton = isNative ? (
              <Button minimal icon={IconNames.LOCATE} onClick={onVolumeHostPathSelectClick} />
            ) : undefined;
            return (
              <FormGroup inline disabled={disabled} label={t("Source")} labelFor={name}>
                <InputGroup
                  id={name}
                  name={name}
                  inputRef={ref}
                  disabled={disabled}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  fill
                  placeholder={t("Path on host")}
                  rightElement={pathSelectButton}
                />
              </FormGroup>
            );
          }}
        />
        <Controller
          control={control}
          name={`mounts.${mountIndex}.destination`}
          defaultValue={mount.destination}
          render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
            return (
              <FormGroup inline disabled={disabled} label={t("Destination")} labelFor={name}>
                <InputGroup
                  id={name}
                  name={name}
                  inputRef={ref}
                  disabled={disabled}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  fill
                  placeholder={t("Path in container")}
                />
              </FormGroup>
            );
          }}
        />
      </div>
      <div className="ContainerMountActions">
        <Button disabled={disabled} minimal icon={action.icon} onClick={onActionClick} />
      </div>
    </div>
  );
};

// Mounts
export interface MountsFormProps {
  disabled?: boolean;
  mounts: MountFormContainerImageMount[];
}

export const MountsForm: React.FC<MountsFormProps> = ({ disabled, mounts }: MountsFormProps) => {
  const { t } = useTranslation();

  const { control } = useFormContext<{
    mounts: MountFormContainerImageMount[];
  }>();

  const { fields, remove, prepend } = useFieldArray({
    control,
    name: "mounts",
  });

  const onMountFormAction = useCallback<MountFormActionHandler>(
    (action, mount) => {
      if (action.data === "add") {
        prepend(createMount());
      } else if (action.data === "remove") {
        const mountIndex = mounts.findIndex((it) => it.guid === mount.guid);
        remove(mountIndex);
      }
    },
    [prepend, remove, mounts],
  );

  return (
    <div className="AppDataForm" data-form="container.mounts.manage">
      <div className="AppDataFormHeader">
        <Icon icon={IconNames.DATABASE} />
        &nbsp;<H5>{t("Mounts")}</H5>
      </div>
      <div className="AppDataFormFields">
        {fields.map((mount, index) => {
          const isLast = index === mounts.length - 1;
          return (
            <MountForm
              key={mount.guid}
              disabled={disabled}
              mount={mount}
              mountIndex={index}
              action={{
                icon: isLast ? IconNames.PLUS : IconNames.MINUS,
                data: isLast ? "add" : "remove",
                handler: onMountFormAction,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
