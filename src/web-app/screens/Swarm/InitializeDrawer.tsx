import {
  Button,
  ButtonGroup,
  Checkbox,
  Classes,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  NumericInput,
  ProgressBar,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { HostAddress } from "@/env/Types";
import { extractApiErrorText } from "@/utils/apiError";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect, isDockerConnection } from "@/web-app/components/ConnectionSelect";
import { Notification } from "@/web-app/Notification";

import { useSwarmAdvertiseCandidates, useSwarmInit } from "./queries";

// Sentinel option: "type my own address" (distinct from Auto = "" = let Docker decide).
const CUSTOM = "__custom__";

// Interfaces that make poor swarm advertise addresses (docker/compose/libvirt bridges, veth, tunnels, loopback)
// — sorted last so the primary physical NIC is the natural first choice.
const VIRTUAL_IFACE = /^(docker|br-|virbr|veth|cni|flannel|cali|kube|tun|tap|utun|lo\d*$)/i;
function sortAdvertiseCandidates(list: HostAddress[]): HostAddress[] {
  return [...list].sort((a, b) => (VIRTUAL_IFACE.test(a.iface) ? 1 : 0) - (VIRTUAL_IFACE.test(b.iface) ? 1 : 0));
}

interface InitializeFormData {
  listenHost: string;
  listenPort: number;
  advertiseChoice: string;
  advertiseCustom: string;
  forceNewCluster: boolean;
}

export interface InitializeDrawerProps {
  connectionId: string;
  onClose: () => void;
}

