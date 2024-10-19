import { HotkeysProvider, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { matchPath } from "react-router";
import { Route, HashRouter as Router, Switch, useLocation } from "react-router-dom";

import { ContainerEngine, type OperatingSystem, type Program } from "@/env/Types";
import { DEFAULT_THEME } from "@/web-app/App.config";
import "@/web-app/App.css";
import "@/web-app/App.i18n";
import { CURRENT_ENVIRONMENT } from "@/web-app/Environment";
import { pathTo } from "@/web-app/Navigator";
import AppErrorBoundary from "@/web-app/components/AppErrorBoundary";
import { AppFooter } from "@/web-app/components/AppFooter";
import { AppHeader } from "@/web-app/components/AppHeader";
import { AppLoading } from "@/web-app/components/AppLoading";
import { AppSidebar } from "@/web-app/components/AppSidebar";
import { StoreProvider } from "@/web-app/domain/store";
import { AppBootstrapPhase, type AppStore, useStoreActions, useStoreState } from "@/web-app/domain/types";
import { Screen as ContainerGenerateKubeScreen } from "@/web-app/screens/Container/GenerateKubeScreen";
import { Screen as ContainerInspectScreen } from "@/web-app/screens/Container/InspectScreen";
import { Screen as ContainerLogsScreen } from "@/web-app/screens/Container/LogsScreen";
import { Screen as ContainersScreen } from "@/web-app/screens/Container/ManageScreen";
import { Screen as ContainerProcessesScreen } from "@/web-app/screens/Container/ProcessesScreen";
import { Screen as ContainerStatsScreen } from "@/web-app/screens/Container/StatsScreen";
import { Screen as ContainerTerminalScreen } from "@/web-app/screens/Container/TerminalScreen";
import { Screen as DashboardScreen } from "@/web-app/screens/Dashboard";
import { Screen as ImageInspectScreen } from "@/web-app/screens/Image/InspectScreen";
import { Screen as ImageLayersScreen } from "@/web-app/screens/Image/LayersScreen";
import { Screen as ImagesScreen } from "@/web-app/screens/Image/ManageScreen";
import { Screen as ImageSecurityScreen } from "@/web-app/screens/Image/SecurityScreen";
import { Screen as MachineInspectScreen } from "@/web-app/screens/Machine/InspectScreen";
import { Screen as MachinesScreen } from "@/web-app/screens/Machine/ManageScreen";
import { Screen as NetworkInspectScreen } from "@/web-app/screens/Network/InspectScreen";
import { Screen as NetworksScreen } from "@/web-app/screens/Network/ManageScreen";
import { Screen as PodGenerateKubeScreen } from "@/web-app/screens/Pod/GenerateKubeScreen";
import { Screen as PodInspectScreen } from "@/web-app/screens/Pod/InspectScreen";
import { Screen as PodLogsScreen } from "@/web-app/screens/Pod/LogsScreen";
import { Screen as PodsScreen } from "@/web-app/screens/Pod/ManageScreen";
import { Screen as PodProcessesScreen } from "@/web-app/screens/Pod/ProcessesScreen";
import { Screen as RegistriesScreen } from "@/web-app/screens/Registry/ManageScreen";
import { Screen as SecretInspectScreen } from "@/web-app/screens/Secret/InspectScreen";
import { Screen as SecretsScreen } from "@/web-app/screens/Secret/ManageScreen";
import { Screen as ConnectionInfoScreen } from "@/web-app/screens/Settings/ConnectionInfoScreen";
import { Screen as SystemInfoScreen } from "@/web-app/screens/Settings/SystemInfoScreen";
import { Screen as UserSettingsScreen } from "@/web-app/screens/Settings/UserSettingsScreen";
import { Screen as TroubleshootScreen } from "@/web-app/screens/Troubleshoot/Troubleshoot";
import { Screen as VolumeInspectScreen } from "@/web-app/screens/Volume/InspectScreen";
import { Screen as VolumesScreen } from "@/web-app/screens/Volume/ManageScreen";

const Screens = [
  DashboardScreen,
  ContainersScreen,
  ContainerLogsScreen,
  ContainerInspectScreen,
  ContainerStatsScreen,
  ContainerProcessesScreen,
  ContainerGenerateKubeScreen,
  ContainerTerminalScreen,
  ImagesScreen,
  ImageLayersScreen,
  ImageInspectScreen,
  ImageSecurityScreen,
  RegistriesScreen,
  PodsScreen,
  PodLogsScreen,
  PodInspectScreen,
  PodProcessesScreen,
  PodGenerateKubeScreen,
  MachinesScreen,
  MachineInspectScreen,
  NetworksScreen,
  NetworkInspectScreen,
  SecretsScreen,
  SecretInspectScreen,
  VolumesScreen,
  VolumeInspectScreen,
  UserSettingsScreen,
  ConnectionInfoScreen,
  SystemInfoScreen,
  TroubleshootScreen,
];

interface AppContentProps {
  phase: AppBootstrapPhase;
}
export const AppContent: React.FC<AppContentProps> = ({ phase }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const ready = phase === AppBootstrapPhase.READY;
  const currentScreen = Screens.find((screen) =>
    matchPath(location.pathname, {
      path: screen.Route.Path,
      exact: true,
      strict: true,
    }),
  );
  const content = useMemo(() => {
    let content: React.ReactNode;
    if (ready) {
      content = (
        <Switch>
          {Screens.map((Screen) => {
            return (
              <Route path={Screen.Route.Path} key={Screen.ID} exact>
                <div className="AppScreenViewport">
                  <Screen navigator={navigator} />
                  <AppFooter />
                </div>
              </Route>
            );
          })}
        </Switch>
      );
    } else if (phase === AppBootstrapPhase.FAILED) {
      content = (
        <div className="AppScreenViewport">
          <UserSettingsScreen navigator={navigator} />
          <AppFooter />
        </div>
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
            <a href={pathTo("/")}>{t("Go to dashboard")}</a>
          </>
        }
      />
    );
  }

  return (
    <div className="AppContent">
      {phase === "starting" ? null : <AppSidebar disabled={!ready} screens={Screens} currentScreen={currentScreen} />}
      <div className="AppContentDocument">{content}</div>
    </div>
  );
};

interface AppMainScreenContentProps {
  osType: OperatingSystem;
  phase: AppBootstrapPhase;
  program?: Program;
  running?: boolean;
  provisioned?: boolean;
}
export const AppMainScreenContent: React.FC<AppMainScreenContentProps> = ({
  osType,
  program,
  phase,
  provisioned,
  running,
}) => {
  const startApplication = useStoreActions((actions) => actions.startApplication);
  const { t } = useTranslation();
  const location = useLocation();

  const onReconnect = useCallback(() => {
    startApplication();
  }, [startApplication]);

  const currentScreen = Screens.find((screen) =>
    matchPath(location.pathname, {
      path: screen.Route.Path,
      exact: true,
      strict: true,
    }),
  );

  return (
    <>
      <AppHeader
        osType={osType}
        program={program}
        provisioned={provisioned}
        running={running}
        screens={Screens}
        currentScreen={currentScreen}
      />
      <AppErrorBoundary
        onReconnect={onReconnect}
        reconnect={t("Try to recover")}
        title={t("An uncaught error showed up")}
        suggestion={t("It could be very helpful if you can check the logs of the app and report back")}
      >
        <AppContent phase={phase} />
      </AppErrorBoundary>
    </>
  );
};

export function AppMainScreen() {
  const startRef = useRef(false);
  const phase = useStoreState((state) => state.phase);
  const native = useStoreState((state) => state.native);
  const running = useStoreState((state) => state.running);
  const provisioned = useStoreState((state) => state.provisioned);
  const osType = useStoreState((state) => state.osType);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const nextConnection = useStoreState((state) => state.nextConnection);
  const theme = useStoreState((state) => state.userSettings.theme || DEFAULT_THEME);
  const startApplication = useStoreActions((actions) => actions.startApplication);
  const program = currentConnector?.settings?.program;

  const engine = nextConnection?.engine || currentConnector?.engine || ContainerEngine.PODMAN;
  const host = nextConnection?.host || currentConnector?.host || undefined;

  useEffect(() => {
    if (startRef.current) {
      console.debug("Initial start skipped - already started");
    } else {
      console.debug("Initial start has been triggered");
      startRef.current = true;
      startApplication();
    }
  }, [startApplication]);

  return (
    <div className="App">
      <Helmet>
        <html
          data-theme={theme}
          data-os={osType}
          data-engine={engine}
          data-host={host}
          data-environment={CURRENT_ENVIRONMENT}
          data-native={native ? "yes" : "no"}
          data-phase={phase}
          data-running={running ? "yes" : "no"}
          data-provisioned={provisioned ? "yes" : "no"}
          lang="en"
        />
        <body className={theme === "dark" ? `bp5-${theme}` : theme} data-engine={engine} />
      </Helmet>
      <Router>
        <AppMainScreenContent
          osType={osType}
          phase={phase}
          provisioned={provisioned}
          running={running}
          program={program}
        />
      </Router>
    </div>
  );
}

export interface AppProps {
  store: AppStore;
}

export const App: React.FC<AppProps> = ({ store }) => {
  return (
    <StoreProvider store={store}>
      <HotkeysProvider>
        <AppMainScreen />
      </HotkeysProvider>
    </StoreProvider>
  );
};
