import { useCallback } from "react";
import { Button, Icon, InputGroup, FormGroup, NumericInput, HTMLSelect, H5 } from "@blueprintjs/core";
import { IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";

// project
import Environment from "../../Environment";
import { Native } from "../../Native";
import { ContainerImageMount, MOUNT_ACCESS, MOUNT_TYPES } from "../../Types";
import { useStoreState } from "../../domain/types";

// Mount
export interface MountFormContainerImageMount extends ContainerImageMount {
  guid: string;
}

export interface MountFormAction {
  icon: IconName;
  data: any;
  handler: (action: MountFormAction, mount: MountFormContainerImageMount) => void;
}

export interface MountFormProps {
  disabled?: boolean;
  mount: MountFormContainerImageMount;
  mountIndex: number;
  onChange: (e: MountFormContainerImageMount) => void;
  action: MountFormAction;
}

export const MountForm: React.FC<MountFormProps> = ({ disabled, mount, mountIndex, onChange, action }) => {
  const { t } = useTranslation();
  const isNative = useStoreState((state) => state.native);

  const onMountTypeChange = useCallback(
    (e) => {
      mount.type = e.currentTarget.value;
      onChange(mount);
    },
    [onChange, mount]
  );

  const onMountAccessChange = useCallback(
    (e) => {
      mount.access = e.currentTarget.value;
      onChange(mount);
    },
    [onChange, mount]
  );

  const onMountSizeChange = useCallback(
    (valueAsNumber: number) => {
      mount.size = valueAsNumber;
      onChange(mount);
    },
    [onChange, mount]
  );

  const onMountSourceChange = useCallback(
    (e) => {
      mount.source = e.currentTarget.value;
      onChange(mount);
    },
    [onChange, mount]
  );

  const onMountDestinationChange = useCallback(
    (e) => {
      mount.destination = e.currentTarget.value;
      onChange(mount);
    },
    [onChange, mount]
  );

  const onVolumeHostPathSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const result = await Native.getInstance().openFileSelector({ directory: true });
      const filePath = result.filePaths[0];
      if (!result.canceled && filePath) {
        mount.source = filePath;
        onChange(mount);
      }
    },
    [onChange, mount]
  );

  const onActionClick = useCallback(() => {
    console.debug("Action", action, mount);
    action.handler(action, mount);
  }, [action, mount]);

  const pathSelectButton = isNative ? (
    <Button minimal icon={IconNames.LOCATE} onClick={onVolumeHostPathSelectClick} />
  ) : undefined;

  let mountTypeDefinition;
  let accessDefinition;

  const type = mount.type;

  if (type === "bind") {
    const fieldName = `mounts.${mountIndex}.source`;
    mountTypeDefinition = (
      <FormGroup inline disabled={disabled} label={t("Source")} labelFor={fieldName}>
        <InputGroup
          id={fieldName}
          name={fieldName}
          value={mount.source}
          title={mount.source}
          fill
          placeholder={t("Path on host")}
          required
          rightElement={pathSelectButton}
          onChange={onMountSourceChange}
        />
      </FormGroup>
    );
  } else if (type === "volume") {
    const fieldName = `mounts.${mountIndex}.source`;
    mountTypeDefinition = (
      <FormGroup inline disabled={disabled} label={t("Volume")} labelFor={fieldName}>
        <HTMLSelect
          id={fieldName}
          name={fieldName}
          value={mount.source}
          title={mount.source}
          onChange={onMountSourceChange}
        >
          {MOUNT_TYPES.map((type) => {
            return (
              <option key={type} value={type}>
                {type}
              </option>
            );
          })}
        </HTMLSelect>
      </FormGroup>
    );
  } else if (type === "tmpfs") {
    const fieldName = `mounts.${mountIndex}.size`;
    mountTypeDefinition = (
      <FormGroup inline disabled={disabled} label={t("Size")} labelFor={fieldName}>
        <NumericInput
          id={fieldName}
          name={fieldName}
          value={mount.size}
          onValueChange={onMountSizeChange}
          disabled={disabled}
          fill
          className="ContainerFileSystemSize"
          allowNumericCharactersOnly
          placeholder={t("Size in MB")}
          min={0}
          max={65535}
          stepSize={1}
          minorStepSize={1}
          rightElement={<div className="AppFormFieldMeasureUnit">{t("MB")}</div>}
        />
      </FormGroup>
    );
  }
  if (type === "bind" || type === "image" || type === "volume") {
    const fieldName = `mounts.${mountIndex}.access`;
    accessDefinition = (
      <FormGroup inline disabled={disabled} label={t("Access")} labelFor={fieldName}>
        <HTMLSelect
          id={fieldName}
          name={fieldName}
          value={mount.access}
          onChange={onMountAccessChange}
          className={fieldName}
          title={mount.access}
        >
          {MOUNT_ACCESS.map((access) => {
            return (
              <option key={access.type} value={access.type}>
                {access.title}
              </option>
            );
          })}
        </HTMLSelect>
      </FormGroup>
    );
  }
  const mountTypeFieldName = `mounts.${mountIndex}.type`;
  const mountDestinationFieldName = `mount.${mountIndex}.destination`;
  const customizeMounts = Environment.features.customizeMounts?.enabled ? (
    <>
      <FormGroup inline disabled={disabled} label={t("Type")} labelFor={mountTypeFieldName}>
        <HTMLSelect
          id={mountTypeFieldName}
          name={mountTypeFieldName}
          value={type}
          title={type}
          className={mountTypeFieldName}
          onChange={onMountTypeChange}
        >
          {MOUNT_TYPES.map((type) => {
            return (
              <option key={type} value={type}>
                {type}
              </option>
            );
          })}
        </HTMLSelect>
      </FormGroup>
      {accessDefinition}
    </>
  ) : null;
  return (
    <div className="ContainerMount" data-mount-index={mountIndex}>
      <div className="ContainerMountProperties">
        {customizeMounts}
        {mountTypeDefinition}
        <FormGroup inline disabled={disabled} label={t("Destination")} labelFor={mountDestinationFieldName}>
          <InputGroup
            id={mountDestinationFieldName}
            name={mountDestinationFieldName}
            value={mount.destination}
            onChange={onMountDestinationChange}
            fill
            required
            placeholder={t("Path in container")}
          />
        </FormGroup>
      </div>
      <div className="ContainerMountActions">
        <Button minimal icon={action.icon} onClick={onActionClick} />
      </div>
    </div>
  );
};

