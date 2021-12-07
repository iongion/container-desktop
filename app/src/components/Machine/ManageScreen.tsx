import { useCallback, useState } from "react";
import { HTMLTable, Icon } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { IconNames } from "@blueprintjs/icons";

import { AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../AppScreenHeader";

import { useStoreActions, useStoreState } from "./Model";

import "./ManageScreen.css";
import { MachineActionsMenu } from ".";

export const ID = "machines";

interface ScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { t } = useTranslation();
  const machinesFetch = useStoreActions((actions) => actions.machinesFetch);
  const machines = useStoreState((state) => state.machinesSearchByTerm(searchTerm));
  const onSearchChange = useCallback(
    (e) => {
      const needle = e.currentTarget.value.toLowerCase();
      setSearchTerm(needle);
    },
    [setSearchTerm]
  );

  // Change hydration

  usePoller({ poller: machinesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        onSearch={onSearchChange}
        titleIcon={IconNames.HEAT_GRID}
        rightContent={<MachineActionsMenu />}
      />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="machines">
          <thead>
            <tr>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="VMType">{t("VM Type")}</th>
              <th data-column="Active">{t("Active")}</th>
              <th data-column="Running">{t("Running")}</th>
              <th data-column="LastUp">{t("Last Up")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((machine) => {
              return (
                <tr key={machine.Name}>
                  <td>
                    <Icon icon={IconNames.HEAT_GRID} />
                    &nbsp;{machine.Name}
                  </td>
                  <td>{machine.VMType}</td>
                  <td>{machine.Active ? t("Yes") : t("No")}</td>
                  <td>{machine.Running ? t("Yes") : t("No")}</td>
                  <td>{machine.LastUp}</td>
                  <td>{machine.Created}</td>
                  <td>
                    <MachineActionsMenu withoutCreate machine={machine} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Machines";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID
};
