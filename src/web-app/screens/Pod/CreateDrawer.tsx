import {
  Button,
  ButtonGroup,
  Classes,
  Drawer,
  DrawerSize,
  FormGroup,
  InputGroup,
  Intent,
  ProgressBar,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useStoreActions } from "@/web-app/domain/types";

// Pod drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose }: CreateDrawerProps) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const podCreate = useStoreActions((actions) => actions.pod.podCreate);
  const onDrawerClose = useCallback(
    (e) => {
      onClose();
    },
    [onClose],
  );
  const { control, handleSubmit } = useForm<{
    podName: string;
  }>();
  const onSubmit = handleSubmit(async (data) => {
    try {
      setPending(true);
      const creator = {
        Name: data.podName,
      };
      await podCreate(creator);
      onClose();
    } catch (error: any) {
      console.error("Unable to create pod", error);
    } finally {
      setPending(false);
    }
  });
  const pendingIndicator = (
    <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
  );
  return (
    <Drawer
      className="AppDrawer"
      title={t("Create new pod")}
      icon={IconNames.PLUS}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onDrawerClose}
      isOpen
      hasBackdrop={false}
    >
      <div className={Classes.DRAWER_BODY}>
        <form className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
          <ButtonGroup fill>
            <Button
              disabled={pending}
              intent={Intent.PRIMARY}
              icon={IconNames.HEAT_GRID}
              title={t("Click to launch creation")}
              text={t("Create")}
              type="submit"
            />
          </ButtonGroup>
          {pendingIndicator}
          <div className="AppDataForm" data-form="pod.create">
            <FormGroup disabled={pending} label={t("Name")} labelFor="podName">
              <Controller
                control={control}
                name="podName"
                rules={{ required: true }}
                defaultValue=""
                render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                  return (
                    <InputGroup
                      fill
                      autoFocus
                      disabled={pending}
                      id={name}
                      className="podName"
                      placeholder={t("Type to set a name")}
                      name={name}
                      value={value}
                      required
                      onBlur={onBlur}
                      onChange={onChange}
                      inputRef={ref}
                      intent={invalid ? Intent.DANGER : Intent.NONE}
                    />
                  );
                }}
              />
            </FormGroup>
          </div>
        </form>
      </div>
    </Drawer>
  );
};
