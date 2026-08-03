import { Button, Callout, Classes, Icon, Intent, Spinner, Switch, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { SkillDiagnostic, SkillHostSnapshot, SkillViewDescriptor } from "@/ai-system/core/skills";
import { AppDrawer } from "@/web-app/components/AppDrawer";

import "./AssistantSkillsDrawer.css";

interface AssistantSkillsDrawerProps {
  snapshot: SkillHostSnapshot;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onReload: () => Promise<unknown>;
  onSetProjectSourceEnabled: (enabled: boolean) => Promise<unknown>;
  onSetProjectSkillTrust: (skillId: string, fingerprint: string, trusted: boolean) => Promise<unknown>;
}

const DIAGNOSTIC_LABEL: Record<SkillDiagnostic["code"], string> = {
  "file-too-large": "File exceeds the skill size limit",
  "frontmatter-missing": "YAML frontmatter is missing",
  "frontmatter-too-large": "YAML frontmatter is too large",
  "frontmatter-invalid": "YAML frontmatter is invalid",
  "field-missing": "A required field is missing",
  "field-invalid": "A field is invalid",
  "field-unsupported": "The skill requests unsupported authority",
  "name-invalid": "The skill name is invalid",
  "name-mismatch": "The folder and skill names do not match",
  "text-unsafe": "Text contains unsafe control characters",
  "encoding-invalid": "The skill file is not valid UTF-8",
  "list-too-large": "A skill list exceeds its limit",
  "tool-unknown": "The skill names an unknown tool",
  "path-invalid": "A skill path is invalid",
  "body-empty": "The skill instructions are empty",
  "body-too-large": "The skill instructions are too large",
  "source-unreadable": "The skill source cannot be read",
  "source-invalid": "The skill source is invalid",
  "directory-symlink": "Symbolic-link skill folders are not allowed",
  "file-missing": "SKILL.md is missing",
  "file-symlink": "Symbolic-link skill files are not allowed",
  "file-invalid": "SKILL.md is not a regular file",
  "path-escape": "The skill resolves outside its source",
  "file-changing": "The skill changed while it was read",
  "count-limit": "The source contains too many skills",
  "aggregate-limit": "The source exceeds its total size limit",
};

function sourceIcon(skill: SkillViewDescriptor) {
  return skill.source.kind === "project" ? IconNames.PROJECTS : IconNames.PERSON;
}

function SkillRow({
  skill,
  busy,
  onSetTrust,
}: {
  skill: SkillViewDescriptor;
  busy: boolean;
  onSetTrust: (skillId: string, fingerprint: string, trusted: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const project = skill.source.kind === "project";
  return (
    <div className="AssistantSkillRow">
      <Icon icon={sourceIcon(skill)} size={18} />
      <div className="AssistantSkillBody">
        <div className="AssistantSkillTitle">
          <strong>{skill.name}</strong>
          <code>{skill.shortCommand ?? skill.command}</code>
        </div>
        <span>{skill.description}</span>
        {skill.allowedTools ? (
          <small>{t("{{count}} allowed tools", { count: skill.allowedTools.length })}</small>
        ) : null}
      </div>
      {project ? (
        <Button
          size="small"
          variant={skill.trusted ? "minimal" : "outlined"}
          intent={skill.trusted ? Intent.NONE : Intent.SUCCESS}
          icon={skill.trusted ? IconNames.UNLOCK : IconNames.LOCK}
          text={skill.trusted ? t("Revoke trust") : t("Trust")}
          disabled={busy || !skill.enabled}
          onClick={() => void onSetTrust(skill.id, skill.fingerprint, !skill.trusted).catch(() => undefined)}
        />
      ) : (
        <Tag minimal intent={Intent.SUCCESS}>
          {t("Available")}
        </Tag>
      )}
    </div>
  );
}

export function AssistantSkillsDrawer({
  snapshot,
  loading,
  error,
  onClose,
  onReload,
  onSetProjectSourceEnabled,
  onSetProjectSkillTrust,
}: AssistantSkillsDrawerProps) {
  const { t } = useTranslation();
  const userSkills = snapshot.skills.filter((skill) => skill.source.kind === "user");
  const projectSkills = snapshot.skills.filter((skill) => skill.source.kind === "project");
  const diagnostics = [
    ...new Map(snapshot.diagnostics.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values(),
  ];

  const rows = (skills: SkillViewDescriptor[], emptyLabel: string) =>
    skills.length > 0 ? (
      <div className="AssistantSkillList">
        {skills.map((skill) => (
          <SkillRow key={skill.id} skill={skill} busy={loading} onSetTrust={onSetProjectSkillTrust} />
        ))}
      </div>
    ) : (
      <div className="AssistantSkillsEmpty">{t(emptyLabel)}</div>
    );

  return (
    <AppDrawer
      className="AssistantSkillsDrawer"
      icon={IconNames.LIGHTBULB}
      title={t("Skills")}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY}>
        <div className={Classes.DIALOG_BODY}>
          <div className="AssistantSkillsToolbar">
            <span>{t("Reusable instructions discovered from local files.")}</span>
            <Button
              size="small"
              icon={IconNames.REFRESH}
              text={t("Reload")}
              loading={loading}
              onClick={() => void onReload().catch(() => undefined)}
            />
          </div>

          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}

          <section className="AssistantSkillsSection">
            <div className="AssistantSkillsSectionHeader">
              <div>
                <h5>{t("User skills")}</h5>
                <span>{t("App-private skills are available in every workspace.")}</span>
              </div>
              <Tag minimal>{userSkills.length}</Tag>
            </div>
            <code className="AssistantSkillsRoot">{snapshot.user.root}</code>
            {rows(userSkills, "No user skills found")}
          </section>

          <section className="AssistantSkillsSection">
            <div className="AssistantSkillsSectionHeader">
              <div>
                <h5>{t("Project skills")}</h5>
                <span>{t("Workspace files require explicit source and fingerprint trust.")}</span>
              </div>
              {snapshot.project ? (
                <Switch
                  checked={snapshot.project.enabled}
                  disabled={loading}
                  label={snapshot.project.enabled ? t("Enabled") : t("Disabled")}
                  onChange={(event) =>
                    void onSetProjectSourceEnabled(event.currentTarget.checked).catch(() => undefined)
                  }
                />
              ) : null}
            </div>
            {snapshot.project ? <code className="AssistantSkillsRoot">{snapshot.project.root}</code> : null}
            {rows(projectSkills, snapshot.project ? "No project skills found" : "No project skill source found")}
          </section>

          {diagnostics.length > 0 ? (
            <section className="AssistantSkillsSection">
              <div className="AssistantSkillsSectionHeader">
                <div>
                  <h5>{t("Diagnostics")}</h5>
                  <span>{t("Invalid entries stay isolated from available skills.")}</span>
                </div>
                <Tag minimal intent={Intent.WARNING}>
                  {diagnostics.length}
                </Tag>
              </div>
              <div className="AssistantSkillDiagnostics">
                {diagnostics.map((diagnostic) => (
                  <Callout key={JSON.stringify(diagnostic)} intent={Intent.WARNING}>
                    <strong>{diagnostic.entry ?? t("Skill source")}</strong>
                    <span>{t(DIAGNOSTIC_LABEL[diagnostic.code])}</span>
                  </Callout>
                ))}
              </div>
            </section>
          ) : null}

          {loading && snapshot.revision === "0" ? (
            <div className="AssistantSkillsLoading">
              <Spinner size={20} />
              <span>{t("Loading skills…")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </AppDrawer>
  );
}
