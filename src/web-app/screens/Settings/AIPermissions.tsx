// Settings → AI permissions. The user-facing view of the broker-owned allow/reject record
// (a dedicated versioned file): lists scoped remembered Allowed / Rejected operations (revoke via ConfirmMenu),
// the storage path + reveal, and surfaces a corrupt-cache error (fail-closed). All
// writes go through the broker (window.AI.*) — the renderer only sends the intent.
import { Button, ButtonGroup, Callout, Intent, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type PermissionRule,
  type PermissionsList,
  type PermissionsSnapshot,
  permissionKey,
} from "@/ai-system/core/permissions";
import { Application } from "@/container-client/Application";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";

import "./AIPermissions.css";
import { createLogger } from "@/logger";

const logger = createLogger("web.settings");

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
      logger.error("Unable to read AI permissions", error);
    }
  }, [bridge]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRule = useCallback(
    async (list: PermissionsList, rule: PermissionRule) => {
      if (!bridge) {
        return;
      }
      setSnap(await bridge.removePermission(list, permissionKey(rule)));
    },
    [bridge],
  );

  const renderList = (list: PermissionsList, rules: PermissionRule[], emptyTitle: string, emptyHint: string) => (
    <div className="AIPermissionsListWrap">
      {rules.length === 0 ? (
        <div className="AIPermissionsEmpty">
          <div className="AIPermissionsEmptyTitle">{emptyTitle}</div>
          <div className="AIPermissionsEmptyHint">{emptyHint}</div>
        </div>
      ) : (
        <ul className="AIPermissionsList">
          {rules.map((rule) => (
            <li className="AIPermissionsRow" key={permissionKey(rule)}>
              <div className="AIPermissionsRule">
                <code className="AIPermissionsCommand">{rule.operation.id}</code>
                <span className="AIPermissionsScope">
                  {rule.subject.kind === "access-profile" ? t("Access") : t("Worker")}: {rule.subject.id}
                  {" · "}
                  {rule.targetId}
                </span>
              </div>
              <ConfirmMenu
                tag={rule}
                title={t("Revoke")}
                onConfirm={(r, confirmed) => confirmed && void removeRule(list, r as PermissionRule)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
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

      <div className="AIPermissionsGrid">
        <div className="AIPermissionsCol">
          <div className="AIPermissionsHeading">
            {t("Allow")}{" "}
            <Tag minimal round>
              {snap?.allowed.length ?? 0}
            </Tag>
          </div>
          {renderList(
            "allowed",
            snap?.allowed ?? [],
            t("No allowed commands yet."),
            t("Commands approved by the user will appear here."),
          )}
        </div>

        <div className="AIPermissionsCol">
          <div className="AIPermissionsHeading">
            {t("Reject")}{" "}
            <Tag minimal round>
              {snap?.blocked.length ?? 0}
            </Tag>
          </div>
          {renderList(
            "blocked",
            snap?.blocked ?? [],
            t("No rejected rules yet."),
            t("Commands rejected by the user will be blocked automatically."),
          )}
        </div>
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
