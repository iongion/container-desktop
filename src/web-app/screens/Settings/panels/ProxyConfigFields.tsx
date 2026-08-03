import { FormGroup, HTMLSelect, InputGroup, NumericInput, TextArea } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { ProxyConfig, ProxyProtocol } from "@/container-client/types/network";

// The proxy endpoint + credentials + bypass field cluster, as a controlled component. Shared by the global
// Settings → Network panel and the per-connection Proxy override section, so both edit the SAME ProxyConfig
// shape with identical validation semantics. `value` is a full (normalized) ProxyConfig; `onChange` receives
// the whole next config.
export interface ProxyConfigFieldsProps {
  value: ProxyConfig;
  onChange: (next: ProxyConfig) => void;
  disabled?: boolean;
}

export const ProxyConfigFields: React.FC<ProxyConfigFieldsProps> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation();
  const set = <K extends keyof ProxyConfig>(key: K, next: ProxyConfig[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <div className="AppSettingsNetworkEndpoint">
        <FormGroup className="ProxyField ProxyField--protocol" label={t("Protocol")} labelFor="proxyProtocol">
          <HTMLSelect
            id="proxyProtocol"
            value={value.protocol}
            disabled={disabled}
            fill
            onChange={(event) => set("protocol", event.currentTarget.value as ProxyProtocol)}
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </HTMLSelect>
        </FormGroup>
        <FormGroup className="ProxyField ProxyField--host" label={t("Host")} labelFor="proxyHost">
          <InputGroup
            id="proxyHost"
            value={value.host}
            disabled={disabled}
            fill
            onChange={(event) => set("host", event.currentTarget.value)}
          />
        </FormGroup>
        <FormGroup className="ProxyField ProxyField--port" label={t("Port")} labelFor="proxyPort">
          <NumericInput
            id="proxyPort"
            value={value.port || ""}
            disabled={disabled}
            fill
            allowNumericCharactersOnly
            min={0}
            max={65535}
            stepSize={1}
            minorStepSize={1}
            onValueChange={(next) => set("port", Number.isFinite(next) ? next : 0)}
          />
        </FormGroup>
      </div>

      <div className="AppSettingsNetworkCredentials">
        <FormGroup className="ProxyField ProxyField--username" label={t("Username")} labelFor="proxyUsername">
          <InputGroup
            id="proxyUsername"
            value={value.username}
            disabled={disabled}
            fill
            onChange={(event) => set("username", event.currentTarget.value)}
          />
        </FormGroup>
        <FormGroup className="ProxyField ProxyField--password" label={t("Password")} labelFor="proxyPassword">
          <InputGroup
            id="proxyPassword"
            type="password"
            value={value.password}
            disabled={disabled}
            fill
            onChange={(event) => set("password", event.currentTarget.value)}
          />
        </FormGroup>
      </div>

      <FormGroup className="ProxyField ProxyField--bypass" label={t("Bypass hosts")} labelFor="proxyBypass">
        <TextArea
          id="proxyBypass"
          value={value.bypass.join("\n")}
          disabled={disabled}
          fill
          onChange={(event) => set("bypass", event.currentTarget.value.split(/\n/))}
        />
      </FormGroup>
    </>
  );
};
