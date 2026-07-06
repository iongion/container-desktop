import { HotkeysProvider, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { DEFAULT_THEME } from "@/web-app/App.config";
import "@/web-app/App.css";
import "@/web-app/App.i18n";
import { createLogger } from "@/platform/logger";
import { AppBootstrapPhase, AppTheme } from "@/web-app/App.types";
import { bootTimeline } from "@/web-app/bootTimeline";
import AppErrorBoundary from "@/web-app/components/AppErrorBoundary";
import { AppFooter } from "@/web-app/components/AppFooter";
import { AppHeader } from "@/web-app/components/AppHeader";
import { AppLoading } from "@/web-app/components/AppLoading";
import { AppSidebar } from "@/web-app/components/AppSidebar";
import { FindHost } from "@/web-app/components/Find/FindHost";
import { NotificationCenterHost } from "@/web-app/components/NotificationCenter/NotificationCenterHost";
import { ProvisioningWizardHost } from "@/web-app/components/ProvisioningWizard/ProvisioningWizardHost";
import { resolveEngineTheme } from "@/web-app/domain/engineTheme";
import { CURRENT_ENVIRONMENT } from "@/web-app/Environment";
import { waitForPreload } from "@/web-app/Native";
import { pathTo } from "@/web-app/Navigator";
import { Screen as AIAssistantScreen } from "@/web-app/screens/AI/AssistantScreen";
import { Screen as AIGeneratorScreen } from "@/web-app/screens/AI/GeneratorScreen";
import { Screen as BuildScreen } from "@/web-app/screens/Build/ManageScreen";
import { Screen as ConnectionInfoScreen } from "@/web-app/screens/Connections/ConnectionInfoScreen";
import { Screen as ConnectionsScreen } from "@/web-app/screens/Connections/ManageScreen";
import { Screen as SystemInfoScreen } from "@/web-app/screens/Connections/SystemInfoScreen";
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
import { Screen as UserSettingsScreen } from "@/web-app/screens/Settings/UserSettingsScreen";
import { Screen as SwarmScreen } from "@/web-app/screens/Swarm/ManageScreen";
import { Screen as SwarmInspectScreen } from "@/web-app/screens/Swarm/SwarmInspectScreen";
import { Screen as TroubleshootScreen } from "@/web-app/screens/Troubleshoot/Troubleshoot";
import { Screen as VolumeInspectScreen } from "@/web-app/screens/Volume/InspectScreen";
import { Screen as VolumesScreen } from "@/web-app/screens/Volume/ManageScreen";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

const logger = createLogger("web.app");

const Screens = [
  DashboardScreen,
  AIAssistantScreen,
  AIGeneratorScreen,
  ContainersScreen,
  ContainerLogsScreen,
  ContainerInspectScreen,
  ContainerStatsScreen,
  ContainerProcessesScreen,
  ContainerGenerateKubeScreen,
  ContainerTerminalScreen,
  ImagesScreen,
  BuildScreen,
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
  SwarmScreen,
  SwarmInspectScreen,
  NetworksScreen,
  NetworkInspectScreen,
  SecretsScreen,
  SecretInspectScreen,
  VolumesScreen,
  VolumeInspectScreen,
  UserSettingsScreen,
  ConnectionsScreen,
  ConnectionInfoScreen,
  SystemInfoScreen,
  TroubleshootScreen,
];

// TanStack Router (hash history, explicit/manual route tree — no plugin/codegen, no data-loaders).
// Each Screen contributes one route under the shared chrome layout (rootRoute). Screens load their own
// data via their query hooks on mount — routes are pure navigation.

const rootRoute = createRootRoute({
  component: AppLayout,
  notFoundComponent: NotFoundScreen,
});

// AI is always on, so there is no access gate — every screen (incl. the AI ones) is reachable. This
// just wraps the active screen + footer in the viewport.
function ScreenViewport({ Screen }: { Screen: (typeof Screens)[number] }) {
  return (
    <div className="AppScreenViewport">
      <Screen navigator={window.navigator} />
      <AppFooter />
    </div>
  );
}

const screenRoutes = Screens.map((Screen) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: Screen.Route.Path,
    component: () => <ScreenViewport Screen={Screen} />,
  }),
);

rootRoute.addChildren(screenRoutes);

const router = createRouter({
  routeTree: rootRoute,
  history: createHashHistory(),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Resolve the active Screen by matching the matched route's path pattern back to its Screen declaration.
function useCurrentScreen() {
  const fullPath = useRouterState({ select: (state) => state.matches.at(-1)?.fullPath });
  return Screens.find((screen) => screen.Route.Path === fullPath);
}

function normalizeAppTheme(theme: string | undefined): AppTheme {
  return theme === "light" || theme === AppTheme.LIGHT ? AppTheme.LIGHT : AppTheme.DARK;
}

function NotFoundScreen() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <NonIdealState
      icon={IconNames.WARNING_SIGN}
      title={t("There is no such screen {{pathname}}", { pathname })}
      description={
        <>
          <p>{t("The screen was not found")}</p>
          <a href={pathTo("/")}>{t("Go to dashboard")}</a>
        </>
      }
    />
  );
}

