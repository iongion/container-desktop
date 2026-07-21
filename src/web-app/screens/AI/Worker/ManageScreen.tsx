// The workers library — user-authored agent definitions the goal coordinator assigns to plan tasks. App-local
// records (not an engine resource domain), so this is a flat table over the AI bridge rather than the
// merged-by-connection grouped table the container families use: a worker belongs to the app, not a connection.
// Gated by Metadata.RequiresAI and reached from the AI section tab bar.

import { Code, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { WorkerDefinition } from "@/ai-system/core/workers";
import i18n from "@/i18n";
import { AppLabel } from "@/web-app/components/AppLabel";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { ScreenHeader } from "../ScreenHeader";
// From the family barrel, not ./ActionsMenu — the barrel is what side-effect-imports index.css (the editor
// drawer's styles). Importing the module directly leaves the drawer unstyled.
import { WorkerActionsMenu } from ".";
import { useWorkerBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { useWorkers } from "./queries";

export const ID = "ai.workers";
export const Title = i18n.t("Workers");

// Workers are app-local, so there is no connector to advertise sort support. Declaring it here keeps the same
// SortableColumnHeader/useColumnSort UX as every other list without inventing an engine capability.
const SORT_CAPABILITIES = {
  [`${ID}.name`]: "client",
  [`${ID}.specialty`]: "client",
  [`${ID}.model`]: "client",
  [`${ID}.policy`]: "client",
  [`${ID}.updated`]: "client",
} as const;

const workerSortSelectors: SortSelectors<WorkerDefinition> = {
  name: (worker) => worker.name,
  specialty: (worker) => worker.specialty,
  model: (worker) => worker.model || "",
  policy: (worker) => worker.toolPolicy.mode,
  updated: (worker) => worker.updatedAt,
};

const createWorkerSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (worker: WorkerDefinition) =>
    [worker.name, worker.specialty, worker.model, worker.providerId, worker.toolPolicy.mode]
      .map((value) => `${value ?? ""}`.toLowerCase())
      .some((value) => value.includes(query));
};

function policyLabel(worker: WorkerDefinition, t: (key: string, opts?: any) => string): string {
  switch (worker.toolPolicy.mode) {
    case "all":
      return t("All allowed");
    case "ask":
      return t("Prompt me");
    default:
      return t("Granular · {{count}}", { count: worker.toolPolicy.allowed.length });
  }
}

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(ID, SORT_CAPABILITIES);
  const { data, refetch } = useWorkers();

  const filtered = useMemo(() => {
    const all = data ?? [];
    return searchTerm ? all.filter(createWorkerSearchFilter(searchTerm)) : all;
  }, [data, searchTerm]);

  const compareWorkers = useCallback(
    (a: WorkerDefinition, b: WorkerDefinition) => {
      if (clientSort) {
        const selector = workerSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.name, b.name);
    },
    [clientSort],
  );

  const workers = useMemo(() => [...filtered].sort(compareWorkers), [filtered, compareWorkers]);
  const visibleIds = useMemo(() => workers.map((worker) => worker.id), [workers]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useWorkerBulkActions();
  const onReload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader
        currentScreen={ID}
        titleText={t("Workers")}
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        rightContent={
          <>
            {selection.count > 0 ? (
              <>
                <BulkActionsBar
                  items={workers}
                  getId={(worker) => worker.id}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <WorkerActionsMenu onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {workers.length === 0 ? (
          <NonIdealState
            icon={IconNames.PEOPLE}
            title={t("No results")}
            description={<p>{t("There are no workers")}</p>}
          />
        ) : (
          <HTMLTable interactive compact className="AppDataTable" data-table="ai.workers" data-grouped="false">
            <thead>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.PERSON} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="specialty"
                  direction={getColumnSortDirection("specialty")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.LABEL} text={t("Specialty")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="model"
                  direction={getColumnSortDirection("model")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.PREDICTIVE_ANALYSIS} text={t("Model")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="policy"
                  direction={getColumnSortDirection("policy")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.WRENCH} text={t("Tools")} />
                </SortableColumnHeader>
                <th data-column="runs-on">
                  <AppLabel iconName={IconNames.DESKTOP} text={t("Runs on")} />
                </th>
                <SortableColumnHeader
                  field="updated"
                  direction={getColumnSortDirection("updated")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Updated")} />
                </SortableColumnHeader>
                <th data-column="Actions">&nbsp;</th>
                <th data-column="select" className="BulkSelectColumn">
                  <SelectionCheckbox
                    checked={selection.headerState.checked}
                    indeterminate={selection.headerState.indeterminate}
                    onChange={selection.toggleAll}
                    title={t("Select all")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker, index) => (
                <tr key={worker.id} data-striped={index % 2 === 0 ? "true" : undefined}>
                  <td>{worker.name}</td>
                  <td>{worker.specialty}</td>
                  <td>{worker.model ? <Code>{worker.model}</Code> : <span>{t("Inherited")}</span>}</td>
                  <td>
                    <span className="WorkerPolicyTag" data-policy={worker.toolPolicy.mode}>
                      {policyLabel(worker, t)}
                    </span>
                  </td>
                  <td>{t("Host")}</td>
                  <td>{(dayjs(worker.updatedAt) as any).fromNow()}</td>
                  <td data-column="Actions">
                    <WorkerActionsMenu withoutCreate worker={worker} />
                  </td>
                  <td className="BulkSelectColumn">
                    <SelectionCheckbox
                      checked={selection.isSelected(worker.id)}
                      onChange={() => selection.toggle(worker.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/workers",
};
Screen.Metadata = {
  LeftIcon: IconNames.PEOPLE,
  ExcludeFromSidebar: true,
  RequiresAI: true,
};