// Mounts
export interface MountsFormProps {
  disabled?: boolean;
  mounts: MountFormContainerImageMount[];
  onChange: (e: MountFormContainerImageMount[]) => void;
}

export const createMount = (): MountFormContainerImageMount => {
  return {
    guid: v4(),
    driver: "local",
    type: "bind",
    access: "ro",
    size: 512,
    source: "",
    destination: ""
  };
};

export const MountsForm: React.FC<MountsFormProps> = ({ disabled, mounts, onChange }) => {
  const { t } = useTranslation();
  const onMountAction = useCallback(
    (action, mount) => {
      if (action.data === "add") {
        const next = [...mounts, createMount()];
        onChange(next);
      } else if (action.data === "remove") {
        const next = [...mounts];
        const mountIndex = mounts.findIndex((it) => it === mount);
        if (mountIndex !== -1) {
          next.splice(mountIndex, 1);
        }
        onChange(next);
      }
    },
    [onChange, mounts]
  );

  const onMountChange = useCallback(
    (mount) => {
      const mountIndex = mounts.findIndex((it) => it.guid === mount.guid);
      if (mountIndex !== -1) {
        const next = [...mounts];
        next[mountIndex] = mount;
        onChange(next);
      }
    },
    [onChange, mounts]
  );

  return (
    <div className="AppDataForm" data-form="container.mounts.manage">
      <div className="AppDataFormHeader">
        <Icon icon={IconNames.DATABASE} />
        &nbsp;<H5>{t("Mounts")}</H5>
      </div>
      <div className="AppDataFormFields">
        {mounts.map((mount, index) => {
          const isLast = index === mounts.length - 1;
          return (
            <MountForm
              key={mount.guid}
              disabled={disabled}
              mount={mount}
              mountIndex={index}
              onChange={onMountChange}
              action={{
                icon: isLast ? IconNames.PLUS : IconNames.MINUS,
                data: isLast ? "add" : "remove",
                handler: onMountAction
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
