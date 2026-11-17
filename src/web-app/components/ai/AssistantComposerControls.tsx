import { Button, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import type { AIPermissionMode } from "@/mcp-server/core/permissions";
import { ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

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
  // The target the RUNNING session was started with. This chip used to say "Host" — hardcoded, in both the button
  // and its menu item — which is a target kind this app no longer has: execution is a container, either one already
  // running or a disposable sandbox, and the connection is how it is reached. A chip naming a kind that cannot exist
  // is worse than no chip, because it answers "where do my tools run?" with something untrue.
  const target = useCodingAgentStore((state) => state.spec?.executionTarget);
  // No session, or a session whose tools run in the agent container itself: there is no separate target to name.
  if (!target) return null;
  const label = target.kind === "sandbox" ? t("Sandbox") : t("Container");
  const detail =
    target.kind === "sandbox"
      ? t("Disposable sandbox from {{image}}", { image: target.image })
      : t("Container {{id}}", { id: target.containerId.slice(0, 12) });
  return (
    <PopoverNext
      usePortal
      placement="top-start"
      disabled={disabled}
      content={
        <Menu className="AIComposerCompactMenu">
          <MenuItem icon={IconNames.BOX} text={label} label={detail} active />
        </Menu>
      }
    >
      <Button
        className="AIComposerTool"
        variant="minimal"
        size="small"
        icon={IconNames.BOX}
        text={label}
        title={t("Execution target")}
        disabled={disabled}
      />
    </PopoverNext>
  );
}
