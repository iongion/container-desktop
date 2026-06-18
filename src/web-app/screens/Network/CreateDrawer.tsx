import { Button, ButtonGroup, Classes, DrawerSize, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useId, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { NetworkSubnet } from "@/env/Types";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { Notification } from "@/web-app/Notification";
import { NetworkPropertiesForm } from "./NetworkPropertiesForm";
import { createNetworkSubnet, type NetworkSubnetItem, NetworkSubnetsForm } from "./NetworkSubnetsForm";
import { useCreateNetwork } from "./queries";

// Drawer

export interface CreateFormData {
  networkName: "";
  networkInterface: string;
  dnsEnabled: boolean;
  internal: boolean;
  ipv6Enabled: boolean;
  driver: string;
  subnets: NetworkSubnetItem[];
}

export function toNetworkSubnets(subnets: NetworkSubnetItem[]) {
  const items: NetworkSubnet[] = subnets
    .map((it) => {
      const normalized = {
        ...it,
        guid: undefined,
      };
      return normalized;
    })
    .reduce<NetworkSubnet[]>((acc, it) => {
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
export const FormActions: React.FC<FormActionsProps> = ({ pending }: FormActionsProps) => {
  const { t } = useTranslation();
  const { formState } = useFormContext();
  const pendingIndicator = (
    <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
  );
  return (
    <>
      {pendingIndicator}
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
    </>
  );
};

export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose }: CreateDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
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
    },
  });
  const { handleSubmit } = methods;
  const [pending, setPending] = useState(false); // Form initial data

  const [connectionId, setConnectionId] = useState("");
  const networkCreate = useCreateNetwork(connectionId);
  const onSubmit = handleSubmit(async (data) => {
    setPending(true);
    try {
      await networkCreate.mutateAsync({
        created: dayjs().toISOString(),
        dns_enabled: data.dnsEnabled,
        driver: data.driver,
        internal: data.internal,
        name: data.networkName,
        network_interface: data.networkInterface,
        subnets: toNetworkSubnets(data.subnets),
      });
      onClose();
      Notification.show({
        message: t("Network has been created"),
        intent: Intent.SUCCESS,
      });
    } catch (error: any) {
      Notification.show({
        message: t("{{message}} - {{data}}", {
          message: error.message || t("Command failed"),
          data: error.details?.result?.result?.data?.cause,
        }),
        intent: Intent.DANGER,
      });
    } finally {
      setPending(false);
    }
  });
  return (
    <AppDrawer
      icon={IconNames.PLUS}
      title={t("Create new network")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={pending}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form id={formId} name="CreateNetworkForm" className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={pending} />
            <div className="AppDataForm" data-form="network.create">
              <NetworkPropertiesForm disabled={pending} />
              <NetworkSubnetsForm subnets={subnets} disabled={pending} />
            </div>
            <FormActions pending={pending} />
          </form>
        </FormProvider>
      </div>
    </AppDrawer>
  );
};
