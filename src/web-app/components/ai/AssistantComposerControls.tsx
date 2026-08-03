import { Button, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ACCESS_PROFILES, type AccessProfileId, accessProfile } from "@/ai-system/core/accessProfiles";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { type ReasoningLevel, reasoningCapability } from "@/ai-system/core/reasoning";
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

const PROFILE_ICON = {
  observe: IconNames.EYE_OPEN,
  workspace: IconNames.EDIT,
  operator: IconNames.WRENCH,
} as const satisfies Record<AccessProfileId, string>;

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  default: "Default reasoning",
  low: "Low reasoning",
  medium: "Medium reasoning",
  high: "High reasoning",
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

export function AccessProfileMenu(props: {
  value: AccessProfileId;
  onChange: (profile: AccessProfileId) => void;
  disabled?: boolean;
  control?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const { t } = useTranslation();
  const selected = accessProfile(props.value);
  return (
    <PopoverNext
      isOpen={props.control?.open}
      onInteraction={props.control?.onOpenChange}
      usePortal
      placement="top-start"
      disabled={props.disabled}
      content={
        <Menu className="AIComposerCompactMenu">
          {ACCESS_PROFILES.map((profile) => (
            <MenuItem
              key={profile.id}
              icon={PROFILE_ICON[profile.id]}
              text={t(profile.labelKey)}
              label={t(profile.descriptionKey)}
              active={profile.id === props.value}
              onClick={() => props.onChange(profile.id)}
            />
          ))}
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={PROFILE_ICON[props.value]}
        text={t(selected.labelKey)}
        title={t("Access profile")}
        disabled={props.disabled}
      />
    </PopoverNext>
  );
}

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

export function ReasoningLevelMenu(props: {
  providerId: string;
  model: string;
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  disabled?: boolean;
  control?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const { t } = useTranslation();
  const capability = reasoningCapability(props.providerId, props.model);
  const value = capability.levels.includes(props.value) ? props.value : "default";
  return (
    <PopoverNext
      isOpen={props.control?.open}
      onInteraction={props.control?.onOpenChange}
      usePortal
      placement="top-start"
      disabled={props.disabled}
      content={
        <Menu className="AIComposerCompactMenu">
          {capability.levels.map((level) => (
            <MenuItem
              key={level}
              icon={level === "default" ? IconNames.AUTOMATIC_UPDATES : IconNames.LIGHTBULB}
              text={t(REASONING_LABEL[level])}
              active={level === value}
              onClick={() => props.onChange(level)}
            />
          ))}
          {capability.kind === "none" ? (
            <MenuItem disabled text={t("This model exposes no reasoning control")} />
          ) : null}
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={value === "default" ? IconNames.AUTOMATIC_UPDATES : IconNames.LIGHTBULB}
        text={t(REASONING_LABEL[value])}
        title={t("Reasoning level")}
        disabled={props.disabled}
      />
    </PopoverNext>
  );
}
