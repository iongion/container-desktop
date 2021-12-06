import { useCallback, useEffect, useState, memo } from "react";
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
  HTMLTable,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import isEqual from "react-fast-compare";

// project
import { useStoreActions } from "../../Domain";
import { ContainerImage, ContainerImagePortMapping } from "../../Types";

import { MountsForm, MountFormContainerImageMount, createMount } from "./MountsForm";
import { PortMappingsForm } from "./PortMappingsForm";

export const toPortMappings = (exposed: { [key: string]: number }) => {
  const mappings: ContainerImagePortMapping[] = Object.keys(exposed).map((key) => {
    const [container_port_raw, protocol] = key.split("/");
    const container_port = Number(container_port_raw);
    const host_port = container_port < 1000 ? 8000 + container_port : container_port;
    return {
      container_port: Number(container_port),
      host_ip: "127.0.0.1",
      host_port: host_port,
      protocol: protocol as any
    };
  });
  return mappings;
};

export interface CreateDrawerProps {
  image: ContainerImage;
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ image, onClose }) => {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);
    const [template, setTemplate] = useState<ContainerImage>();
    const [portMappings, setPortMappings] = useState<ContainerImagePortMapping[]>(
      toPortMappings(template?.Config?.ExposedPorts || {})
    );
    const [mounts, setMounts] = useState<MountFormContainerImageMount[]>([createMount()]);
    const { Id } = image;
    const containerCreate = useStoreActions((actions) => actions.containerCreate);
    const imageFetch = useStoreActions((actions) => actions.imageFetch);
    const onCreateClick = useCallback(async () => {
      setPending(true);
      try {
        const creator = {
          ImageId: image.Id,
          Name: name,
          Start: true,
          Mounts: mounts,
          PortMappings: portMappings
        };
        await containerCreate(creator);
        setPending(false);
        onClose();
      } catch (error) {
        setPending(false);
        console.error("Unable to create container from image", error);
      }
    }, [image, name, portMappings, mounts, containerCreate, onClose]);
    const onNameChange = useCallback((e) => {
      setName(e.currentTarget.value);
    }, []);
    const onPortMappingsChange = useCallback((e) => {
      setPortMappings(e);
    }, []);
    const onMountsChange = useCallback((e) => {
      setMounts(e);
    }, []);
    const pendingIndicator = (
      <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
    );
    useEffect(() => {
      setPending(true);
      imageFetch({ Id })
        .then((template: ContainerImage) => {
          setTemplate(template);
          setPortMappings(toPortMappings(template?.Config?.ExposedPorts || {}));
        })
        .finally(() => {
          setPending(false);
        });
    }, [imageFetch, Id]);
    return (
      <Drawer
        className="AppDrawer"
        icon={IconNames.PLUS}
        title={t("Start a new container")}
        usePortal
        size={DrawerSize.SMALL}
        onClose={onClose}
        isOpen
        hasBackdrop={false}
      >
        <div className={Classes.DRAWER_BODY}>
          <div className={Classes.DIALOG_BODY}>
            <HTMLTable condensed striped small className="AppDataTable">
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
                disabled={pending}
                intent={Intent.PRIMARY}
                icon={IconNames.CUBE_ADD}
                title={t("Click to launch creation")}
                text={t("Create")}
                onClick={onCreateClick}
              />
            </ButtonGroup>
            {pendingIndicator}
            <div className="AppDataForm">
              <FormGroup
                disabled={pending}
                helperText={t("If not set, it will be automatically generated")}
                label={t("Container name")}
                labelFor="imageContainerName"
                labelInfo="(optional)"
              >
                <InputGroup
                  disabled={pending}
                  id="imageContainerName"
                  placeholder={t("Type to set a name")}
                  value={name}
                  onInput={onNameChange}
                />
              </FormGroup>
              <PortMappingsForm portMappings={portMappings} onChange={onPortMappingsChange} />
              <MountsForm mounts={mounts} onChange={onMountsChange} />
            </div>
          </div>
        </div>
      </Drawer>
    );
  },
  (prev, next) => {
    return isEqual(prev, next);
  }
);
