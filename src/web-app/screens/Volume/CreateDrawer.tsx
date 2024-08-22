/* eslint-disable jsx-a11y/no-autofocus */
import { Button, ButtonGroup, Classes, Drawer, DrawerSize, FormGroup, InputGroup, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { memo, useCallback, useState } from "react";
import isEqual from "react-fast-compare";
import { useTranslation } from "react-i18next";

// project
import { useStoreActions } from "@/web-app/domain/types";

// Volume drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ onClose }: CreateDrawerProps) => {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [type, setType] = useState("");
    const [driver, setDriver] = useState("");
    const [pending, setPending] = useState(false);
    const volumeCreate = useStoreActions((actions) => actions.volume.volumeCreate);
    const onCreateClick = useCallback(async () => {
      setPending(true);
      try {
        const creator = {};
        await volumeCreate(creator as any);
        setPending(false);
        onClose();
      } catch (error: any) {
        setPending(false);
        console.error("Unable to create volume", error);
      }
    }, [volumeCreate, onClose]);
    const onNameChange = useCallback((e) => {
      setName(e.currentTarget.value);
    }, []);
    const onTypeChange = useCallback((e) => {
      setType(e.currentTarget.value);
    }, []);
    const onDriverChange = useCallback((e) => {
      setDriver(e.currentTarget.value);
    }, []);
    const pendingIndicator = <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>;
    return (
      <Drawer className="AppDrawer" icon={IconNames.PLUS} title={t("Create new volume")} usePortal size={DrawerSize.SMALL} onClose={onClose} isOpen hasBackdrop={false}>
        <div className={Classes.DRAWER_BODY}>
          <div className={Classes.DIALOG_BODY}>
            <ButtonGroup fill>
              <Button disabled={pending} intent={Intent.PRIMARY} icon={IconNames.DATABASE} title={t("Click to launch creation")} text={t("Create")} onClick={onCreateClick} />
            </ButtonGroup>
            {pendingIndicator}
            <div className="AppDataForm">
              <FormGroup disabled={pending} helperText={t("If not set, it will be automatically generated")} label={t("Name")} labelFor="volumeName" labelInfo="(optional)">
                <InputGroup autoFocus disabled={pending} id="volumeName" placeholder={t("Type to set a name")} value={name} onInput={onNameChange} />
              </FormGroup>
              <FormGroup disabled={pending} label={t("Type")} labelFor="volumeType" labelInfo="(optional)">
                <InputGroup autoFocus disabled={pending} id="volumeType" placeholder={t("Type to set a type")} value={type} onInput={onTypeChange} />
              </FormGroup>
              <FormGroup disabled={pending} label={t("Device")} labelFor="volumeDevice" labelInfo="(optional)">
                <InputGroup autoFocus disabled={pending} id="volumeDevice" placeholder={t("Type to set a device")} value={driver} onInput={onDriverChange} />
              </FormGroup>
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

CreateDrawer.displayName = "CreateDrawer";