export const InitializeDrawer: React.FC<InitializeDrawerProps> = ({ connectionId, onClose }: InitializeDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const [pending, setPending] = useState(false);

  const candidatesQuery = useSwarmAdvertiseCandidates(connectionId);
  // Physical NICs first (bridges/virtual last) — advertising a swarm on docker0/br-*/virbr0 is a footgun.
  const candidates = useMemo(() => sortAdvertiseCandidates(candidatesQuery.data ?? []), [candidatesQuery.data]);

  const methods = useForm<InitializeFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      listenHost: "0.0.0.0",
      listenPort: 2377,
      advertiseChoice: "",
      advertiseCustom: "",
      forceNewCluster: false,
    },
  });
  const { control, handleSubmit, watch, setValue, getValues } = methods;
  const advertiseChoice = watch("advertiseChoice");

  // On a multi-NIC host "Auto" always fails ("could not choose an IP address to advertise"), so once the
  // candidate NICs load, default the picker to the first (physical) one instead of leaving it on Auto — once,
  // and only if the user hasn't already chosen, so it never fights a manual selection.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!autoSelectedRef.current && candidates.length > 1 && getValues("advertiseChoice") === "") {
      autoSelectedRef.current = true;
      setValue("advertiseChoice", candidates[0].address, { shouldValidate: true });
    }
  }, [candidates, getValues, setValue]);

  const swarmInit = useSwarmInit(connectionId);

  const onSubmit = handleSubmit(async (data) => {
    setPending(true);
    try {
      const listenHost = (data.listenHost || "").trim() || "0.0.0.0";
      const advertise = data.advertiseChoice === CUSTOM ? (data.advertiseCustom || "").trim() : data.advertiseChoice;
      await swarmInit.mutateAsync({
        ListenAddr: `${listenHost}:${data.listenPort || 2377}`,
        AdvertiseAddr: advertise || undefined,
        ForceNewCluster: !!data.forceNewCluster,
      });
      // No success toast: closing the drawer + the screen flipping to the populated Swarm view is the feedback.
      onClose();
    } catch (error: any) {
      // Keep the drawer open on failure so the user can pick an advertise address and retry.
      const reason = extractApiErrorText(error, t("Request failed"));
      const needsAdvertiseAddr = /advertise|multiple addresses|could not choose an ip/i.test(reason);
      Notification.show({
        intent: Intent.DANGER,
        message: needsAdvertiseAddr
          ? t("Could not initialize the Swarm — pick an advertise address (NIC) above and try again.")
          : t("Could not initialize the Swarm: {{reason}}", { reason }),
        detail: reason,
        timeout: 8000,
      });
    } finally {
      setPending(false);
    }
  });

  return (
    <AppDrawer
      icon={IconNames.LAYERS}
      title={t("Initialize Swarm")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={pending}
      submitIcon={IconNames.PLUS}
      submitTitle={t("Initialize Swarm")}
    >
      <div className={Classes.DRAWER_BODY}>
        <FormProvider {...methods}>
          <form id={formId} name="InitializeSwarmForm" className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
            <ConnectionSelect
              value={connectionId}
              onChange={() => {}}
              filter={isDockerConnection}
              disabled
              label={t("Docker engine")}
            />
            <div className="AppDataForm" data-form="swarm.initialize">
              <div className="AppDataFormFields">
                <FormGroup
                  disabled={pending}
                  label={<strong>{t("Listen host")}</strong>}
                  labelFor="listenHost"
                  labelInfo="*"
                  helperText={t("Address the manager binds on. 0.0.0.0 listens on every interface.")}
                >
                  <Controller
                    control={control}
                    name="listenHost"
                    rules={{ required: true }}
                    render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => (
                      <InputGroup
                        fill
                        disabled={pending}
                        id={name}
                        name={name}
                        placeholder="0.0.0.0"
                        value={value}
                        onBlur={onBlur}
                        onChange={onChange}
                        inputRef={ref}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    )}
                  />
                </FormGroup>
                <FormGroup
                  disabled={pending}
                  label={<strong>{t("Listen port")}</strong>}
                  labelFor="listenPort"
                  labelInfo="*"
                >
                  <Controller
                    control={control}
                    name="listenPort"
                    rules={{ required: true, min: 1, max: 65535 }}
                    render={({ field: { onChange, onBlur, value, ref }, fieldState: { invalid } }) => (
                      <NumericInput
                        fill
                        disabled={pending}
                        min={1}
                        max={65535}
                        clampValueOnBlur
                        value={value}
                        onValueChange={(num) => onChange(Number.isNaN(num) ? 0 : num)}
                        onBlur={onBlur}
                        inputRef={ref}
                        intent={invalid ? Intent.DANGER : Intent.NONE}
                      />
                    )}
                  />
                </FormGroup>
                <FormGroup
                  disabled={pending}
                  label={<strong>{t("Advertise address")}</strong>}
                  labelFor="advertiseChoice"
                  helperText={t(
                    "The address other nodes use to reach this manager. Required when the host has multiple interfaces.",
                  )}
                >
                  <Controller
                    control={control}
                    name="advertiseChoice"
                    render={({ field: { onChange, onBlur, value, name } }) => (
                      <HTMLSelect
                        fill
                        id={name}
                        name={name}
                        value={value}
                        onBlur={onBlur}
                        onChange={onChange}
                        disabled={pending}
                        title={t("Advertise address")}
                      >
                        <option value="">{t("Auto (let Docker decide)")}</option>
                        {candidates.map((candidate) => (
                          <option key={`${candidate.iface} ${candidate.address}`} value={candidate.address}>
                            {`${candidate.iface} — ${candidate.address}`}
                          </option>
                        ))}
                        <option value={CUSTOM}>{t("Custom address…")}</option>
                      </HTMLSelect>
                    )}
                  />
                </FormGroup>
                {advertiseChoice === CUSTOM ? (
                  <FormGroup disabled={pending} label={t("Custom advertise address")} labelFor="advertiseCustom">
                    <Controller
                      control={control}
                      name="advertiseCustom"
                      rules={{ required: true }}
                      render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => (
                        <InputGroup
                          fill
                          autoFocus
                          disabled={pending}
                          id={name}
                          name={name}
                          placeholder={t("e.g. 192.168.0.29")}
                          value={value}
                          onBlur={onBlur}
                          onChange={onChange}
                          inputRef={ref}
                          intent={invalid ? Intent.DANGER : Intent.NONE}
                        />
                      )}
                    />
                  </FormGroup>
                ) : null}
                <FormGroup
                  disabled={pending}
                  helperText={t("Recover a broken cluster from this node's state. Leave unchecked for a normal init.")}
                >
                  <Controller
                    control={control}
                    name="forceNewCluster"
                    render={({ field: { onChange, onBlur, value, name, ref } }) => (
                      <Checkbox
                        disabled={pending}
                        id={name}
                        name={name}
                        checked={value}
                        onBlur={onBlur}
                        onChange={onChange}
                        inputRef={ref}
                        label={t("Force new cluster")}
                      />
                    )}
                  />
                </FormGroup>
              </div>
            </div>
            <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
            <ButtonGroup fill>
              <Button
                type="submit"
                disabled={pending}
                intent={Intent.SUCCESS}
                icon={IconNames.PLUS}
                title={t("Click to initialize the Swarm")}
                text={t("Initialize Swarm")}
              />
            </ButtonGroup>
          </form>
        </FormProvider>
      </div>
    </AppDrawer>
  );
};
