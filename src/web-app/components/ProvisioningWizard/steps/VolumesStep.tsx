import { AnchorButton, Button, Callout, HTMLSelect, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { resolveMountDecision } from "@/container-provisioning/decisionTable";
import {
  addFolderChoice,
  type FolderChoice,
  folderDisplayName,
  resolveVolumeSpecs,
  usernsFlag,
  volumePreview,
} from "@/container-provisioning/volumes";
import type { ContainerEngine, OperatingSystem } from "@/env/Types";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

function safeDecision(os: OperatingSystem, engine: ContainerEngine) {
  try {
    return resolveMountDecision(os, engine);
  } catch {
    return undefined;
  }
}

// Step 4 — the make-or-break step. Pick host folders to share; the wizard resolves the correct mount type
// + UID/GID strategy automatically (decision table) and previews the exact `-v` flags. Permissions "just
// work" with zero manual chown.
export function VolumesStep() {
  const { t } = useTranslation();
  const engine = useProvisioningStore((s) => s.target?.engine);
  const os = useProvisioningStore((s) => s.detection?.osType);
  const [folders, setFolders] = useState<FolderChoice[]>([{ hostPath: "~", mode: "rw" }]);

  const decision = engine && os ? safeDecision(os, engine) : undefined;

  // Keep the stored volume specs in sync with the folder choices. Depend on the stable engine/os primitives
  // (NOT the target object patchTarget rewrites) so writing volumes back doesn't retrigger this effect.
  useEffect(() => {
    if (engine && os && safeDecision(os, engine)) {
      useProvisioningStore.getState().patchTarget({ volumes: resolveVolumeSpecs(os, engine, folders) });
    }
  }, [folders, engine, os]);

  if (!engine || !os || !decision) {
    return null;
  }

  const specs = resolveVolumeSpecs(os, engine, folders);
  const flag = usernsFlag(decision.idStrategy);

  const addFolder = async () => {
    const result = await Application.getInstance().openFileSelector({ directory: true });
    const path = result?.filePaths?.[0];
    if (path) {
      setFolders((current) => addFolderChoice(current, path));
    }
  };
  const removeFolder = (index: number) => setFolders((current) => current.filter((_, i) => i !== index));
  const setMode = (index: number, mode: "rw" | "ro") =>
    setFolders((current) => current.map((folder, i) => (i === index ? { ...folder, mode } : folder)));

  return (
    <div className="PWizVolumes">
      <ul className="PWizFolderList">
        {folders.map((folder, index) => (
          <li key={folder.hostPath} className="PWizFolder">
            <Icon icon={IconNames.FOLDER_CLOSE} color="var(--app-text-muted)" />
            <span className="PWizFolderPath" title={folder.hostPath}>
              {folderDisplayName(folder.hostPath)}
            </span>
            <HTMLSelect
              className="PWizFolderMode"
              value={folder.mode}
              onChange={(e) => setMode(index, e.currentTarget.value as "rw" | "ro")}
            >
              <option value="rw">{t("Read / write")}</option>
              <option value="ro">{t("Read-only")}</option>
            </HTMLSelect>
            <code className="PWizFolderPreview">{volumePreview(specs[index])}</code>
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.CROSS}
              onClick={() => removeFolder(index)}
              disabled={folders.length === 1}
              aria-label={t("Remove folder")}
            />
          </li>
        ))}
      </ul>
      <AnchorButton variant="minimal" icon={IconNames.FOLDER_NEW} text={t("Add folder…")} onClick={addFolder} />

      <Callout intent="success" icon={IconNames.ENDORSED} title={t("Permissions handled for you")}>
        {t("Files you edit on the host stay owned by you inside the container — no manual chown.")}
        {flag ? (
          <div className="PWizVolFlag">
            {t("Applied automatically:")} <code>{flag}</code>
          </div>
        ) : null}
      </Callout>

      {decision.warn ? (
        <Callout intent="warning" icon={IconNames.WARNING_SIGN}>
          {t(decision.warn)}
        </Callout>
      ) : null}
    </div>
  );
}
