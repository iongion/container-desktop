import { useState, useMemo } from "react";
import {
  ButtonGroup,
  Button,
  Intent,
  Drawer,
  DrawerSize,
  ProgressBar,
  Classes,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

// project
import { useStoreActions } from "../../domain/types";
import { createNetworkSubnet, NetworkSubnetItem, NetworkSubnetsForm } from "./NetworkSubnetsForm";
import dayjs from "dayjs";
import { NetworkSubnet } from "../../Types.container-app";
import { Notification } from "../../Notification";
import { NetworkPropertiesForm } from "./NetworkPropertiesForm";

// Drawer

export interface CreateFormData {
  networkName: "",
  networkInterface: string;
  dnsEnabled: boolean;
  internal: boolean;
  ipv6Enabled: boolean;
  driver: string;
  subnets: NetworkSubnetItem[];
}

export function toNetworkSubnets(subnets: NetworkSubnetItem[]) {
  const items: NetworkSubnet[] = subnets.map((it) => {
    const coerced = {
      ...it,
      guid: undefined
    };
    return coerced;
  }).reduce<NetworkSubnet[]>((acc, it) => {
    if (it.gateway && it.subnet) {
      acc.push(it);
    }
    return acc;
  }, []);
  return items;
}

export interface FormActionsProps {
  pending?: boolean;
}
export const FormActions: React.FC<FormActionsProps> = ({ pending }) => {
  const { t } = useTranslation();
  const { formState } = useFormContext();
  const pendingIndicator = (
    <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
  );
  return (
    <>
      <ButtonGroup fill>
        <Button
          disabled={pending || !formState.isValid}
          intent={Intent.PRIMARY}
          icon={IconNames.GRAPH}
          title={t("Click to launch creation")}
          text={t("Create")}
          type="submit"
        />
      </ButtonGroup>
      {pendingIndicator}
    </>
  );
}

export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const subnets = useMemo(() => {
    return [createNetworkSubnet()];
  }, []);
  const methods = useForm<CreateFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      networkName: "",
      networkInterface: "",
      dnsEnabled: false,
      internal: false,
      ipv6Enabled: false,
      driver: "",
      subnets,
    }
  });
  const { handleSubmit } = methods;
  const [pending, setPending] = useState(false);  // Form initial data

  const networkCreate = useStoreActions((actions) => actions.network.networkCreate);
  const onSubmit = handleSubmit(async (data) => {
    setPending(true);
    try {
      await networkCreate({
        created: dayjs().toISOString(),
        dns_enabled: data.dnsEnabled,
        driver: data.driver,
        internal: data.internal,
        name: data.networkName,
        network_interface: data.networkInterface,
        subnets: toNetworkSubnets(data.subnets),
      });
      onClose();
      Notification.show({ message: t("Network has been created"), intent: Intent.SUCCESS });
    } catch (error: any) {
      Notification.show({
        message: t("{{message}} - {{data}}", {
          message: error.message || t("Command failed"),
          data: error.details?.result?.result?.data?.cause,
        }),
        intent: Intent.DANGER
      });
    } finally {
      setPending(false);
    }
  });
  return (
    <Drawer
      className="AppDrawer"
      icon={IconNames.PLUS}
      title={t("Create new network")}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onClose}
      isOpen
      hasBackdrop={false}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form name="CreateNetworkForm" className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <FormActions />
            <div className="AppDataForm" data-form="network.create">
              <NetworkPropertiesForm disabled={pending} />
              <NetworkSubnetsForm subnets={subnets} disabled={pending} />
            </div>
          </form>
        </FormProvider>
      </div>
    </Drawer>
  );
}
