import { Button, ButtonGroup, Classes, DrawerSize, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import dayjs from "dayjs";
import { useId, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { ContainerEngine } from "@/env/Types";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCreateRegistry } from "./queries";
import { RegistryPropertiesForm } from "./RegistryPropertiesForm";

// Drawer

export interface CreateFormData {
  registryName: string;
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
          icon={IconNames.PLUS}
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
  const methods = useForm<CreateFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      registryName: "",
    },
  });
  const { handleSubmit } = methods;
  const [pending, setPending] = useState(false); // Form initial data

  const [connectionId, setConnectionId] = useState("");
  const connections = useAppStore((state) => state.connections);
  const registryCreate = useCreateRegistry(connectionId);
  const onSubmit = handleSubmit(async (data) => {
    setPending(true);
    try {
      const selectedEngine = connections.find((it) => it.id === connectionId)?.engine;
      await registryCreate.mutateAsync({
        created: dayjs().toISOString(),
        name: data.registryName,
        id: data.registryName,
        weight: 0,
        enabled: true,
        isRemovable: true,
        isSystem: false,
        engine: selectedEngine ? [selectedEngine] : [ContainerEngine.PODMAN],
      });
      onClose();
      Notification.show({
        message: t("Registry has been created"),
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
      className="AppCreateRegistryDrawer"
      icon={<ReactIcon.Icon path={mdiCubeUnfolded} size={0.75} className="ReactIcon" />}
      title={t("Configure registry")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={pending}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form id={formId} name="CreateRegistryForm" className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={pending} />
            <div className="AppDataForm" data-form="registry.create">
              <RegistryPropertiesForm disabled={pending} />
            </div>
            <FormActions pending={pending} />
          </form>
        </FormProvider>
      </div>
    </AppDrawer>
  );
};
