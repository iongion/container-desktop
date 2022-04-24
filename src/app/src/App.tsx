import React, { useEffect, useMemo, useRef } from "react";
import { HotkeysProvider, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { matchPath } from "react-router";
import { HashRouter as Router, Switch, Route, useLocation } from "react-router-dom";

import { StoreProvider } from "./domain/store";
import { AppBootstrapPhase, AppStore, useStoreActions, useStoreState } from "./domain/types";
import { Program } from "./Types";
import { pathTo } from "./Navigator";

import "./App.i18n";

// locals
import "./App.css";

import { CURRENT_ENVIRONMENT } from "./Environment";

import { AppHeader } from "./components/AppHeader";
import { AppLoading } from "./components/AppLoading";
import { AppSidebar } from "./components/AppSidebar";

import { Screen as DashboardScreen } from "./screens/Dashboard";
import { Screen as ContainersScreen } from "./screens/Container/ManageScreen";
import { Screen as ContainerLogsScreen } from "./screens/Container/LogsScreen";
import { Screen as ContainerInspectScreen } from "./screens/Container/InspectScreen";
import { Screen as ContainerStatsScreen } from "./screens/Container/StatsScreen";
import { Screen as ContainerTerminalScreen } from "./screens/Container/TerminalScreen";
import { Screen as ImagesScreen } from "./screens/Image/ManageScreen";
import { Screen as ImageLayersScreen } from "./screens/Image/LayersScreen";
import { Screen as ImageInspectScreen } from "./screens/Image/InspectScreen";
import { Screen as VolumesScreen } from "./screens/Volume/ManageScreen";
import { Screen as VolumeInspectScreen } from "./screens/Volume/InspectScreen";
import { Screen as MachinesScreen } from "./screens/Machine/ManageScreen";
import { Screen as UserSettingsScreen } from "./screens/Settings/UserSettingsScreen";
import { Screen as SystemInfoScreen } from "./screens/Settings/SystemInfoScreen";
import { Screen as SecretsScreen } from "./screens/Secret/ManageScreen";
import { Screen as SecretInspectScreen } from "./screens/Secret/InspectScreen";
import { Screen as TroubleshootScreen } from "./screens/Troubleshoot/Troubleshoot";

const Screens = [
  DashboardScreen,
  ContainersScreen,
  ContainerLogsScreen,
  ContainerInspectScreen,
  ContainerStatsScreen,
  ContainerTerminalScreen,
  ImagesScreen,
  ImageLayersScreen,
  ImageInspectScreen,
  MachinesScreen,
  SecretsScreen,
  SecretInspectScreen,
  VolumesScreen,
  VolumeInspectScreen,
  UserSettingsScreen,
  SystemInfoScreen,
  TroubleshootScreen
];

interface AppMainScreenContentProps {
  phase: AppBootstrapPhase;
  program: Program;
  running: boolean;
  provisioned: boolean;
}
export const AppMainScreenContent: React.FC<AppMainScreenContentProps> = ({ program, phase, provisioned, running }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const ready = phase === AppBootstrapPhase.READY;
  const currentScreen = Screens.find((screen) =>
    matchPath(location.pathname, { path: screen.Route.Path, exact: true, strict: true })
  );
  const content = useMemo(() => {
    let content;
    if (ready) {
      content = (
        <Switch>
          {Screens.map((Screen) => {
            return (
              <Route path={Screen.Route.Path} key={Screen.ID} exact>
                <Screen navigator={navigator} />
              </Route>
            );
          })}
        </Switch>
      );
    } else if (phase === AppBootstrapPhase.FAILED) {
      content = (
        <UserSettingsScreen navigator={navigator} />
      );
    } else {
      content = <AppLoading />;
    }
    return content;
  }, [ready, phase]);

  // console.debug({ phase, ready });

  if (!currentScreen) {
    return (
      <NonIdealState
        icon={IconNames.WARNING_SIGN}
        title={t("There is no such screen {{pathname}}", location)}
        description={
          <>
            <p>{t("The screen was not found")}</p>
            <a href={pathTo('/')}>{t("Go to dashboard")}</a>
          </>
        }
      />
    );
  }

  let sidebar;
  if (ready) {
    sidebar = <AppSidebar screens={Screens} currentScreen={currentScreen} />;
  }

  return (
    <>
      <AppHeader program={program} provisioned={provisioned} running={running} screens={Screens} currentScreen={currentScreen} />
      <div className="AppContent">
        {sidebar}
        <div className="AppContentDocument">
          {content}
        </div>
      </div>
    </>
  );
};

export function AppMainScreen() {
  const phase = useStoreState((state) => state.phase);
  const native = useStoreState((state) => state.native);
  const provisioned = useStoreState((state) => state.environment.provisioned);
  const running = useStoreState((state) => state.environment.running);
  const platform = useStoreState((state) => state.environment.platform);
  const start = useStoreActions((actions) => actions.start);
  const engine = useStoreState((state) => state.environment.userConfiguration.engine);
  const program = useStoreState((state) => state.environment.userConfiguration.program);
  const startRef = useRef(false);

  console.debug({ phase, native, provisioned, running, platform, engine, program });

  useEffect(() => {
    if (startRef.current) {
      console.debug("Initial start skipped - already started");
    } else {
      console.debug("Initial start has been triggered");
      startRef.current = true;
      start();
    }
  }, [start]);

  return (
    <div
      className="App"
      data-engine={engine}
      data-environment={CURRENT_ENVIRONMENT}
      data-native={native ? "yes" : "no"}
      data-platform={platform}
      data-phase={phase}
      data-running={running ? "yes" : "no"}
      data-provisioned={provisioned ? "yes" : "no"}
    >
      <Router>
        <AppMainScreenContent phase={phase} provisioned={provisioned} running={running} program={program} />
      </Router>
    </div>
  );
}

export interface AppProps {
  store: AppStore;
}

export const App:React.FC<AppProps> = ({ store }) => {
  return (
    <StoreProvider store={store}>
      <HotkeysProvider>
        <AppMainScreen />
      </HotkeysProvider>
    </StoreProvider>
  );
}
