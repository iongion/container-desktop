import { InputGroup, FormGroup, Intent } from "@blueprintjs/core";
import { useFormContext, Controller } from "react-hook-form";
// import { DevTool } from "@hookform/devtools";
import { useTranslation } from "react-i18next";

// locals
import "./RegistryPropertiesForm.css";


// Port subnets
export interface RegistryPropertiesFormProps {
  disabled?: boolean;
  pending?: boolean;
}

export const RegistryPropertiesForm: React.FC<RegistryPropertiesFormProps> = ({ disabled, pending }) => {
  const { t } = useTranslation();

  const { control } = useFormContext<{
    registryName: "",
    registryInterface: string;
    dnsEnabled: boolean;
    internal: boolean;
    ipv6Enabled: boolean;
    driver: string;
  }>();

  return (
    <div className="AppDataForm" data-form="registry.properties.manage">
      <div className="AppDataFormFields">
        <FormGroup inline disabled={pending} label={<strong>{t("Registry")}</strong>} labelFor="registryName" labelInfo="*">
          <Controller
            control={control}
            name="registryName"
            rules={{ required: true }}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <InputGroup
                  fill
                  autoFocus
                  disabled={pending}
                  id={name}
                  className="registryName"
                  placeholder={t("Type to set a name")}
                  name={name}
                  value={value}
                  required
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                  intent={invalid ? Intent.DANGER : Intent.NONE}
                />
              );
            }}
          />
        </FormGroup>
      </div>
      {/*<DevTool control={control} />*/}
    </div>
  );
};
