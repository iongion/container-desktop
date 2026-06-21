// Settings → AI permissions. The user-facing view of the broker-owned allow/reject record
// (a dedicated versioned file): lists the remembered Allowed / Blocked commands (revoke via ConfirmMenu),
// the Web search switch, the storage path + reveal, and surfaces a corrupt-cache error (fail-closed). All
// writes go through the broker (window.AI.*) — the renderer only sends the intent.
import { Button, ButtonGroup, Callout, HTMLSelect, Intent, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type AICommandRule, commandKey, type PermissionsList, type PermissionsSnapshot } from "@/ai-system/core";
import { Application } from "@/container-client/Application";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";

import "./AIPermissions.css";

export const AIPermissions: React.FC = () => {
  const { t } = useTranslation();
  const bridge: IAI | undefined = typeof window !== "undefined" ? window.AI : undefined;
  const [snap, setSnap] = useState<PermissionsSnapshot | null>(null);

  const load = useCallback(async () => {
    if (!bridge) {
      return;
    }
    try {
      setSnap(await bridge.listPermissions());
    } catch (error) {
      console.error("Unable to read AI permissions", error);
    }
  }, [bridge]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRule = useCallback(
    async (list: PermissionsList, rule: AICommandRule) => {
      if (!bridge) {
        return;
      }
      setSnap(await bridge.removePermission(list, commandKey(rule.program, rule.args)));
    },
    [bridge],
  );

  const setWeb = useCallback(
    async (verdict: "allow" | "block" | null) => {
      if (!bridge) {
        return;
      }
      setSnap(await bridge.setWebPermission(verdict));
    },
    [bridge],
  );

  const renderList = (list: PermissionsList, rules: AICommandRule[]) =>
    rules.length === 0 ? (
      <div className="AIPermissionsEmpty">{t("None yet")}</div>
    ) : (
      <ul className="AIPermissionsList">
        {rules.map((rule) => (
          <li className="AIPermissionsRow" key={commandKey(rule.program, rule.args)}>
            <code className="AIPermissionsCommand">
              {rule.program} {rule.args.join(" ")}
            </code>
            <ConfirmMenu
              tag={rule}
              title={t("Revoke")}
              onConfirm={(r, confirmed) => confirmed && void removeRule(list, r as AICommandRule)}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="AIPermissions" data-form="ai-permissions">
      {snap?.status === "error" ? (
        <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN}>
          {t(
            "Your saved AI permissions could not be read, so the assistant is asking before every command. Fix or reset the file below.",
          )}
        </Callout>
      ) : null}

      <div className="AIPermissionsSection">
        <div className="AIPermissionsHeading">{t("Web search")}</div>
        <HTMLSelect
          value={snap?.webSearch ?? ""}
          onChange={(e) => void setWeb((e.currentTarget.value || null) as "allow" | "block" | null)}
        >
          <option value="">{t("Ask each time")}</option>
          <option value="allow">{t("Always allow")}</option>
          <option value="block">{t("Always block")}</option>
        </HTMLSelect>
      </div>

      <div className="AIPermissionsSection">
        <div className="AIPermissionsHeading">
          {t("Allowed commands")} <Tag minimal>{snap?.allowed.length ?? 0}</Tag>
        </div>
        {renderList("allowed", snap?.allowed ?? [])}
      </div>

      <div className="AIPermissionsSection">
        <div className="AIPermissionsHeading">
          {t("Blocked commands")} <Tag minimal>{snap?.blocked.length ?? 0}</Tag>
        </div>
        {renderList("blocked", snap?.blocked ?? [])}
      </div>

      {snap?.path ? (
        <div className="AIPermissionsPath">
          <code title={snap.path}>{snap.path}</code>
          <ButtonGroup>
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.REFRESH}
              title={t("Refresh")}
              onClick={() => void load()}
            />
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.FOLDER_OPEN}
              text={t("Open")}
              title={t("Open storage folder")}
              onClick={() => Application.getInstance().openStorageFolder()}
            />
          </ButtonGroup>
        </div>
      ) : null}
    </div>
  );
};
