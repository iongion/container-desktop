import {
  Button,
  ButtonGroup,
  Classes,
  DrawerSize,
  FormGroup,
  HTMLTable,
  InputGroup,
  Intent,
  NumericInput,
  ProgressBar,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
// module
import type { ContainerImage, ContainerImagePortMapping } from "@/env/Types";
// project
import { toPortMappings } from "@/utils";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { Notification } from "@/web-app/Notification";
import { useCreateContainer } from "@/web-app/screens/Container/queries";
import { createMount, type MountFormContainerImageMount, MountsForm } from "./MountsForm";
import { PortMappingsForm } from "./PortMappingsForm";
import { useImage } from "./queries";

import "./CreateDrawer.css";
import { createLogger } from "@/logger";

const logger = createLogger("web.image");

export interface CreateFormData {
  amount: number;
  imageContainerName: string;
  mounts: MountFormContainerImageMount[];
  mappings: ContainerImagePortMapping[];
}
export interface CreateDrawerProps {
  image: ContainerImage;
  // The image's owning connection. A container is created FROM this image, so it MUST be created on the same
  // engine — the picker is shown (for engine clarity, like every form) but locked to this connection.
  connectionId?: string;
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({
  image,
  connectionId: connectionIdProp,
  onClose,
}: CreateDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const [connectionId, setConnectionId] = useState(connectionIdProp || "");
  const containerCreate = useCreateContainer(connectionId);
  const imageDetails = useImage(connectionId, image.Id, { Id: image.Id });
  const template = imageDetails.data || image;
  const pending = imageDetails.isLoading || containerCreate.isPending;
  // The container can only be created on the engine that holds this image, so the picker is locked to it.
  const lockToImageConnection = useCallback((it: { id: string }) => it.id === connectionId, [connectionId]);

  // Form initial data
  const mounts = useMemo(() => {
    return [createMount()];
  }, []);
  const mappings = useMemo(() => {
    return toPortMappings(template?.Config?.ExposedPorts || {});
  }, [template]);

  // Form setup
  const methods = useForm<CreateFormData>({
    defaultValues: {
      amount: 1,
      mounts,
      mappings,
    },
  });
  const { reset, control, handleSubmit } = methods;
  const onSubmit = handleSubmit(async (data) => {
    try {
      if (!connectionId) {
        throw new Error("No active connection");
      }
      const creator = {
        Amount: data.amount,
        ImageId: image.Id,
        Name: data.imageContainerName,
        Start: true,
        Mounts: data.mounts.filter((it) => it.source && it.destination),
        PortMappings: data.mappings,
      };
      const create = await containerCreate.mutateAsync(creator);
      if (create.created) {
        if (create.started) {
          Notification.show({
            message: t("Container(s) created and started"),
            intent: Intent.SUCCESS,
          });
        } else {
          Notification.show({
            message: t("Container(s) created but could not start"),
            intent: Intent.WARNING,
          });
        }
        onClose();
      } else {
        Notification.show({
          message: t("Unable to start container(s) from image"),
          intent: Intent.DANGER,
        });
      }
    } catch (error: any) {
      logger.error("Unable to start container(s) from image", error);
      Notification.show({
        message: t("Unable to start container(s) from image"),
        intent: Intent.DANGER,
      });
    }
  });

  // Change over time - form fields
  useEffect(() => {
    const next = { mounts, mappings };
    reset(next);
  }, [reset, mounts, mappings]);

  return (
    <AppDrawer
      className="AppCreateImageDrawer"
      icon={IconNames.LAYOUT_BALLOON}
      title={t("Start from image")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={pending}
      submitIcon={IconNames.CUBE_ADD}
      submitTitle={t("Create and start")}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form id={formId} onSubmit={onSubmit} className={Classes.DIALOG_BODY}>
            <ConnectionSelect
              value={connectionId}
              onChange={setConnectionId}
              filter={lockToImageConnection}
              disabled={pending}
            />
            <HTMLTable compact striped className="AppDataTable">
              <tbody>
                <tr>
                  <td>{t("Name")}</td>
                  <td>{image.Name}</td>
                </tr>
                <tr>
                  <td>{t("Tag")}</td>
                  <td>{image.Tag}</td>
                </tr>
                <tr>
                  <td>{t("Registry")}</td>
                  <td>{image.Registry}</td>
                </tr>
              </tbody>
            </HTMLTable>
            <div className="AppDataForm">
              <FormGroup
                disabled={pending}
                label={t("Number of containers")}
                labelFor="amount"
                helperText={t(
                  "If launching more than one, port mappings will be adjusted by incrementing the host port.",
                )}
              >
                <Controller
                  control={control}
                  name="amount"
                  defaultValue={1}
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <NumericInput
                        required
                        fill
                        disabled={pending}
                        name={name}
                        inputRef={ref}
                        value={value}
                        onValueChange={onChange}
                        onBlur={onBlur}
                        className="AmountOfContainers"
                        allowNumericCharactersOnly
                        min={1}
                        max={65535}
                        stepSize={1}
                        minorStepSize={1}
                        data-invalid={invalid}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    );
                  }}
                />
              </FormGroup>
              <FormGroup
                disabled={pending}
                // biome-ignore lint/suspicious/noTemplateCurlyInString: Example string
                helperText={t("If not set, it will be automatically generated. Use ${index} to insert a counter.")}
                label={t("Container name")}
                labelFor="imageContainerName"
                labelInfo="(optional)"
              >
                <Controller
                  control={control}
                  name="imageContainerName"
                  defaultValue=""
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <InputGroup
                        disabled={pending}
                        name={name}
                        inputRef={ref}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        placeholder={t("Type to set a name")}
                        data-invalid={invalid}
                      />
                    );
                  }}
                />
              </FormGroup>
              <PortMappingsForm portMappings={mappings} disabled={pending} />
              <MountsForm mounts={mounts} disabled={pending} />
            </div>
            <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
            <ButtonGroup fill>
              <Button
                type="submit"
                disabled={pending}
                intent={Intent.PRIMARY}
                icon={IconNames.CUBE_ADD}
                title={t("Click to launch creation")}
                text={t("Create and start")}
              />
            </ButtonGroup>
          </form>
        </FormProvider>
      </div>
    </AppDrawer>
  );
};
