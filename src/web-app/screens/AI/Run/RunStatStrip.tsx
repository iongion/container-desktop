import { useTranslation } from "react-i18next";
import type { RunView } from "@/ai-system/core/runEvents";
import { uniqueStrings } from "@/utils/uniqueStrings";
import { compactTokens, formatCost, formatDurationMs } from "@/web-app/utils/format";
import { runDuration, totalRunCost } from "./runStats";

interface RunStatStripProps {
  view: RunView;
}

function listValue(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

export function RunStatStrip({ view }: RunStatStripProps) {
  const { t } = useTranslation();
  const workers = uniqueStrings(view.tasks.map((task) => task.workerId ?? task.agent));
  const models = uniqueStrings(view.tasks.map((task) => task.model));
  const providers = uniqueStrings(view.tasks.map((task) => task.provider));
  const stats = [
    { id: "status", label: t("Status"), value: t(view.phase), phase: view.phase },
    { id: "duration", label: t("Duration"), value: formatDurationMs(runDuration(view)) },
    { id: "input", label: t("Input"), value: compactTokens(view.usage.inputTokens) },
    { id: "output", label: t("Output"), value: compactTokens(view.usage.outputTokens) },
    { id: "cost", label: t("Cost"), value: formatCost(totalRunCost(view)) },
    {
      id: "workers",
      label: t("Workers"),
      value: workers.length ? String(workers.length) : "—",
      title: listValue(workers),
    },
    { id: "models", label: t("Models"), value: models.length ? String(models.length) : "—", title: listValue(models) },
    {
      id: "providers",
      label: t("Providers"),
      value: providers.length ? String(providers.length) : "—",
      title: listValue(providers),
    },
  ];

  return (
    <section className="RunStatStrip" aria-label={t("Run statistics")}>
      {stats.map((stat) => (
        <div className="RunStat" key={stat.id} title={stat.title}>
          <span className="RunStatLabel">{stat.label}</span>
          <strong className="RunStatValue" data-phase={stat.phase}>
            {stat.value}
          </strong>
        </div>
      ))}
    </section>
  );
}
