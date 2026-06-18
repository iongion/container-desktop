import {
  Button,
  ButtonGroup,
  Classes,
  DrawerSize,
  FormGroup,
  InputGroup,
  Intent,
  NumericInput,
  ProgressBar,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect, isPodmanConnection } from "@/web-app/components/ConnectionSelect";
import { FormLayout } from "@/web-app/components/FormLayout";
import { useCreateMachine } from "./queries";

// Machine drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose }: CreateDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const machineCreate = useCreateMachine(connectionId);
  const onDrawerClose = useCallback(() => {
    onClose();
  }, [onClose]);
  const { control, handleSubmit } = useForm<{
    machineName: string;
    machineCPUs: number;
    machineRAMSize: number;
    machineDiskSize: number;
  }>();
  const onSubmit = handleSubmit(async (data) => {
    try {
      setPending(true);
      const creator = {
        name: data.machineName,
        cpus: data.machineCPUs,
        ramSize: data.machineRAMSize,
        diskSize: data.machineDiskSize,
      };
      await machineCreate.mutateAsync(creator);
      onClose();
    } catch (error: any) {
      console.error("Unable to create machine", error);
    } finally {
      setPending(false);
    }
  });
  const pendingIndicator = (
    <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
  );
  return (
    <AppDrawer
      title={t("Create new machine")}
      icon={IconNames.PLUS}
      size={DrawerSize.SMALL}
      onClose={onDrawerClose}
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
          <div className="AppDataForm" data-form="machine.create">
            <FormGroup disabled={pending} label={t("Name")} labelFor="machineName">
              <Controller
                control={control}
                name="machineName"
                rules={{ required: true }}
                defaultValue=""
                render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                  return (
                    <InputGroup
                      fill
                      autoFocus
                      disabled={pending}
                      id={name}
                      className="machineName"
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
            <FormLayout>
              <FormGroup disabled={pending} label={t("CPUs")} labelFor="machineCPUs">
                <Controller
                  control={control}
                  name="machineCPUs"
                  rules={{ required: true }}
                  defaultValue={1}
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <NumericInput
                        fill
                        autoFocus
                        disabled={pending}
                        id={name}
                        name={name}
                        value={value}
                        allowNumericCharactersOnly
                        min={1}
                        stepSize={1}
                        minorStepSize={1}
                        required
                        onBlur={onBlur}
                        onValueChange={onChange}
                        inputRef={ref}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    );
                  }}
                />
              </FormGroup>
              <FormGroup disabled={pending} label={t("RAM size")} labelFor="machineRAMSize">
                <Controller
                  control={control}
                  name="machineRAMSize"
                  rules={{ required: true }}
                  defaultValue={2048}
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <NumericInput
                        fill
                        autoFocus
                        disabled={pending}
                        id={name}
                        name={name}
                        value={value}
                        allowNumericCharactersOnly
                        min={1}
                        stepSize={1}
                        minorStepSize={1}
                        rightElement={<div className="AppFormFieldMeasureUnit">{t("MB")}</div>}
                        required
                        onBlur={onBlur}
                        onValueChange={onChange}
                        inputRef={ref}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    );
                  }}
                />
              </FormGroup>
              <FormGroup disabled={pending} label={t("Disk size")} labelFor="machineDiskSize">
                <Controller
                  control={control}
                  name="machineDiskSize"
                  rules={{ required: true }}
                  defaultValue={10}
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                    return (
                      <NumericInput
                        fill
                        autoFocus
                        disabled={pending}
                        id={name}
                        name={name}
                        value={value}
                        allowNumericCharactersOnly
                        min={1}
                        stepSize={1}
                        minorStepSize={1}
                        rightElement={<div className="AppFormFieldMeasureUnit">{t("GB")}</div>}
                        required
                        onBlur={onBlur}
                        onValueChange={onChange}
                        inputRef={ref}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    );
                  }}
                />
              </FormGroup>
            </FormLayout>
          </div>
          {pendingIndicator}
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
        </form>
      </div>
    </AppDrawer>
  );
};
