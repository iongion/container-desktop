import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import dayjs from "dayjs";

// project
import { ApplicationDescriptor, Machine } from "../../Types.container-app";

// module
import { ActionsMenu } from ".";
import { usePoller } from "../../Hooks";
import { AppScreen, AppScreenProps } from "../../Types";
import { AppLabel } from "../../components/AppLabel";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";
import { getMachineUrl } from "./Navigation";

import "./ManageScreen.css";

export const ID = "machines";

export interface ScreenProps extends AppScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const machinesFetch = useStoreActions((actions) => actions.machine.machinesFetch);
  const machines: Machine[] = useStoreState((state) => state.machine.machinesSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: machinesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.HEAT_GRID}
        rightContent={<ActionsMenu />}
      />
      <div className="AppScreenContent">
        <HTMLTable interactive compact striped className="AppDataTable" data-table="machines">
          <thead>
            <tr>
              <th data-column="Name">
                <AppLabel iconName={IconNames.HEAT_GRID} text={t("Name")} />
              </th>
              <th data-column="VMType">{t("VM Type")}</th>
              <th data-column="Active">{t("Active")}</th>
              <th data-column="Running">{t("Running")}</th>
              <th data-column="LastUp">
                <AppLabel iconName={IconNames.CALENDAR} text={t("Last Up")} />
              </th>
              <th data-column="Created">
                <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
              </th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((machine) => {
              return (
                <tr key={machine.Name}>
                  <td>
                    <AnchorButton
                      className="InspectMachineButton"
                      minimal
                      small
                      href={getMachineUrl(machine.Name, "inspect")}
                      intent={Intent.PRIMARY}
                      icon={IconNames.EYE_OPEN}
                    >
                      <span>{machine.Name}</span>
                    </AnchorButton>
                  </td>
                  <td>{machine.VMType}</td>
                  <td>{machine.Active ? t("Yes") : t("No")}</td>
                  <td>{machine.Running ? t("Yes") : t("No")}</td>
                  <td>{dayjs(machine.LastUp).format("DD MMM YYYY HH:mm")}</td>
                  <td>{dayjs(machine.Created).format("DD MMM YYYY HH:mm")}</td>
                  <td>
                    <ActionsMenu withoutCreate machine={machine} />
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
Screen.isAvailable = (context: ApplicationDescriptor) => {
  return !context.currentConnector.engine.startsWith("docker");
};
