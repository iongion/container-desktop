import { Button, ButtonGroup, Callout, Classes, DrawerSize, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RegistryAuthInfo } from "@/container-client/types/registry";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";

// Registry sign-in — an AppDrawer (the app never uses modal Dialogs). Collects a username + password / access
// token for a specific registry on a specific engine. The caller runs `docker/podman login --password-stdin`,
// so the secret is piped to the engine over stdin and NEVER appears in argv, `ps`, or the Activity log; the
// engine stores it in its auth.json and the app keeps only the display-only auth (kind/account). The row picks
// the connection + registry, so the shared ConnectionSelect is shown locked to that engine.
export function RegistryLoginDialog({
  registry,
  connectionId,
  onClose,
  onSubmit,
}: {
  registry: string;
  connectionId: string;
  onClose: () => void;
  onSubmit: (auth: RegistryAuthInfo, secret: string) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  const canSubmit = username.trim().length > 0 && secret.length > 0;

  return (
    <AppDrawer
      className="RegistryLoginDrawer"
      icon={IconNames.LOG_IN}
      title={t("Sign in to a registry")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitIcon={IconNames.LOG_IN}
      submitTitle={t("Sign in")}
      submitDisabled={!canSubmit}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              onSubmit({ kind: "user", account: username.trim() }, secret);
            }
          }}
        >
          <ConnectionSelect value={connectionId} onChange={() => undefined} disabled />
          <div className="AppDataForm" data-form="registry.login">
            <FormGroup label={t("Registry")}>
              <InputGroup readOnly fill value={registry} leftIcon={IconNames.CUBE} />
            </FormGroup>
            <FormGroup label={t("Username")}>
              <InputGroup
                fill
                autoFocus
                value={username}
                placeholder={t("your-username")}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </FormGroup>
            <FormGroup
              label={t("Password or access token")}
              helperText={t("Use a personal access token, not your account password")}
            >
              <InputGroup
                fill
                type={reveal ? "text" : "password"}
                value={secret}
                onChange={(event) => setSecret(event.currentTarget.value)}
                rightElement={
                  <Button
                    variant="minimal"
                    icon={reveal ? IconNames.EYE_OFF : IconNames.EYE_OPEN}
                    title={reveal ? t("Hide") : t("Reveal")}
                    onClick={() => setReveal((prev) => !prev)}
                  />
                }
              />
            </FormGroup>
            <Callout intent={Intent.PRIMARY} icon={IconNames.SHIELD} className="RegistryLoginNote">
              {t(
                "Runs `login --password-stdin` — the token is piped in, never on the command line or in logs. The engine stores it in its auth.json; the app keeps nothing.",
              )}
            </Callout>
          </div>
          <ButtonGroup fill>
            <Button
              type="submit"
              intent={Intent.SUCCESS}
              icon={IconNames.LOG_IN}
              text={t("Sign in")}
              disabled={!canSubmit}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
}
