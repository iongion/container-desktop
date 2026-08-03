import {
  Button,
  ButtonGroup,
  Callout,
  Classes,
  DrawerSize,
  FormGroup,
  InputGroup,
  Intent,
  ProgressBar,
  Tag,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { parsePluginSource } from "@/ai-system/core/pluginCatalog";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { usePluginStore } from "@/web-app/stores/pluginStore";

import "./PluginsScreen.css";

export interface InstallDrawerProps {
  onClose: () => void;
}

export const InstallDrawer: React.FC<InstallDrawerProps> = ({ onClose }: InstallDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const [source, setSource] = useState("");
  const busy = usePluginStore((state) => state.busy);
  const progress = usePluginStore((state) => state.progress);
  const install = usePluginStore((state) => state.install);
  const parsed = useMemo(() => parsePluginSource(source), [source]);
  const valid = parsed.kind !== "invalid";

  const onInstallClick = useCallback(async () => {
    await install(source, "user");
    // The store keeps the failure on screen; only a clean install closes the drawer.
    if (!usePluginStore.getState().error) onClose();
  }, [install, onClose, source]);

  return (
    <AppDrawer
      className="AppInstallPluginDrawer"
      icon={IconNames.CUBE_ADD}
      title={t("Install a plugin")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={busy}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(e) => {
            e.preventDefault();
            void onInstallClick();
          }}
        >
          <div className="AppDataForm">
            <FormGroup
              disabled={busy}
              helperText={t("An npm package (npm:@scope/name@version) or a git repository (git:host/user/repo@ref)")}
              label={t("Source")}
              labelFor="pluginSource"
            >
              <InputGroup
                autoFocus
                disabled={busy}
                id="pluginSource"
                placeholder="npm:@scope/name"
                value={source}
                onInput={(e) => setSource(e.currentTarget.value)}
              />
            </FormGroup>
            {source ? (
              <div className="PluginSourcePreview" data-valid={valid ? "true" : "false"}>
                {valid ? (
                  <>
                    <Tag minimal>{parsed.kind}</Tag>
                    <span className="PluginSourceName">{parsed.name}</span>
                    {parsed.version ? <Tag minimal>{parsed.version}</Tag> : null}
                  </>
                ) : (
                  <span className="PluginSourceProblem">{parsed.reason}</span>
                )}
              </div>
            ) : null}
          </div>
          {/* The containment is the feature, so it is stated rather than softened into a generic prompt. */}
          <Callout intent={Intent.WARNING} icon={IconNames.SHIELD} className="PluginInstallNotice">
            {t(
              "This runs third-party code inside the agent container, with the workspace mounted. Install only sources you trust.",
            )}
          </Callout>
          <div className="AppDrawerPendingIndicator">
            {busy && <ProgressBar intent={Intent.SUCCESS} />}
            {progress ? <span className="PluginProgressLine">{progress.message}</span> : null}
          </div>
          <ButtonGroup fill>
            <Button
              type="submit"
              disabled={busy || !valid}
              intent={Intent.SUCCESS}
              icon={IconNames.CUBE_ADD}
              title={valid ? t("Install {{source}}", { source }) : t("Enter a valid plugin source")}
              text={t("Install")}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
};
