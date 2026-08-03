import { Button, ButtonGroup, Classes, Icon, Intent, NonIdealState, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { EffectiveContextSnapshot, EffectiveContextSourceKind } from "@/ai-system/core/context";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ProjectContextPanel, type ProjectContextRequest } from "@/web-app/components/ai/ProjectContextPanel";
import { compactTokens, formatCost } from "@/web-app/utils/format";

import "./AssistantContextDrawer.css";

export type AssistantContextSection = "usage" | "context" | "tools" | "project";

interface AssistantContextDrawerProps {
  view?: ThreadView;
  initialSection: AssistantContextSection;
  projectRequest?: ProjectContextRequest;
  onClose: () => void;
}

const SOURCE_LABELS: Record<EffectiveContextSourceKind, string> = {
  os: "Operating system",
  engine: "Container engine",
  connection: "Connection",
  screen: "Active screen",
  activity: "Recent activity",
  resources: "Selected resources",
  errors: "Errors",
  skill: "Skill",
  rules: "Project Rules",
  memory: "Project Memory",
};

function EmptyContext() {
  const { t } = useTranslation();
  return (
    <NonIdealState
      icon={IconNames.TIMELINE_BAR_CHART}
      title={t("No context captured yet")}
      description={t("Send a message to capture the exact context and tools offered to the model.")}
    />
  );
}

function ContextOverview({ context }: { context: EffectiveContextSnapshot }) {
  const { t } = useTranslation();
  return (
    <div className="AssistantContextSections">
      <section className="AssistantContextPanel">
        <div className="AssistantContextPanelHeader">
          <h5>{t("Request context")}</h5>
          <Tag minimal>{t("Approximate tokens")}</Tag>
        </div>
        <div className="AssistantContextRows">
          {context.sections.map((section) => (
            <div className="AssistantContextRow" key={section.kind}>
              <span>{t(section.kind)}</span>
              <span>{t("{{count}} items", { count: section.items })}</span>
              <strong>{compactTokens(section.estimatedTokens)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="AssistantContextPanel">
        <div className="AssistantContextPanelHeader">
          <h5>{t("Sources")}</h5>
          <Tag minimal>{context.sources.length}</Tag>
        </div>
        <div className="AssistantContextRows">
          {context.sources.length ? (
            context.sources.map((source) => (
              <div className="AssistantContextRow" key={`${source.kind}:${source.trust}`}>
                <span>{t(SOURCE_LABELS[source.kind])}</span>
                <Tag minimal>{t(source.trust)}</Tag>
                <strong>{t("{{count}} characters", { count: source.characters })}</strong>
              </div>
            ))
          ) : (
            <div className="AssistantContextEmptyRow">{t("No dynamic context sources")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function UsageOverview({ view }: { view: ThreadView }) {
  const { t } = useTranslation();
  const context = view.context;
  const usage = view.usage;
  const stats = [
    { label: t("Requests"), value: String(usage?.requests ?? 0) },
    { label: t("Input"), value: compactTokens(usage?.inputTokens ?? 0) },
    { label: t("Output"), value: compactTokens(usage?.outputTokens ?? 0) },
    { label: t("Context estimate"), value: compactTokens(context?.totals.estimatedTokens ?? 0) },
  ];
  return (
    <div className="AssistantContextSections">
      <div className="AssistantContextStats">
        {stats.map((stat) => (
          <div className="AssistantContextStat" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
      <section className="AssistantContextPanel">
        <div className="AssistantContextPanelHeader">
          <h5>{t("Model budget")}</h5>
          <Tag minimal>{context?.model ?? t("Unknown")}</Tag>
        </div>
        <div className="AssistantContextNotice">
          {context?.window.status === "known"
            ? t("{{used}} of {{limit}} input tokens estimated", {
                used: compactTokens(context.totals.estimatedTokens),
                limit: compactTokens(context.window.maxInputTokens),
              })
            : t("This provider does not publish a verified context window to the app.")}
        </div>
      </section>
      <section className="AssistantContextPanel">
        <div className="AssistantContextPanelHeader">
          <h5>{t("Estimated cost")}</h5>
          <Tag minimal>{usage?.costs.length ?? 0}</Tag>
        </div>
        <div className="AssistantContextRows">
          {usage?.costs.length ? (
            usage.costs.map((cost) => (
              <div className="AssistantContextRow" key={cost.currency}>
                <span>{cost.currency.toUpperCase()}</span>
                <strong>{formatCost(cost)}</strong>
              </div>
            ))
          ) : (
            <div className="AssistantContextEmptyRow">{t("No reliable price is available for this usage")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function EffectiveTools({ context }: { context: EffectiveContextSnapshot }) {
  const { t } = useTranslation();
  return context.tools.length ? (
    <div className="AssistantToolList">
      {context.tools.map((tool) => (
        <div className="AssistantToolRow" key={tool.name}>
          <Icon icon={tool.gated ? IconNames.LOCK : IconNames.UNLOCK} size={16} />
          <div>
            <strong>{t(tool.title)}</strong>
            {tool.description ? <span>{t(tool.description)}</span> : null}
          </div>
          <Tag minimal>{t(tool.group)}</Tag>
        </div>
      ))}
    </div>
  ) : (
    <NonIdealState icon={IconNames.WRENCH} title={t("No tools offered to the model")} />
  );
}

export function AssistantContextDrawer({ view, initialSection, projectRequest, onClose }: AssistantContextDrawerProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState(initialSection);
  const context = view?.context;
  return (
    <AppDrawer
      className="AssistantContextDrawer"
      icon={IconNames.TIMELINE_BAR_CHART}
      title={t("Context and usage")}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY} data-testid="assistant-context-drawer">
        <div className={Classes.DIALOG_BODY}>
          <ButtonGroup
            fill
            variant="minimal"
            className="AppSegmentedControl"
            aria-label={t("Context and usage section")}
          >
            <Button
              active={section === "usage"}
              intent={section === "usage" ? Intent.PRIMARY : Intent.NONE}
              icon={IconNames.PULSE}
              onClick={() => setSection("usage")}
            >
              {t("Usage")}
            </Button>
            <Button
              active={section === "context"}
              intent={section === "context" ? Intent.PRIMARY : Intent.NONE}
              icon={IconNames.LIST_DETAIL_VIEW}
              onClick={() => setSection("context")}
            >
              {t("Context")}
            </Button>
            <Button
              active={section === "tools"}
              intent={section === "tools" ? Intent.PRIMARY : Intent.NONE}
              icon={IconNames.WRENCH}
              onClick={() => setSection("tools")}
            >
              {t("Tools")}
            </Button>
            <Button
              active={section === "project"}
              intent={section === "project" ? Intent.PRIMARY : Intent.NONE}
              icon={IconNames.PROJECTS}
              onClick={() => setSection("project")}
            >
              {t("Project")}
            </Button>
          </ButtonGroup>
          {section === "project" ? (
            <ProjectContextPanel initialRequest={projectRequest} />
          ) : !context || !view ? (
            <EmptyContext />
          ) : section === "usage" ? (
            <UsageOverview view={view} />
          ) : section === "context" ? (
            <ContextOverview context={context} />
          ) : (
            <EffectiveTools context={context} />
          )}
        </div>
      </div>
    </AppDrawer>
  );
}
