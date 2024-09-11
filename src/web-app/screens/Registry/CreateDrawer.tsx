import { Button, ButtonGroup, Classes, Drawer, DrawerSize, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import dayjs from "dayjs";
import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { ContainerEngine } from "@/env/Types";
import { useStoreActions } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";
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
  const pendingIndicator = <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>;
  return (
    <>
      <ButtonGroup fill>
        <Button disabled={pending || !formState.isValid} intent={Intent.PRIMARY} icon={IconNames.PLUS} title={t("Click to launch creation")} text={t("Create")} type="submit" />
      </ButtonGroup>
      {pendingIndicator}
    </>
  );
};

export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose }: CreateDrawerProps) => {
  const { t } = useTranslation();
  const methods = useForm<CreateFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      registryName: ""
    }
  });
  const { handleSubmit } = methods;
  const [pending, setPending] = useState(false); // Form initial data

  const registryCreate = useStoreActions((actions) => actions.registry.registryCreate);
  const onSubmit = handleSubmit(async (data) => {
    setPending(true);
    try {
      await registryCreate({
        created: dayjs().toISOString(),
        name: data.registryName,
        id: data.registryName,
        weight: 0,
        enabled: true,
        isRemovable: true,
        isSystem: false,
        engine: [ContainerEngine.PODMAN]
      });
      onClose();
      Notification.show({ message: t("Registry has been created"), intent: Intent.SUCCESS });
    } catch (error: any) {
      Notification.show({
        message: t("{{message}} - {{data}}", {
          message: error.message || t("Command failed"),
          data: error.details?.result?.result?.data?.cause
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
      icon={<ReactIcon.Icon path={mdiCubeUnfolded} size={0.75} className="ReactIcon" />}
      title={t("Configure registry")}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onClose}
      isOpen
      hasBackdrop={false}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form name="CreateRegistryForm" className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <FormActions />
            <div className="AppDataForm" data-form="registry.create">
              <RegistryPropertiesForm disabled={pending} />
            </div>
          </form>
        </FormProvider>
      </div>
    </Drawer>
  );
};
