// The Runs list — several runs can be in flight at once, so this is the entry point and the run screen is one
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
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compactTokens } from "@/web-app/utils/format";

import { ScreenHeader } from "../ScreenHeader";
// From the family barrel, not the modules directly — the barrel is what side-effect-imports index.css (the
// create drawer's styles).
import { CreateDrawer, RunActionsMenu } from ".";
import { groupRunsByColumn, isPlanningStage, runProgress } from "./runBoard";
import { useRunClient } from "./runClientInstance";
import "./ManageScreen.css";
import { goToRun } from "./Navigation";

export const ID = "ai.runs";
export const Title = i18n.t("Runs");

type ViewMode = "board" | "table";

// goal · phase · tasks · tokens · actions — drives the windowed spacer rows' colSpan.
const TABLE_COLUMN_COUNT = 5;
const getRunKey = (run: RunView): string => run.runId;
const estimateRunRowHeight = (): number => 34;

const RunCard: React.FC<{ run: RunView; onOpen: () => void }> = ({ run, onOpen }) => {
  const { t } = useTranslation();
  const progress = runProgress(run);
  const spent = run.usage.inputTokens + run.usage.outputTokens;
  return (
    <button type="button" className="RunCard" data-phase={run.phase} onClick={onOpen} title={run.goal}>
      <span className="RunCardTitle">{run.goal}</span>
      <span className="RunCardMeta">
        <span className="RunPhase" data-phase={run.phase}>
          {t(run.phase)}
        </span>
        <span className="RunCardTokens">{compactTokens(spent)}</span>
      </span>
      {progress.total > 0 ? (
        <span className="RunCardProgress">
          <span className="RunCardProgressBar" data-phase={run.phase} style={{ width: `${progress.percent}%` }} />
        </span>
      ) : null}
      <span className="RunCardFoot">
        <span>
          {progress.total > 0
            ? t("{{done}} / {{total}} tasks", { done: progress.done, total: progress.total })
            : isPlanningStage(run.phase)
              ? t("Planning…")
              : t(run.phase)}
        </span>
        {run.approvals.some((approval) => approval.status === "pending") || run.planPending ? (
          <span className="RunCardNeedsYou">{t("Needs you")}</span>
        ) : null}
      </span>
    </button>
  );
};

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { runClient, state } = useRunClient();
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

  // The table view windows its rows exactly like the resource lists (Containers/Images/…): only the visible
  // slice mounts, spacer rows reserve the rest. Idle unless the table is the active view and has rows.
  const { scrollElementRef, theadRef, scrollMargin, getScrollElement } = useTableScroll();
  const { items, paddingTop, paddingBottom, measureRef } = useWindowedRows({
    rows: runs,
    getScrollElement,
    getRowKey: getRunKey,
    estimateRowHeight: estimateRunRowHeight,
    scrollMargin,
    enabled: mode === "table" && runs.length > 0,
  });

  const openRun = useCallback((runId: string) => {
    goToRun(runId);
  }, []);

  const onReload = useCallback(() => {
    runClient.reattach();
  }, [runClient]);

  const viewToggle = (
    <ButtonGroup className="RunViewSwitch">
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
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        rightContent={<RunActionsMenu navigation={viewToggle} onCreate={() => setCreating(true)} onReload={onReload} />}
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {state.error ? (
          <Callout intent={Intent.DANGER} className="RunListError">
            {state.error}
          </Callout>
        ) : null}

        {runs.length === 0 ? (
          <NonIdealState
            icon={IconNames.GRAPH}
            title={t("No runs yet")}
            description={
              <p>{t("Start a run and a team of agents will plan the goal, then execute it in parallel.")}</p>
            }
            action={
              <Button
                intent={Intent.SUCCESS}
                icon={IconNames.ADD}
                text={t("New run")}
                onClick={() => setCreating(true)}
              />
            }
          />
        ) : mode === "board" ? (
          <Board
            className="RunBoard"
            columns={columns}
            getCardKey={(run) => run.runId}
            renderCard={(run) => <RunCard run={run} onOpen={() => openRun(run.runId)} />}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable"
            data-windowed="true"
            data-table="ai.runs"
            data-grouped="false"
          >
            <thead ref={theadRef}>
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
              <VirtualSpacerRow height={paddingTop} columnCount={TABLE_COLUMN_COUNT} />
              {items.map(({ row: run, index, key }) => {
                const progress = runProgress(run);
                return (
                  <tr key={key} ref={measureRef} data-index={index} data-striped={index % 2 === 0 ? "true" : undefined}>
                    <td>
                      <button type="button" className="RunTableLink" onClick={() => openRun(run.runId)}>
                        {run.goal}
                      </button>
                    </td>
                    <td>
                      <span className="RunPhase" data-phase={run.phase}>
                        {t(run.phase)}
                      </span>
                    </td>
                    <td>{progress.total > 0 ? `${progress.done} / ${progress.total}` : <span>&mdash;</span>}</td>
                    <td>
                      <Code>{compactTokens(run.usage.inputTokens + run.usage.outputTokens)}</Code>
                    </td>
                    <td data-column="Actions">
                      <RunActionsMenu
                        run={run}
                        onOpen={() => openRun(run.runId)}
                        onStop={() => runClient.stop(run.runId)}
                        onDismiss={() => runClient.dismiss(run.runId)}
                      />
                    </td>
                  </tr>
                );
              })}
              <VirtualSpacerRow height={paddingBottom} columnCount={TABLE_COLUMN_COUNT} />
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
  Path: "/screens/ai/runs",
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  // The AI hub's sidebar entry — "Runs" (its own Title + icon), highlighted so it stands out from the engine
  // screens. The AI section tab bar reaches Workers. AI is always on, so it is never connection-gated.
  SidebarHighlight: true,
  ExcludeFromSidebar: false,
  RequiresAI: true,
};
