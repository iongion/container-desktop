import { Button, FormGroup, H5, HTMLSelect, Icon, InputGroup, NumericInput } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
// import { DevTool } from "@hookform/devtools";
import { useTranslation } from "react-i18next";

import type { ContainerImagePortMapping } from "@/env/Types";

// locals
import { createPortMapping } from "@/utils";
import "./PortMappingsForm.css";

export interface PortMappingFormAction {
  icon: IconName;
  data: any;
  handler?: PortMappingFormActionHandler;
}
export type PortMappingFormActionHandler = (
  action: PortMappingFormAction,
  portMapping: ContainerImagePortMapping,
) => void;

// Port mapping
export interface PortMappingFormProps {
  disabled?: boolean;
  portMapping: ContainerImagePortMapping;
  portMappingIndex: number;
  action: PortMappingFormAction;
}

export const PortMappingForm: React.FC<PortMappingFormProps> = ({
  action,
  disabled,
  portMapping,
  portMappingIndex,
}: PortMappingFormProps) => {
  const { t } = useTranslation();
  const { control } = useFormContext<{
    amount: number;
    mappings: ContainerImagePortMapping[];
  }>();

  const onActionClick = useCallback(() => {
    if (action.handler) {
      action.handler(action, portMapping);
    }
  }, [action, portMapping]);

  return (
    <div className="ContainerImagePortMapping" data-mount-index={portMappingIndex}>
      <div className="ContainerImagePortMappingProperties">
        <FormGroup
          inline
          className="ContainerPortMappings"
          data-port-mapping={portMappingIndex}
          data-protocol={portMapping.protocol}
          data-port={portMapping.container_port}
          disabled={disabled}
          label={
            <Controller
              control={control}
              name={`mappings.${portMappingIndex}.protocol`}
              rules={{ required: true }}
              defaultValue={portMapping.protocol}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <HTMLSelect
                    name={name}
                    disabled={disabled}
                    className="ContainerPortMappingProtocol"
                    value={value}
                    onBlur={onBlur}
                    onChange={onChange}
                    title={t("Container protocol")}
                  >
                    <option value="tcp">{t("TCP")}</option>
                    <option value="udp">{t("UDP")}</option>
                    <option value="sdp">{t("SDP")}</option>
                  </HTMLSelect>
                );
              }}
            />
          }
        >
          <Controller
            control={control}
            name={`mappings.${portMappingIndex}.container_port`}
            rules={{ required: true }}
            defaultValue={portMapping.container_port}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <NumericInput
                  name={name}
                  inputRef={ref}
                  disabled={disabled}
                  className="ContainerPortMappingPort"
                  value={value}
                  allowNumericCharactersOnly
                  min={0}
                  max={65535}
                  stepSize={1}
                  minorStepSize={1}
                  onBlur={onBlur}
                  onValueChange={onChange}
                  title={t("Container port")}
                />
              );
            }}
          />
          <Controller
            control={control}
            name={`mappings.${portMappingIndex}.host_ip`}
            rules={{ required: true }}
            defaultValue={portMapping.host_ip}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <InputGroup
                  name={name}
                  inputRef={ref}
                  disabled={disabled}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  placeholder={t("Host address")}
                  title={t("Host address")}
                />
              );
            }}
          />
          <Controller
            control={control}
            name={`mappings.${portMappingIndex}.host_port`}
            rules={{ required: true }}
            defaultValue={portMapping.host_port}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <NumericInput
                  name={name}
                  inputRef={ref}
                  disabled={disabled}
                  className="ContainerPortMappingPort"
                  value={value}
                  allowNumericCharactersOnly
                  min={0}
                  max={65535}
                  stepSize={1}
                  minorStepSize={1}
                  onBlur={onBlur}
                  onValueChange={onChange}
                  title={t("Host port")}
                />
              );
            }}
          />
        </FormGroup>
      </div>
      <div className="ContainerImagePortMappingActions">
        <Button disabled={disabled} minimal icon={action.icon} onClick={onActionClick} />
      </div>
    </div>
  );
};

// Port mappings
export interface PortMappingsFormProps {
  disabled?: boolean;
  portMappings: ContainerImagePortMapping[];
}

export const PortMappingsForm: React.FC<PortMappingsFormProps> = ({
  disabled,
  portMappings,
}: PortMappingsFormProps) => {
  const { t } = useTranslation();

  const { control } = useFormContext<{
    mappings: ContainerImagePortMapping[];
  }>();

  const { fields, remove, prepend } = useFieldArray({
    control,
    name: "mappings",
  });

  const onPortMappingFormAction = useCallback<PortMappingFormActionHandler>(
    (action, portMapping) => {
      if (action.data === "add") {
        prepend(createPortMapping());
      } else if (action.data === "remove") {
        const portMappingIndex = portMappings.findIndex((it) => it.guid === portMapping.guid);
        remove(portMappingIndex);
      }
    },
    [prepend, remove, portMappings],
  );

  return (
    <div className="AppDataForm" data-form="container.portMappings.manage">
      <div className="AppDataFormHeader">
        <Icon icon={IconNames.DATA_CONNECTION} />
        &nbsp;<H5>{t("Port mappings")}</H5>
      </div>
      <div className="AppDataFormFields">
        {fields.map((portMapping, index) => {
          const isLast = index === portMappings.length - 1;
          const key = portMapping.guid;
          return (
            <PortMappingForm
              key={key}
              disabled={disabled}
              portMapping={portMapping}
              portMappingIndex={index}
              action={{
                icon: isLast ? IconNames.PLUS : IconNames.MINUS,
                data: isLast ? "add" : "remove",
                handler: onPortMappingFormAction,
              }}
            />
          );
        })}
      </div>
      {/*<DevTool control={control} />*/}
    </div>
  );
};
