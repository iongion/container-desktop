import { useEffect } from "react";
import { Icon, InputGroup, FormGroup, NumericInput, H5 } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useFieldArray, useForm, Controller } from "react-hook-form";
// import { DevTool } from "@hookform/devtools";
import { useTranslation } from "react-i18next";

// project
import { ContainerImagePortMapping } from "../../Types";

export const toPortMappings = (exposed: { [key: string]: number }) => {
  const mappings: ContainerImagePortMapping[] = Object.keys(exposed).map((key) => {
    const [container_port_raw, protocol] = key.split("/");
    const container_port = Number(container_port_raw);
    const host_port = container_port < 1000 ? 8000 + container_port : container_port;
    return {
      container_port: Number(container_port),
      host_ip: "127.0.0.1",
      host_port: host_port,
      protocol: protocol as any
    };
  });
  return mappings;
};

// Port mappings
export interface PortMappingsFormProps {
  disabled?: boolean;
  portMappings: ContainerImagePortMapping[];
  onChange: (e: ContainerImagePortMapping[]) => void;
}

export const PortMappingsForm: React.FC<PortMappingsFormProps> = ({ disabled, portMappings, onChange }) => {
  const { t } = useTranslation();
  const { control, watch, getValues, setValue } = useForm({
    mode: "onChange",
    defaultValues: {
      mappings: portMappings
    }
  });
  const { fields } = useFieldArray({
    control,
    name: "mappings"
  });

  useEffect(() => {
    portMappings.forEach((it) => setValue("mappings", portMappings));
  }, [setValue, portMappings]);

  useEffect(() => {
    const subscription = watch(() => {
      const { mappings } = getValues();
      if (mappings) {
        onChange(mappings);
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, getValues, onChange, portMappings]);

  return (
    <div className="AppDataForm" data-form="container.portMappings.manage">
      <div className="AppDataFormHeader">
        <Icon icon={IconNames.DATA_CONNECTION} />
        &nbsp;<H5>{t("Port mappings")}</H5>
      </div>
      <div className="AppDataFormFields">
        {fields.map((portMapping, index) => {
          const key = [portMapping.container_port, portMapping.protocol].join("_");
          return (
            <FormGroup
              key={key}
              inline
              className="ContainerPortMappings"
              data-port-mapping={index}
              data-protocol={portMapping.protocol}
              data-port={portMapping.container_port}
              disabled={disabled}
              label={`${portMapping.protocol} / ${portMapping.container_port}`}
            >
              <Controller
                control={control}
                name={`mappings.${index}.host_ip`}
                rules={{ required: true }}
                defaultValue={portMapping.host_ip}
                render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                  return (
                    <InputGroup
                      name={name}
                      inputRef={ref}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      placeholder={t("Host address")}
                    />
                  );
                }}
              />
              <Controller
                control={control}
                name={`mappings.${index}.host_port`}
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
                    />
                  );
                }}
              />
            </FormGroup>
          );
        })}
      </div>
      {/*<DevTool control={control} />*/}
    </div>
  );
};