function AppBootstrapReadySignal() {
  const phase = useAppStore((state) => state.phase);
  const signaledRef = useRef(false);

  useEffect(() => {
    if (phase !== AppBootstrapPhase.STARTING || signaledRef.current) {
      return;
    }
    let cancelled = false;
    signaledRef.current = true;
    waitForPreload()
      .then(() => {
        if (cancelled) {
          return;
        }
        window.MessageBus.send("notify", { message: "ready", payload: useAppStore.getState().userSettings });
        bootTimeline.mark("notify-ready-sent");
      })
      .catch((error: any) => {
        signaledRef.current = false;
        logger.error("Unable to notify main window readiness", error);
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  return null;
}

// Root layout route: the persistent chrome (header + sidebar + footer) around the routed <Outlet />.
// The bootstrap phase gates what the document area shows — the routed screen only when READY.
function AppLayout() {
  const { t } = useTranslation();
  const phase = useAppStore((state) => state.phase);
  const running = useAppStore((state) => state.running);
  const provisioned = useAppStore((state) => state.provisioned);
  const osType = useAppStore((state) => state.osType);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const startApplication = useAppStore((state) => state.startApplication);
  const program = currentConnector?.settings?.program;
  const currentScreen = useCurrentScreen();
  const ready = phase === AppBootstrapPhase.READY;

  const onReconnect = useCallback(() => {
    startApplication();
  }, [startApplication]);

  // De-gated shell: once bootstrap is past the splash, routes ALWAYS render — per-connection status (failed /
  // reconnecting / disconnected) shows inline. The full-screen takeover is gone, so every sidebar link works.
  const booting = phase === AppBootstrapPhase.INITIAL || phase === AppBootstrapPhase.STARTING;

  // Landing: when bootstrap finishes with nothing connected, route to the connection manager so the user can
  // connect/fix an engine; once the first engine comes up there, advance into the workspace (Dashboard). Both
  // are one-shot and the advance only fires from the landing screen, so manual navigation and transient
  // mid-session drops are never hijacked.
  const landedRef = useRef(false);
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (!landedRef.current) {
      landedRef.current = true;
      prevRunningRef.current = !!running;
      if (!running) {
        router.navigate({ to: ConnectionsScreen.Route.Path });
      }
      return;
    }
    if (running && !prevRunningRef.current && currentScreen?.Route?.Path === ConnectionsScreen.Route.Path) {
      router.navigate({ to: DashboardScreen.Route.Path });
    }
    prevRunningRef.current = !!running;
  }, [ready, running, currentScreen]);

  const content: React.ReactNode = booting ? (
    <div className="AppScreenViewport">
      <AppLoading />
      <AppFooter variant="bootstrap" />
    </div>
  ) : (
    <Outlet />
  );
  const sidebarCurrentScreen = currentScreen ?? DashboardScreen;

  return (
    <>
      <AppBootstrapReadySignal />
      {/* The non-blocking wizard gets its own boundary (the app's standard one) so a crash inside it is
          contained + recoverable and can never take down the app chrome — AppHeader is a sibling outside it. */}
      <AppErrorBoundary
        onReconnect={onReconnect}
        reconnect={t("Try to recover")}
        title={t("An uncaught error showed up")}
        suggestion={t("It could be very helpful if you can check the logs of the app and report back")}
      >
        <ProvisioningWizardHost />
      </AppErrorBoundary>
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
        <div className="AppContent">
          {booting || currentScreen ? (
            <AppSidebar disabled={!ready} screens={Screens} currentScreen={sidebarCurrentScreen} />
          ) : null}
          <div className="AppContentDocument">
            {content}
            <FindHost />
            <NotificationCenterHost />
          </div>
        </div>
      </AppErrorBoundary>
    </>
  );
}

export function AppMainScreen() {
  const startRef = useRef(false);
  const phase = useAppStore((state) => state.phase);
  const native = useAppStore((state) => state.native);
  const running = useAppStore((state) => state.running);
  const provisioned = useAppStore((state) => state.provisioned);
  const osType = useAppStore((state) => state.osType);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const nextConnection = useAppStore((state) => state.nextConnection);
  const theme = useAppStore((state) => normalizeAppTheme(state.userSettings.theme || DEFAULT_THEME));
  const engineTheme = useAppStore((state) => state.userSettings.engineTheme);
  const connectors = useAppStore((state) => state.connectors);
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const font = useAppStore((state) => state.userSettings.font);
  const initialize = useAppStore((state) => state.initialize);
  const startApplication = useAppStore((state) => state.startApplication);

  const engine = resolveEngineTheme({ preference: engineTheme, activeRuntime, connectors, connections });
  const host = nextConnection?.host || currentConnector?.host || undefined;

  useEffect(() => {
    if (startRef.current) {
      return;
    }
    startRef.current = true;
    initialize().then(() => startApplication());
  }, [initialize, startApplication]);

  useEffect(() => {
    bootTimeline.mark("react-first-commit");
  }, []);

  // Apply the user's monospace font override as CSS variables (removing them falls back to the
  // bundled JetBrains Mono / built-in sizing). Consumed by code/pre/.bp6-code and the terminal.
  useEffect(() => {
    const root = document.documentElement;
    if (font?.family) {
      root.style.setProperty("--monospace-font", `"${font.family}", var(--monospace-font-embedded)`);
    } else {
      root.style.removeProperty("--monospace-font");
    }
    if (font?.size) {
      root.style.setProperty("--monospace-font-size", `${font.size}px`);
    } else {
      root.style.removeProperty("--monospace-font-size");
    }
    if (font?.weight) {
      root.style.setProperty("--monospace-font-weight", `${font.weight}`);
    } else {
      root.style.removeProperty("--monospace-font-weight");
    }
  }, [font?.family, font?.size, font?.weight]);

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
        <body className={theme} data-engine={engine} />
      </Helmet>
      <RouterProvider router={router} />
    </div>
  );
}

export const App: React.FC = () => {
  return (
    <HotkeysProvider>
      <AppMainScreen />
    </HotkeysProvider>
  );
};
