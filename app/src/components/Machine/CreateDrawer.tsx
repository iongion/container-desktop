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
  NumericInput
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import isEqual from "react-fast-compare";

// project
import { FormLayout } from "../FormLayout";

import { useStoreActions } from "./Model";

// Machine drawer
export interface CreateDrawerProps {
  onClose: () => void;
}
export const CreateDrawer: React.FC<CreateDrawerProps> = memo(
  ({ onClose }) => {
    const { t } = useTranslation();
    const [pending, setPending] = useState(false);
    const machineCreate = useStoreActions((actions) => actions.machineCreate);
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
          diskSize: data.machineDiskSize
        };
        await machineCreate(creator);
        onClose();
      } catch (error) {
        console.error("Unable to create machine", error);
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
        title={t("Create new machine")}
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
                icon={IconNames.HEAT_GRID}
                title={t("Click to launch creation")}
                text={t("Create")}
                type="submit"
              />
            </ButtonGroup>
            {pendingIndicator}
            <div className="AppDataForm" data-form="machine.create">
              <FormGroup disabled={pending} label={t("Name")} labelFor="machineName">
                <Controller
                  control={control}
                  name="machineName"
                  rules={{ required: true }}
                  defaultValue=""
                  render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                    return (
                      <InputGroup
                        fill
                        autoFocus
                        disabled={pending || formState.isSubmitting || formState.isValidating}
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
                    render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                      return (
                        <NumericInput
                          fill
                          autoFocus
                          disabled={pending || formState.isSubmitting || formState.isValidating}
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
                    render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                      return (
                        <NumericInput
                          fill
                          autoFocus
                          disabled={pending || formState.isSubmitting || formState.isValidating}
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
                    render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid }, formState }) => {
                      return (
                        <NumericInput
                          fill
                          autoFocus
                          disabled={pending || formState.isSubmitting || formState.isValidating}
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
          </form>
        </div>
      </Drawer>
    );
  },
  (prev, next) => {
    return isEqual(prev, next);
  }
);
