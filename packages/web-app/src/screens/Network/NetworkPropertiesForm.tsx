import { InputGroup, FormGroup, Intent, Checkbox, HTMLSelect } from "@blueprintjs/core";
import { useFormContext, Controller } from "react-hook-form";
// import { DevTool } from "@hookform/devtools";
import { useTranslation } from "react-i18next";

// locals
import "./NetworkPropertiesForm.css";


// Port subnets
export interface NetworkPropertiesFormProps {
  disabled?: boolean;
  pending?: boolean;
}

export const NetworkPropertiesForm: React.FC<NetworkPropertiesFormProps> = ({ disabled, pending }) => {
  const { t } = useTranslation();

  const { control } = useFormContext<{
    networkName: "",
    networkInterface: string;
    dnsEnabled: boolean;
    internal: boolean;
    ipv6Enabled: boolean;
    driver: string;
  }>();

  return (
    <div className="AppDataForm" data-form="network.properties.manage">
      <div className="AppDataFormFields">
        <FormGroup inline disabled={pending} label={<strong>{t("Name")}</strong>} labelFor="networkName" labelInfo="*">
          <Controller
            control={control}
            name="networkName"
            rules={{ required: true }}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <InputGroup
                  fill
                  autoFocus
                  disabled={pending}
                  id={name}
                  className="networkName"
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
        <FormGroup inline disabled={pending} label={<strong>{t("Interface")}</strong>} labelFor="networkInterface" labelInfo="*">
          <Controller
            control={control}
            name="networkInterface"
            rules={{ required: true }}
            defaultValue=""
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <InputGroup
                  fill
                  disabled={pending}
                  id={name}
                  className="networkInterface"
                  placeholder={t("Interface name on the host")}
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
        <FormGroup disabled={pending} helperText={t("Name resolution is active for container on this Network.")}>
          <Controller
            control={control}
            name="dnsEnabled"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <Checkbox
                  disabled={pending}
                  id={name}
                  name={name}
                  checked={value}
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                  label={t("DNS enabled")}
                />
              );
            }}
          />
        </FormGroup>
        <FormGroup disabled={pending} helperText={t("Block external routes exposure to public or other Networks")}>
          <Controller
            control={control}
            name="internal"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <Checkbox
                  disabled={pending}
                  id={name}
                  name={name}
                  checked={value}
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                  label={t("Internal")}
                />
              );
            }}
          />
        </FormGroup>
        <FormGroup disabled={pending} >
          <Controller
            control={control}
            name="ipv6Enabled"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <Checkbox
                  disabled={pending}
                  id={name}
                  name={name}
                  checked={value}
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                  label={t("IPv6 enabled - ipv6 subnet will be created")}
                />
              );
            }}
          />
        </FormGroup>
        <FormGroup disabled={pending} label={<strong>{t("Network driver")} *</strong>}>
          <Controller
            control={control}
            name="driver"
            rules={{ required: true }}
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <HTMLSelect
                  fill
                  name={name}
                  value={value}
                  onBlur={onBlur}
                  onChange={onChange}
                  title={t("Driver")}
                >
                  <option value="">{t("-- select --")}</option>
                  <option value="bridge">{t("Bridge")}</option>
                  <option value="macvlan">{t("MAC vlan")}</option>
                  <option value="ipvlan">{t("IP vlan")}</option>
                  <option value="host">{t("Host")}</option>
                  <option value="null">{t("null")}</option>
                </HTMLSelect>
              );
            }}
          />
        </FormGroup>
      </div>
      {/*<DevTool control={control} />*/}
    </div>
  );
};
