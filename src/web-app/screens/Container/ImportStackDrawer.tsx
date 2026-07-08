import {
  Button,
  ButtonGroup,
  Callout,
  Classes,
  DrawerSize,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  Radio,
  RadioGroup,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { memo, useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { loadComposeProject } from "@/container-client/compose";
import { detectPodPortConflicts } from "@/container-client/compose/translate";
import type { ComposeProjectModel } from "@/container-client/compose/types";
import { Environments } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { extractApiErrorText } from "@/utils/apiError";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import {
  ConnectionSelect,
  isComposeConnection,
  isDockerConnection,
  isPodmanConnection,
} from "@/web-app/components/ConnectionSelect";
import { CURRENT_ENVIRONMENT } from "@/web-app/Environment";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

import { useComposeUp } from "./composeQueries";
import "./ImportStackDrawer.css";

const logger = createLogger("web.stack");

// In development, pre-fill the bundled sample stack (support/image-builders/compose.yaml) so the whole
// compose import path can be exercised with one click — mirrors the Build Studio dev sample.
const DEV_SAMPLE = CURRENT_ENVIRONMENT === Environments.DEVELOPMENT;
const DEV_COMPOSE_PATH = "./support/image-builders/compose.yaml";

export interface ImportStackDrawerProps {
  connectionId: string;
  onConnectionChange: (id: string) => void;
  initialText?: string;
  onClose: () => void;
}

// Import (deploy) a compose file as native containers. A "stack" is just a compose-labelled container group,
// so once this deploys, the project shows up in the Containers list as a group — there is no separate stacks
// screen. This drawer is the one stack-specific write path (translate + libpod create); teardown lives on the
// group header in the Containers list.
export const ImportStackDrawer: React.FC<ImportStackDrawerProps> = memo(
  ({ connectionId, onConnectionChange, initialText, onClose }: ImportStackDrawerProps) => {
    const { t } = useTranslation();
    const formId = useId();
    const [filePath, setFilePath] = useState(DEV_SAMPLE && !initialText ? DEV_COMPOSE_PATH : "");
    const [projectName, setProjectName] = useState("");
    const [podMode, setPodMode] = useState(false);
    const [model, setModel] = useState<ComposeProjectModel | null>(null);
    const [parseError, setParseError] = useState("");
    const [pending, setPending] = useState(false);
    const composeUp = useComposeUp(connectionId);

    // Docker deploys by shelling `docker compose -f <file>` (it has no pods), so pod-mode is Podman-only.
    const connections = useAppStore((s) => s.connections);
    const isDocker = connections.some((c) => c.id === connectionId && isDockerConnection(c));
    const effectivePodMode = !isDocker && podMode;

    const parseFrom = useCallback(async (input: { path: string } | { text: string }, name: string) => {
      try {
        const loaded = await loadComposeProject({ ...input, projectName: name || undefined });
        setModel(loaded);
        setParseError("");
      } catch (error: any) {
        setModel(null);
        setParseError(error?.message ?? String(error));
      }
    }, []);

    // Seed the parse preview once: the AI generator's raw text ("Open in Stacks") wins; otherwise in
    // development pre-fill the bundled sample compose file so the import path is one click away.
    const [seeded, setSeeded] = useState(false);
    if (!seeded && (initialText || DEV_SAMPLE)) {
      setSeeded(true);
      if (initialText) {
        void parseFrom({ text: initialText }, projectName);
      } else {
        void parseFrom({ path: DEV_COMPOSE_PATH }, projectName);
      }
    }

    const browse = useCallback(async () => {
      const result = await Application.getInstance().openFileSelector({});
      const picked = result?.filePaths?.[0];
      if (result?.canceled || !picked) {
        return;
      }
      setFilePath(picked);
      await parseFrom({ path: picked }, projectName);
    }, [parseFrom, projectName]);

    const onFilePathChange = useCallback(
      (next: string) => {
        setFilePath(next);
        if (next) {
          void parseFrom({ path: next }, projectName);
        } else {
          setModel(null);
          setParseError("");
        }
      },
      [parseFrom, projectName],
    );

    const onNameChange = useCallback(
      (next: string) => {
        setProjectName(next);
        if (filePath) {
          void parseFrom({ path: filePath }, next);
        } else if (initialText) {
          void parseFrom({ text: initialText }, next);
        }
      },
      [filePath, initialText, parseFrom],
    );

    const onDeploy = useCallback(async () => {
      if (!model) {
        return;
      }
      // Guard the keyboard/header submit paths too — single-pod host-port collisions would fail the engine.
      if (effectivePodMode && detectPodPortConflicts(model).length > 0) {
        return;
      }
      setPending(true);
      try {
        // Docker shells `docker compose -f <file>` (it parses the file itself), so pass the source path;
        // Podman ignores `source` and deploys the parsed model via libpod.
        const summary = await composeUp.mutateAsync({
          model,
          options: { podMode: effectivePodMode },
          source: filePath ? { path: filePath } : undefined,
        });
        Notification.show({
          intent: Intent.SUCCESS,
          message: t("Stack {{name}} is up", { name: model.name }),
          detail: t("created {{c}} · recreated {{r}} · unchanged {{u}}", {
            c: summary.created.length,
            r: summary.recreated.length,
            u: summary.unchanged.length,
          }),
          timeout: 6000,
        });
        setPending(false);
        onClose();
      } catch (error: any) {
        setPending(false);
        // Surface the engine's real reason (e.g. the libpod {cause,message}) — not the bare
        // "Request failed with status code 500" that axios throws.
        const detail = extractApiErrorText(error, error?.message ?? String(error));
        logger.error("Unable to bring stack up", detail, error);
        // Show the engine's real reason in the toast itself (not just the Notification Center) — a bare
        // "Could not deploy the stack" is useless; the libpod cause is what the user needs.
        Notification.show({
          intent: Intent.DANGER,
          message: t("Could not deploy the stack: {{reason}}", { reason: detail }),
          detail,
          timeout: 8000,
        });
      }
    }, [model, onClose, effectivePodMode, filePath, composeUp, t]);

    // Single-pod pre-flight: two services can't publish the same host port in one shared-netns pod — the
    // engine's pod create would fail, so surface the collision and block Import before that happens.
    const podConflicts = effectivePodMode && model ? detectPodPortConflicts(model) : [];

    return (
      <AppDrawer
        className="ImportStackDrawer"
        icon={IconNames.IMPORT}
        title={t("Import stack")}
        size={DrawerSize.SMALL}
        onClose={onClose}
        formId={formId}
        submitting={pending}
        submitDisabled={!model || podConflicts.length > 0}
        submitIcon={IconNames.IMPORT}
        submitTitle={t("Import the stack")}
      >
        <div className={Classes.DRAWER_BODY}>
          <form
            id={formId}
            className={Classes.DIALOG_BODY}
            onSubmit={(e) => {
              e.preventDefault();
              onDeploy();
            }}
          >
            <ConnectionSelect
              value={connectionId}
              onChange={onConnectionChange}
              filter={initialText ? isPodmanConnection : isComposeConnection}
              disabled={pending}
              label={t(initialText ? "Podman engine" : "Container engine")}
            />
            <div className="AppDataForm">
              {!initialText && (
                <FormGroup label={t("Compose file")} labelFor="composeFile">
                  <InputGroup
                    id="composeFile"
                    fill
                    value={filePath}
                    placeholder={t("Select a docker-compose.yml")}
                    disabled={pending}
                    onValueChange={onFilePathChange}
                    rightElement={
                      <Button
                        variant="minimal"
                        icon={IconNames.DOCUMENT_OPEN}
                        title={t("Choose a compose file")}
                        onClick={browse}
                        disabled={pending}
                      />
                    }
                  />
                </FormGroup>
              )}
              <FormGroup
                label={t("Project name")}
                labelInfo="(optional)"
                helperText={t("Defaults to the compose file directory name")}
              >
                <InputGroup
                  value={projectName}
                  placeholder={t("Type to override the project name")}
                  onValueChange={onNameChange}
                  disabled={pending}
                />
              </FormGroup>
              {!isDocker && (
                <FormGroup label={t("Networking")}>
                  <RadioGroup
                    selectedValue={podMode ? "pod" : "parity"}
                    onChange={(e) => setPodMode(e.currentTarget.value === "pod")}
                    disabled={pending}
                  >
                    <Radio value="parity" label={t("Compose parity — shared network, DNS by service name")} />
                    <Radio value="pod" label={t("Single pod — services talk over localhost")} />
                  </RadioGroup>
                </FormGroup>
              )}
              {podConflicts.length ? (
                <Callout intent={Intent.DANGER} title={t("Port conflicts prevent single-pod mode")}>
                  <ul className="StackPodConflicts">
                    {podConflicts.map((conflict) => (
                      <li key={conflict}>{conflict}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
              {parseError ? (
                <Callout intent={Intent.DANGER} title={t("Could not parse the compose file")}>
                  {parseError}
                </Callout>
              ) : null}
              {model ? (
                <Callout intent={Intent.NONE} className="StackPreview">
                  <div className="StackPreviewHeader">
                    <Icon icon={IconNames.DIAGRAM_TREE} size={14} />
                    <span className="StackPreviewName">{model.name}</span>
                  </div>
                  <div className="StackPreviewServices">
                    {model.services.map((s) => (
                      <span key={s.name} className="StackPreviewService">
                        {s.name}
                      </span>
                    ))}
                  </div>
                  {model.unsupported.length ? (
                    <p className="StackPreviewWarnings">
                      {t("Unsupported keys (ignored): {{keys}}", {
                        keys: model.unsupported.map((u) => u.path).join(", "),
                      })}
                    </p>
                  ) : null}
                </Callout>
              ) : null}
            </div>
            <ButtonGroup fill>
              <Button
                type="submit"
                disabled={pending || !model || podConflicts.length > 0}
                intent={Intent.SUCCESS}
                icon={IconNames.IMPORT}
                title={t("Import the stack")}
                text={t("Import")}
              />
            </ButtonGroup>
          </form>
        </div>
      </AppDrawer>
    );
  },
);

ImportStackDrawer.displayName = "ImportStackDrawer";
