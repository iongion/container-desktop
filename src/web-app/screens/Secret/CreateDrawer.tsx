import {
  Button,
  ButtonGroup,
  Classes,
  DrawerSize,
  FormGroup,
  InputGroup,
  Intent,
  ProgressBar,
  TextArea,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { memo, useId, useState } from "react";
import isEqual from "react-fast-compare";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect, isPodmanConnection } from "@/web-app/components/ConnectionSelect";
import { useCreateSecret } from "./queries";

// Secret drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ onClose }: CreateDrawerProps) => {
    const { t } = useTranslation();
    const formId = useId();
    const { control, handleSubmit } = useForm<{
      secretName: string;
      secretBody: string;
    }>();
    const [pending, setPending] = useState(false);
    const [connectionId, setConnectionId] = useState("");
    const secretCreate = useCreateSecret(connectionId);
    const onSubmit = handleSubmit(async (data) => {
      try {
        setPending(true);
        await secretCreate.mutateAsync({
          name: data.secretName,
          Secret: data.secretBody,
        });
        onClose();
      } catch (error: any) {
        console.error("Unable to create secret", error);
      } finally {
        setPending(false);
      }
    });
    const pendingIndicator = (
      <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
    );
    return (
      <AppDrawer
        icon={IconNames.PLUS}
        title={t("Create new secret")}
        size={DrawerSize.SMALL}
        onClose={onClose}
        formId={formId}
        submitting={pending}
      >
        <div className={Classes.DRAWER_BODY}>
          <form id={formId} className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <ConnectionSelect
              value={connectionId}
              onChange={setConnectionId}
              filter={isPodmanConnection}
              disabled={pending}
            />
            <div className="AppDataForm" data-form="secret.create">
              <FormGroup disabled={pending} label={t("Name")} labelFor="secretName" labelInfo="(required)">
                <Controller
                  control={control}
                  name="secretName"
                  rules={{ required: true }}
                  defaultValue=""
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <InputGroup
                        fill
                        autoFocus
                        disabled={pending}
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
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <TextArea
                        fill
                        autoFocus
                        disabled={pending}
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
            {pendingIndicator}
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
          </form>
        </div>
      </AppDrawer>
    );
  },
  (prev, next) => {
    return isEqual(prev, next);
  },
);
CreateDrawer.displayName = "CreateDrawer";
