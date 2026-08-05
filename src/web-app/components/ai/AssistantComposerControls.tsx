import { Button, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { useAppStore } from "@/web-app/stores/appStore";

const MODE_ICON = {
  ask: IconNames.HAND,
  remember: IconNames.HISTORY,
  allow: IconNames.UNLOCK,
} as const satisfies Record<AIPermissionMode, string>;

const MODE_LABEL: Record<AIPermissionMode, string> = {
  ask: "Always ask",
  remember: "Ask and remember",
  allow: "Always allow",
};

export const PermissionModeMenu: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const { t } = useTranslation();
  const mode: AIPermissionMode = useAppStore((state) => state.userSettings.ai?.permissionMode) ?? "ask";
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const [open, setOpen] = useState(false);

  const setMode = (next: AIPermissionMode) => {
    setOpen(false);
    const current = useAppStore.getState().userSettings.ai ?? DEFAULT_AI_SETTINGS;
    void setGlobalUserSettings({ ai: { ...current, permissionMode: next } });
  };

  return (
    <PopoverNext
      isOpen={open}
      onInteraction={setOpen}
      usePortal
      placement="top-start"
      disabled={disabled}
      content={
        <Menu className="AIComposerCompactMenu">
          <MenuItem
            icon={MODE_ICON.ask}
            text={t("Always ask")}
            label={t("Every gated call")}
            active={mode === "ask"}
            onClick={() => setMode("ask")}
          />
          <MenuItem
            icon={MODE_ICON.remember}
            text={t("Ask and remember")}
            label={t("Reuse scoped decisions")}
            active={mode === "remember"}
            onClick={() => setMode("remember")}
          />
          <ConfirmMenuItem
            icon={MODE_ICON.allow}
            text={t("Always allow")}
            intent={Intent.DANGER}
            title={t(
              "Runs every available gated operation with no prompt and no safety floor — only on a machine you fully trust.",
            )}
            onConfirm={() => setMode("allow")}
          />
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={MODE_ICON[mode]}
        text={t(MODE_LABEL[mode])}
        intent={mode === "allow" ? Intent.DANGER : Intent.NONE}
        title={t("Approval mode")}
        disabled={disabled}
      />
    </PopoverNext>
  );
};

export function ExecutionTargetMenu({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <PopoverNext
      usePortal
      placement="top-start"
      disabled={disabled}
      content={
        <Menu className="AIComposerCompactMenu">
          <MenuItem icon={IconNames.DESKTOP} text={t("Host")} label={t("Current execution target")} active />
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={IconNames.DESKTOP}
        text={t("Host")}
        title={t("Execution target")}
        disabled={disabled}
      />
    </PopoverNext>
  );
}
