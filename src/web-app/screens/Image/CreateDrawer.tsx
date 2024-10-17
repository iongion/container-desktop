import {
  Button,
  ButtonGroup,
  Classes,
  Divider,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLTable,
  InputGroup,
  Intent,
  NumericInput,
  ProgressBar,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useMemo, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

// project
import { useStoreActions } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";

// module
import type { ContainerImage, ContainerImagePortMapping } from "@/env/Types";
import { type MountFormContainerImageMount, MountsForm, createMount } from "./MountsForm";
import { PortMappingsForm, toPortMappings } from "./PortMappingsForm";

import "./CreateDrawer.css";

export interface CreateFormData {
  amount: number;
  imageContainerName: string;
  mounts: MountFormContainerImageMount[];
  mappings: ContainerImagePortMapping[];
}
export interface CreateDrawerProps {
  image: ContainerImage;
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ image, onClose }: CreateDrawerProps) => {
  const { t } = useTranslation();
  const containerCreate = useStoreActions((actions) => actions.container.containerCreate);
  const imageFetch = useStoreActions((actions) => actions.image.imageFetch);

  const [state, setState] = useState<{
    template?: ContainerImage;
    pending: boolean;
  }>({
    template: undefined,
    pending: true,
  });

  const { pending, template } = state;

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
      const creator = {
        Amount: data.amount,
        ImageId: image.Id,
        Name: data.imageContainerName,
        Start: true,
        Mounts: data.mounts.filter((it) => it.source && it.destination),
        PortMappings: data.mappings,
      };
      setState((prev) => ({ ...prev, pending: true }));
      const create = await containerCreate(creator);
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
        setState((prev) => ({ ...prev, pending: false }));
        onClose();
      } else {
        Notification.show({
          message: t("Unable to start container(s) from image"),
          intent: Intent.DANGER,
        });
      }
    } catch (error: any) {
      console.error("Unable to start container(s) from image", error);
      Notification.show({
        message: t("Unable to start container(s) from image"),
        intent: Intent.DANGER,
      });
      setState((prev) => ({ ...prev, pending: false }));
    }
  });

  const { Id } = image;

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const template = await imageFetch({ Id });
        setState({ template, pending: false });
      } catch (error: any) {
        console.error("Unable to load container image", error);
        Notification.show({
          message: t("Unable to load container image"),
          intent: Intent.DANGER,
        });
      }
    })();
  }, [t, imageFetch, Id]);

  // Change over time - form fields
  useEffect(() => {
    const next = { mounts, mappings };
    reset(next);
  }, [reset, mounts, mappings]);

  return (
    <Drawer
      className="AppDrawer AppCreateImageDrawer"
      icon={IconNames.LAYOUT_BALLOON}
      title={t("Start from image")}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onClose}
      isOpen
      hasBackdrop={false}
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} className={Classes.DRAWER_BODY}>
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
          <ButtonGroup fill>
            <Button
              type="submit"
              disabled={pending}
              intent={Intent.PRIMARY}
              icon={IconNames.CUBE_ADD}
              title={t("Click to launch creation")}
              text={t("Create and start")}
            />
            <Divider />

            <Controller
              control={control}
              name="amount"
              defaultValue={1}
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <NumericInput
                    required
                    disabled={pending}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onValueChange={onChange}
                    onBlur={onBlur}
                    className="AmountOfContainers"
                    title={t(
                      "Amount of containers to be launched. If launching more than one, port mappings will be adjusted by incrementing the host port.",
                    )}
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
          </ButtonGroup>
          <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
          <div className="AppDataForm">
            <FormGroup
              disabled={pending}
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
        </form>
      </FormProvider>
    </Drawer>
  );
};
