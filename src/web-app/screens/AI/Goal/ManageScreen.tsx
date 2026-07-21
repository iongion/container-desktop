// The Goals list — several goals can be in flight at once, so this is the entry point and the run screen is one
// run's detail. Two display modes over the same data: a phase-grouped board (what needs me / what is moving) and
// a table (dense, sortable). Live-only: the host holds runs in memory, nothing is written to disk.

import { Button, ButtonGroup, Callout, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RunView } from "@/ai-system/core/runEvents";
import i18n from "@/i18n";
import { AppLabel } from "@/web-app/components/AppLabel";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { Board } from "@/web-app/components/Board/Board";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from "../ScreenHeader";
// From the family barrel, not the modules directly — the barrel is what side-effect-imports index.css (the
// create drawer's styles).
import { CreateDrawer, GoalActionsMenu } from ".";
import { groupRunsByColumn, runProgress } from "./goalBoard";
import { useGoalClient } from "./goalClientInstance";
import "./ManageScreen.css";
import { goToGoalRun } from "./Navigation";

export const ID = "ai.goals";
export const Title = i18n.t("Goals");

type ViewMode = "board" | "table";

function compactTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

const GoalCard: React.FC<{ run: RunView; onOpen: () => void }> = ({ run, onOpen }) => {
  const { t } = useTranslation();
  const progress = runProgress(run);
  const spent = run.usage.inputTokens + run.usage.outputTokens;
  return (
    <button type="button" className="GoalCard" data-phase={run.phase} onClick={onOpen} title={run.goal}>
      <span className="GoalCardTitle">{run.goal}</span>
      <span className="GoalCardMeta">
        <span className="GoalPhase" data-phase={run.phase}>
          {t(run.phase)}
        </span>
        <span className="GoalCardTokens">{compactTokens(spent)}</span>
      </span>
      {progress.total > 0 ? (
        <span className="GoalCardProgress">
          <span className="GoalCardProgressBar" data-phase={run.phase} style={{ width: `${progress.percent}%` }} />
        </span>
      ) : null}
      <span className="GoalCardFoot">
        <span>
          {progress.total > 0
            ? t("{{done}} / {{total}} tasks", { done: progress.done, total: progress.total })
            : t("Planning…")}
        </span>
        {run.approvals.some((approval) => approval.status === "pending") || run.planPending ? (
          <span className="GoalCardNeedsYou">{t("Needs you")}</span>
        ) : null}
      </span>
    </button>
  );
};

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { goalClient, state } = useGoalClient();
  const [mode, setMode] = useState<ViewMode>("board");
  const [creating, setCreating] = useState(false);

  // Newest first: `order` is oldest-to-newest, and the run you just started is the one you want to see.
  const runs = useMemo(() => {
    const all = state.order.map((runId) => state.runs[runId]).filter(Boolean);
    const ordered = [...all].reverse();
    if (!searchTerm) return ordered;
    const query = searchTerm.toLowerCase();
    return ordered.filter((run) => run.goal.toLowerCase().includes(query));
  }, [state.order, state.runs, searchTerm]);

  const columns = useMemo(
    () => groupRunsByColumn(runs).map((column) => ({ ...column, label: t(column.label) })),
    [runs, t],
  );

  const openRun = useCallback((runId: string) => {
    goToGoalRun(runId);
  }, []);

  const onReload = useCallback(() => {
    goalClient.reattach();
  }, [goalClient]);

  const viewToggle = (
    <ButtonGroup className="GoalViewSwitch">
      <Button
        size="small"
        icon={IconNames.COLUMN_LAYOUT}
        title={t("Board")}
        aria-label={t("Board")}
        intent={mode === "board" ? Intent.PRIMARY : Intent.NONE}
        onClick={() => setMode("board")}
      />
      <Button
        size="small"
        icon={IconNames.TH}
        title={t("Table")}
        aria-label={t("Table")}
        intent={mode === "table" ? Intent.PRIMARY : Intent.NONE}
        onClick={() => setMode("table")}
      />
    </ButtonGroup>
  );

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader
        currentScreen={ID}
        titleText={t("Goals")}
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        rightContent={
          <GoalActionsMenu navigation={viewToggle} onCreate={() => setCreating(true)} onReload={onReload} />
        }
      />
      <div className="AppScreenContent">
        {state.error ? (
          <Callout intent={Intent.DANGER} className="GoalListError">
            {state.error}
          </Callout>
        ) : null}

        {runs.length === 0 ? (
          <NonIdealState
            icon={IconNames.GRAPH}
            title={t("No goals running")}
            description={<p>{t("Start a goal and a team of agents will plan it, then run it in parallel.")}</p>}
            action={
              <Button
                intent={Intent.SUCCESS}
                icon={IconNames.ADD}
                text={t("New goal")}
                onClick={() => setCreating(true)}
              />
            }
          />
        ) : mode === "board" ? (
          <Board
            className="GoalBoard"
            columns={columns}
            getCardKey={(run) => run.runId}
            renderCard={(run) => <GoalCard run={run} onOpen={() => openRun(run.runId)} />}
          />
        ) : (
          <HTMLTable interactive compact className="AppDataTable" data-table="ai.goals" data-grouped="false">
            <thead>
              <tr>
                <th data-column="goal">
                  <AppLabel iconName={IconNames.GRAPH} text={t("Goal")} />
                </th>
                <th data-column="phase">
                  <AppLabel iconName={IconNames.PULSE} text={t("Phase")} />
                </th>
                <th data-column="tasks">
                  <AppLabel iconName={IconNames.DIAGRAM_TREE} text={t("Tasks")} />
                </th>
                <th data-column="tokens">
                  <AppLabel iconName={IconNames.NUMERICAL} text={t("Tokens")} />
                </th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, index) => {
                const progress = runProgress(run);
                return (
                  <tr key={run.runId} data-striped={index % 2 === 0 ? "true" : undefined}>
                    <td>
                      <button type="button" className="GoalTableLink" onClick={() => openRun(run.runId)}>
                        {run.goal}
                      </button>
                    </td>
                    <td>
                      <span className="GoalPhase" data-phase={run.phase}>
                        {t(run.phase)}
                      </span>
                    </td>
                    <td>{progress.total > 0 ? `${progress.done} / ${progress.total}` : <span>&mdash;</span>}</td>
                    <td>
                      <Code>{compactTokens(run.usage.inputTokens + run.usage.outputTokens)}</Code>
                    </td>
                    <td data-column="Actions">
                      <GoalActionsMenu
                        run={run}
                        onOpen={() => openRun(run.runId)}
                        onStop={() => goalClient.stop(run.runId)}
                        onDismiss={() => goalClient.dismiss(run.runId)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        )}
      </div>
      {creating ? <CreateDrawer onClose={() => setCreating(false)} onStarted={openRun} /> : null}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/goals",
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  ExcludeFromSidebar: true,
  RequiresAI: true,
};
