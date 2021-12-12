import { useCallback, useEffect } from "react";
import { AnchorButton, Button, ButtonGroup, HotkeysProvider, Intent, NonIdealState, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { matchPath } from "react-router";
import { HashRouter as Router, Switch, Route, useLocation } from "react-router-dom";

import { createAppStore, StoreProvider } from "./domain/store";
import { useStoreActions, useStoreState } from "./domain/types";
import { AppScreen, Program } from "./Types";
import { pathTo } from "./Navigator";

import "./App.i18n";

// locals
import "./App.css";

import { CURRENT_ENVIRONMENT } from "./Environment";

import { AppHeader } from "./components/AppHeader";
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
import { Screen as SettingsScreen } from "./screens/Settings";
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
      <Button disabled={pending} fill text={t("Reconnect")} icon={IconNames.REFRESH} onClick={onConnectClick} />
      <AnchorButton
        href={pathTo("/screens/settings")}
        icon={IconNames.COG}
        text={t("Change settings")}
        intent={Intent.PRIMARY}
      />
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

interface AppContentProps {
  provisioned: boolean;
  screens: AppScreen<any>[];
  currentScreen: AppScreen<any>;
}

const AppContent: React.FC<AppContentProps> = ({ provisioned, screens, currentScreen }) => {
  const content = provisioned ? (
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
  ) : (
    <div className="AppContentDocument">
      <HotkeysProvider>
        <SettingsScreen navigator={navigator} />
      </HotkeysProvider>
    </div>
  );
  return (
    <div className="AppContent">
      {content}
    </div>
  );
};

interface AppLoadedProps {
  program: Program;
  running: boolean;
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
  return (
    <>
      <AppHeader program={program} running={running} screens={Screens} currentScreen={currentScreen} />
      <AppContent provisioned={!!program.path && running} screens={Screens} currentScreen={currentScreen} />
    </>
  );
};

export const AppMainContent = () => {
  const inited = useStoreState((state) => state.inited);
  const running = useStoreState((state) => state.running);
  const program = useStoreState((state) => state.program);
  let content;
  console.debug("AppMainContent", { inited });
  if (inited) {
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
  const store = createAppStore(CURRENT_ENVIRONMENT);
  return (
    <StoreProvider store={store}>
      <AppMain />
    </StoreProvider>
  );
}
