import { useCallback, useEffect } from "react";
import { Button, ButtonGroup, HotkeysProvider, Intent, NonIdealState, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { matchPath } from "react-router";
import { HashRouter as Router, Switch, Route, useLocation } from "react-router-dom";

import { useStoreActions, useStoreState, createAppStore, StoreProvider } from "./Domain";
import { AppScreen, Program } from "./Types";

import "./App.i18n";

// locals
import "./App.css";

import { CURRENT_ENVIRONMENT } from "./Environment";

import { AppHeader } from "./components/AppHeader";
import { AppSidebar } from "./components/AppSidebar";
import { Screen as DashboardScreen } from "./components/Dashboard";
import { Screen as ContainersScreen } from "./components/Container/ManageScreen";
import { Screen as ContainerLogsScreen } from "./components/Container/LogsScreen";
import { Screen as ContainerInspectScreen } from "./components/Container/InspectScreen";
import { Screen as ContainerStatsScreen } from "./components/Container/StatsScreen";
import { Screen as ContainerTerminalScreen } from "./components/Container/TerminalScreen";
import { Screen as ImagesScreen } from "./components/Image/ManageScreen";
import { Screen as ImageLayersScreen } from "./components/Image/LayersScreen";
import { Screen as ImageInspectScreen } from "./components/Image/InspectScreen";
import { Screen as VolumesScreen } from "./components/Volume/ManageScreen";
import { Screen as VolumeInspectScreen } from "./components/Volume/InspectScreen";
import { Screen as MachinesScreen } from "./components/Machine/ManageScreen";
import { Screen as SettingsScreen } from "./components/Settings";
import { Screen as SecretsScreen } from "./components/Secret/ManageScreen";
import { Screen as SecretInspectScreen } from "./components/Secret/InspectScreen";
import { Screen as TroubleshootScreen } from "./components/Troubleshoot/Troubleshoot";

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
  SettingsScreen,
  TroubleshootScreen
];

interface AppLoadingProps {
  program: Program;
  running: boolean;
}
const AppLoading: React.FC<AppLoadingProps> = ({ program, running }) => {
  const { t } = useTranslation();
  const connected = program.path && running;
  const connect = useStoreActions((actions) => actions.connect);
  const pending = useStoreState((state) => state.pending);
  const onConnectClick = useCallback(
    async (e) => {
      console.debug("connecting");
      const result = await connect({ autoStart: true });
      console.debug(">> result", result);
    },
    [connect]
  );
  const callToAction = !connected ? (
    <ButtonGroup>
      <Button disabled={pending} fill text={t("Re-try connection")} onClick={onConnectClick} />
    </ButtonGroup>
  ) : null;
  const splashContent = pending ? <ProgressBar intent={Intent.PRIMARY} /> : callToAction;
  return (
    <>
      <AppHeader program={program} running={running} screens={Screens} />
      <div className="AppContent">
        <div className="AppContentDocument">
          <div className="AppLoadingSplash">
            <div className="AppLoadingSplashContent">{splashContent}</div>
          </div>
        </div>
      </div>
    </>
  );
};

interface AppProvisionedProps {
  screens: AppScreen<any>[];
  currentScreen: AppScreen<any>;
}

const AppProvisioned: React.FC<AppProvisionedProps> = ({ screens, currentScreen }) => {
  const { t } = useTranslation();
  if (!currentScreen) {
    return (
      <NonIdealState
        icon={IconNames.WARNING_SIGN}
        title={t("There is no such container")}
        description={<p>{t("The container was not found")}</p>}
      />
    );
  }
  return (
    <>
      <AppSidebar screens={screens} currentScreen={currentScreen} />
      <div className="AppContentDocument">
        <HotkeysProvider>
          <Switch>
            {screens.map((Screen) => {
              return (
                <Route path={Screen.Route.Path} key={Screen.ID} exact>
                  <Screen navigator={navigator} />
                </Route>
              );
            })}
          </Switch>
        </HotkeysProvider>
      </div>
    </>
  );
};

interface AppLoadedProps {
  program?: Program;
  running?: boolean;
}
const AppLoaded: React.FC<AppLoadedProps> = ({ program, running }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const currentScreen = Screens.find((screen) =>
    matchPath(location.pathname, { path: screen.Route.Path, exact: true, strict: true })
  );
  if (!currentScreen) {
    return (
      <NonIdealState
        icon={IconNames.WARNING_SIGN}
        title={t("There is no such screen")}
        description={
          <>
            <p>{t("The screen was not found")}</p>
            <a href="/">{t("Go to dashboard")}</a>
          </>
        }
      />
    );
  }
  // Program exists
  let widget;
  if (program && running) {
    widget = <AppProvisioned screens={Screens} currentScreen={currentScreen} />;
  } else {
    widget = <SettingsScreen />;
  }
  return (
    <>
      <AppHeader program={program} running={running} screens={Screens} currentScreen={currentScreen} />
      <div className="AppContent">{widget}</div>
    </>
  );
};

export const AppMainContent = () => {
  const inited = useStoreState((state) => state.inited);
  const running = useStoreState((state) => state.running);
  const program = useStoreState((state) => state.program);
  let content;
  console.debug("AppMainContent", { inited, running });
  if (inited && running) {
    content = <AppLoaded program={program} running={running} />;
  } else {
    content = <AppLoading program={program} running={running} />;
  }
  return content;
};

export function AppMain() {
  const inited = useStoreState((state) => state.inited);
  const native = useStoreState((state) => state.native);
  const running = useStoreState((state) => state.running);
  const platform = useStoreState((state) => state.platform);
  const program = useStoreState((state) => state.program);
  const connect = useStoreActions((actions) => actions.connect);
  useEffect(() => {
    console.debug("AppMain changed", { inited, running, connect });
    if (inited) {
      console.debug("No more connections to retry - already inited");
    } else {
      connect({ autoStart: true });
    }
  }, [inited, running, connect]);
  console.debug("AppMain rendering", { inited, native, running, platform, program });
  return (
    <div
      className="App"
      data-environment={CURRENT_ENVIRONMENT}
      data-native={native ? "yes" : "no"}
      data-platform={platform}
      data-inited={inited ? "yes" : "no"}
      data-running={running ? "yes" : "no"}
      data-provisioned={program?.path ? "yes" : "no"}
    >
      <Router>{<AppMainContent />}</Router>
    </div>
  );
}

export default function App() {
  const store = createAppStore();
  return (
    <StoreProvider store={store}>
      <AppMain />
    </StoreProvider>
  );
}
