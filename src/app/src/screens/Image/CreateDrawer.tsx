import { useEffect, useState, useMemo } from "react";
import {
  ButtonGroup,
  Button,
  Intent,
  InputGroup,
  FormGroup,
  Drawer,
  DrawerSize,
  ProgressBar,
  Classes,
  HTMLTable
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useForm, FormProvider, Controller } from "react-hook-form";

// project
import { useStoreActions } from "../../domain/types";
import { Notification } from "../../Notification";

// module
import { MountsForm, MountFormContainerImageMount, createMount } from "./MountsForm";
import { toPortMappings, PortMappingsForm } from "./PortMappingsForm";
import { ContainerImage, ContainerImagePortMapping } from "../../Types.container-app";

export interface CreateFormData {
  imageContainerName: string;
  mounts: MountFormContainerImageMount[];
  mappings: ContainerImagePortMapping[];
}
export interface CreateDrawerProps {
  image: ContainerImage;
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ image, onClose }) => {
  const { t } = useTranslation();
  const containerCreate = useStoreActions((actions) => actions.container.containerCreate);
  const fetchOne = useStoreActions((actions) => actions.image.fetchOne);

  const [state, setState] = useState<{ template?: ContainerImage; pending: boolean }>({
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
      mounts,
      mappings
    }
  });
  const { reset, control, handleSubmit } = methods;
  const onSubmit = handleSubmit(async (data) => {
    try {
      const creator = {
        ImageId: image.Id,
        Name: data.imageContainerName,
        Start: true,
        Mounts: data.mounts.filter(it => it.source && it.destination),
        PortMappings: data.mappings,
      };
      setState((prev) => ({ ...prev, pending: true }));
      const create = await containerCreate(creator);
      if (create.created) {
        if (!create.started) {
          Notification.show({ message: t("Container has been created but could not start"), intent: Intent.WARNING });
        }
        setState((prev) => ({ ...prev, pending: false }));
        onClose();
      } else {
        Notification.show({ message: t("Unable to create container from image"), intent: Intent.DANGER });
      }
    } catch (error) {
      console.error("Unable to create container from image", error);
      Notification.show({ message: t("Unable to create container from image"), intent: Intent.DANGER });
      setState((prev) => ({ ...prev, pending: false }));
    }
  });

  const { Id } = image;

  // Initial load
  useEffect(() => {
    (async() => {
      try {
        const template = await fetchOne({ Id });
        setState({ template, pending: false });
      } catch (error) {
        console.error("Unable to load container image", error);
        Notification.show({ message: t("Unable to load container image"), intent: Intent.DANGER });
      }
    })();
  }, [t, fetchOne, Id]);

  // Change over time - form fields
  useEffect(() => {
    const next = ({ mounts, mappings });
    reset(next);
  }, [reset, mounts, mappings]);

  return (
    <Drawer
      className="AppDrawer"
      icon={IconNames.PLUS}
      title={t("Create and start a new container")}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onClose}
      isOpen
      hasBackdrop={false}
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit}>
          <div className={Classes.DRAWER_BODY}>
            <div className={Classes.DIALOG_BODY}>
              <HTMLTable condensed striped className="AppDataTable">
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
              </ButtonGroup>
              <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
              <div className="AppDataForm">
                <FormGroup
                  disabled={pending}
                  helperText={t("If not set, it will be automatically generated")}
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
            </div>
          </div>
        </form>
      </FormProvider>
    </Drawer>
  );
};
