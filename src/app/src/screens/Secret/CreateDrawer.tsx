import { useState, memo } from "react";
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
  TextArea
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import isEqual from "react-fast-compare";

// project
import { useStoreActions } from "../../domain/types";

// Secret drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ onClose }) => {
    const { t } = useTranslation();
    const { control, handleSubmit } = useForm<{
      secretName: string;
      secretBody: string;
    }>();
    const [pending, setPending] = useState(false);
    const secretCreate = useStoreActions((actions) => actions.secret.secretCreate);
    const onSubmit = handleSubmit(async (data) => {
      try {
        setPending(true);
        await secretCreate({
          name: data.secretName,
          Secret: data.secretBody
        });
        onClose();
      } catch (error) {
        console.error("Unable to create secret", error);
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
        icon={IconNames.PLUS}
        title={t("Create new secret")}
        usePortal
        size={DrawerSize.SMALL}
        onClose={onClose}
        isOpen
        hasBackdrop={false}
      >
        <div className={Classes.DRAWER_BODY}>
          <form className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <ButtonGroup fill>
              <Button
                disabled={pending}
                intent={Intent.PRIMARY}
                icon={IconNames.KEY}
                title={t("Click to launch creation")}
                text={t("Create")}
                type="submit"
              />
            </ButtonGroup>
            {pendingIndicator}
            <div className="AppDataForm" data-form="secret.create">
              <FormGroup disabled={pending} label={t("Name")} labelFor="secretName" labelInfo="(required)">
                <Controller
                  control={control}
                  name="secretName"
                  rules={{ required: true }}
                  defaultValue=""
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                    return (
                      <InputGroup
                        fill
                        autoFocus
                        disabled={pending || formState.isSubmitting || formState.isValidating}
                        id={name}
                        className="secretName"
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
              <FormGroup disabled={pending} label={t("Body")} labelFor="secretBody" labelInfo="(required)">
                <Controller
                  control={control}
                  name="secretBody"
                  rules={{ required: true }}
                  defaultValue=""
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                    return (
                      <TextArea
                        fill
                        autoFocus
                        disabled={pending || formState.isSubmitting || formState.isValidating}
                        id={name}
                        className="secretBody"
                        placeholder={t("Type to set a body")}
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
  },
  (prev, next) => {
    return isEqual(prev, next);
  }
);
