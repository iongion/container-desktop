// The ONE avatar library UI — browse presets + custom uploads, upload a new face, remove a custom one. Hosted two
// ways with identical features: a manage drawer (from the Workers header) and a select popover (from the worker
// editor). `mode` only adds selection affordances in "select"; every other capability (upload, remove) is present
// in both. There is deliberately no separate/trimmed mini-picker.

import { Icon, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AVATAR_PRESETS } from "@/ai-system/core/avatarPresets";
import { MAX_AVATAR_NAME_CHARS } from "@/ai-system/core/limits";
import { createLogger } from "@/logger";
import { randomUUID } from "@/utils/randomUUID";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { downscaleToWebP } from "./avatarImage";
import { useAvatars, useRemoveAvatar, useSaveAvatar } from "./avatarQueries";
import { WorkerAvatar } from "./WorkerAvatar";
import "./AvatarLibrary.css";

const logger = createLogger("web.ai.avatars");

export interface AvatarLibraryProps {
  mode: "manage" | "select";
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function AvatarLibrary({ mode, selectedId, onSelect }: AvatarLibraryProps) {
  const { t } = useTranslation();
  const { data } = useAvatars();
  const customs = data ?? [];
  const saveAvatar = useSaveAvatar();
  const removeAvatar = useRemoveAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        setBusy(true);
        setError("");
        const dataUrl = await downscaleToWebP(file);
        const id = randomUUID();
        await saveAvatar.mutateAsync({
          id,
          name: file.name.slice(0, MAX_AVATAR_NAME_CHARS) || t("Avatar"),
          dataUrl,
          createdAt: Date.now(),
        });
        onSelect?.(id);
      } catch (err: any) {
        logger.error("Unable to add avatar", err);
        setError(err?.message ?? t("Unable to add avatar"));
      } finally {
        setBusy(false);
      }
    },
    [saveAvatar, onSelect, t],
  );

  const cellArt = (id: string, name: string) => (
    <>
      <span className="AvatarLibraryCellArt">
        <WorkerAvatar avatarId={id} name={name} customs={customs} size={52} />
      </span>
      <span className="AvatarLibraryCellName" title={name}>
        {name}
      </span>
    </>
  );

  // A non-interactive wrapper holds the selection target (a real <button> in select mode) and, for a custom face,
  // the remove ConfirmMenu as a SIBLING — never a button nested inside another button.
  const renderCell = (id: string, name: string, custom: boolean) => (
    <div
      key={id}
      className="AvatarLibraryCell"
      data-custom={custom ? "true" : undefined}
      data-selected={mode === "select" && selectedId === id ? "true" : undefined}
    >
      {mode === "select" && onSelect ? (
        <button type="button" className="AvatarLibraryCellSelect" onClick={() => onSelect(id)}>
          {cellArt(id, name)}
        </button>
      ) : (
        <span className="AvatarLibraryCellSelect">{cellArt(id, name)}</span>
      )}
      {custom ? (
        <span className="AvatarLibraryCellRemove">
          <ConfirmMenu
            tag={id}
            title={t("Remove avatar")}
            onConfirm={(tag, confirmed) => {
              if (confirmed) removeAvatar.mutate(tag as string);
            }}
          />
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="AvatarLibrary" data-mode={mode}>
      <div className="AvatarLibraryGrid">
        {AVATAR_PRESETS.map((preset) => renderCell(preset.id, preset.label, false))}
        {customs.map((avatar) => renderCell(avatar.id, avatar.name, true))}
        <button type="button" className="AvatarLibraryUpload" disabled={busy} onClick={() => fileRef.current?.click()}>
          <span className="AvatarLibraryUploadArt">
            {busy ? <Spinner size={20} /> : <Icon icon={IconNames.PLUS} />}
          </span>
          <span className="AvatarLibraryCellName">{t("Upload")}</span>
        </button>
      </div>
      {error ? <div className="AvatarLibraryError">{error}</div> : null}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}
