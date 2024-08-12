import { useCallback } from "react";
import { Button, Icon, InputGroup, FormGroup, H5, ControlGroup } from "@blueprintjs/core";
import { IconName, IconNames } from "@blueprintjs/icons";
import { useFieldArray, useFormContext, Controller } from "react-hook-form";
// import { DevTool } from "@hookform/devtools";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";

// project
import { NetworkSubnet } from "../../Types.container-app";

// locals
import "./NetworkSubnetsForm.css";

export interface NetworkSubnetItem extends NetworkSubnet {
  guid: string;
}

export const createNetworkSubnet = (): NetworkSubnetItem => {
  return {
    guid: v4(),
    gateway: "",
    subnet: "",
    lease_range: {
      start_ip: "",
      end_ip: ""
    }
  };
};

export interface NetworkSubnetFormAction {
  icon: IconName;
  data: any;
  handler?: NetworkSubnetFormActionHandler;
}
export type NetworkSubnetFormActionHandler = (
  action: NetworkSubnetFormAction,
  networkSubnet: NetworkSubnetItem
) => void;

export interface NetworkSubnetFormProps {
  disabled?: boolean;
  networkSubnet: NetworkSubnetItem;
  networkSubnetIndex: number;
  action: NetworkSubnetFormAction;
}

export const NetworkSubnetForm: React.FC<NetworkSubnetFormProps> = ({
  action,
  disabled,
  networkSubnet,
  networkSubnetIndex
}) => {
  const { t } = useTranslation();
  const { control } = useFormContext<{
    subnets: NetworkSubnetItem[];
  }>();

  const onActionClick = useCallback(() => {
    if (action.handler) {
      action.handler(action, networkSubnet);
    }
  }, [action, networkSubnet]);

  return (
    <div className="NetworkSubnet" data-mount-index={networkSubnetIndex}>
      <div className="NetworkSubnetProperties">
        <FormGroup
          inline
          className="ContainerNetworkSubnets"
          data-network-subnet={networkSubnetIndex}
          disabled={disabled}
        >
          <ControlGroup fill className="ContainerNetworkSubnet">
            <Controller
              control={control}
              name={`subnets.${networkSubnetIndex}.gateway`}
              defaultValue={networkSubnet.gateway}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <label htmlFor={name} className="ContainerNetworkSubnetField">
                    <span>{t("Gateway")}</span>
                    <InputGroup
                      id={name}
                      name={name}
                      inputRef={ref}
                      disabled={disabled}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      placeholder="10.90.0.0/16"
                      title={t("Gateway")}
                    />
                  </label>
                );
              }}
            />
            <Controller
              control={control}
              name={`subnets.${networkSubnetIndex}.subnet`}
              defaultValue={networkSubnet.subnet}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <label htmlFor={name} className="ContainerNetworkSubnetField">
                    <span>{t("Subnet")}</span>
                    <InputGroup
                      id={name}
                      name={name}
                      inputRef={ref}
                      disabled={disabled}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      placeholder="10.90.0.1"
                      title={t("Subnet")}
                    />
                  </label>
                );
              }}
            />
          </ControlGroup>
        </FormGroup>
        <FormGroup
          inline
          className="ContainerNetworkSubnets"
          data-network-subnet={networkSubnetIndex}
          disabled={disabled}
        >
          <ControlGroup fill>
            <Controller
              control={control}
              name={`subnets.${networkSubnetIndex}.lease_range.start_ip`}
              defaultValue={networkSubnet.lease_range.start_ip}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <label htmlFor={name} className="ContainerNetworkSubnetField">
                    <span>{t("Start IP")}</span>
                    <InputGroup
                      id={name}
                      name={name}
                      inputRef={ref}
                      disabled={disabled}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      placeholder="10.90.0.10"
                      title={t("Start IP")}
                    />
                  </label>
                );
              }}
            />
            <Controller
              control={control}
              name={`subnets.${networkSubnetIndex}.lease_range.end_ip`}
              defaultValue={networkSubnet.lease_range.end_ip}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <label htmlFor={name} className="ContainerNetworkSubnetField">
                    <span>{t("End IP")}</span>
                    <InputGroup
                      id={name}
                      name={name}
                      inputRef={ref}
                      disabled={disabled}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      placeholder="10.90.0.40"
                      title={t("End IP")}
                    />
                  </label>
                );
              }}
            />
          </ControlGroup>
        </FormGroup>
      </div>
      <div className="NetworkSubnetActions">
        <Button disabled={disabled} minimal icon={action.icon} onClick={onActionClick} />
      </div>
    </div>
  );
};

// Port subnets
export interface NetworkSubnetsFormProps {
  disabled?: boolean;
  subnets: NetworkSubnetItem[];
}

export const NetworkSubnetsForm: React.FC<NetworkSubnetsFormProps> = ({ disabled, subnets }) => {
  const { t } = useTranslation();

  const { control } = useFormContext<{
    subnets: NetworkSubnetItem[];
  }>();

  const { fields, remove, prepend } = useFieldArray({
    control,
    name: "subnets"
  });

  const onNetworkSubnetFormAction = useCallback<NetworkSubnetFormActionHandler>(
    (action, networkSubnet) => {
      if (action.data === "add") {
        prepend(createNetworkSubnet());
      } else if (action.data === "remove") {
        const networkSubnetIndex = subnets.findIndex((it) => it.guid === networkSubnet.guid);
        remove(networkSubnetIndex);
      }
    },
    [prepend, remove, subnets]
  );

  return (
    <div className="AppDataForm" data-form="network.subnets.manage">
      <div className="AppDataFormHeader">
        <Icon icon={IconNames.DATA_CONNECTION} />
        &nbsp;<H5>{t("Subnets")}</H5>
      </div>
      <div className="AppDataFormFields">
        {fields.map((networkSubnet, index) => {
          const isLast = index === subnets.length - 1;
          const key = networkSubnet.guid;
          return (
            <NetworkSubnetForm
              key={key}
              disabled={disabled}
              networkSubnet={networkSubnet}
              networkSubnetIndex={index}
              action={{
                icon: isLast ? IconNames.PLUS : IconNames.MINUS,
                data: isLast ? "add" : "remove",
                handler: onNetworkSubnetFormAction
              }}
            />
          );
        })}
      </div>
      {/*<DevTool control={control} />*/}
    </div>
  );
};
