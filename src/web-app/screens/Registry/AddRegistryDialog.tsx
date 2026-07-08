import { Button, ButtonGroup, Classes, DrawerSize, FormGroup, InputGroup, Intent, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import type { AddedRegistry } from "./trustStore";

// Add a registry to a chosen connection's registries.conf — an AppDrawer (the app never uses modal Dialogs).
// Reuses the shared ConnectionSelect (the ONE connection picker for connection-dependent forms) so the target
// engine is chosen the same way as everywhere else. The caller projects it into registries.conf (podman) /
// daemon.json (docker) on submit.
export function AddRegistryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (connectionId: string, registry: AddedRegistry) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [connectionId, setConnectionId] = useState("");
  const [name, setName] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [mirrorOf, setMirrorOf] = useState("");
  const canSubmit = connectionId.length > 0 && name.trim().length > 0;

  return (
    <AppDrawer
      className="AddRegistryDrawer"
      icon={IconNames.PLUS}
      title={t("Add registry")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitIcon={IconNames.PLUS}
      submitTitle={t("Add registry")}
      submitDisabled={!canSubmit}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              onSubmit(connectionId, {
                name: name.trim(),
                tls: insecure ? "insecure" : "verify",
                mirrorOf: mirrorOf.trim() || undefined,
              });
            }
          }}
        >
          <ConnectionSelect value={connectionId} onChange={setConnectionId} />
          <div className="AppDataForm" data-form="registry.add">
            <FormGroup label={t("Registry host")} helperText={t("e.g. registry.corp.local:5000")}>
              <InputGroup
                fill
                autoFocus
                value={name}
                placeholder="registry.example.com"
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </FormGroup>
            <FormGroup label={t("Mirror of (optional)")}>
              <InputGroup
                fill
                value={mirrorOf}
                placeholder="docker.io"
                onChange={(event) => setMirrorOf(event.currentTarget.value)}
              />
            </FormGroup>
            <Switch
              checked={insecure}
              label={t("Insecure — skip TLS verification")}
              onChange={(event) => setInsecure(event.currentTarget.checked)}
            />
          </div>
          <ButtonGroup fill>
            <Button
              type="submit"
              intent={Intent.SUCCESS}
              icon={IconNames.PLUS}
              text={t("Add registry")}
              disabled={!canSubmit}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
}
