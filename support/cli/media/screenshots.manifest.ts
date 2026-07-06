export const SCREENSHOT_VIEWPORT = { width: 1068, height: 718 };

// "unified" boots all system engines connected (CONTAINER_DESKTOP_MOCK=unified) → the merged
// workspace; per-item `*ByEngine` maps below carry selectors where they differ from podman.
export const SCREENSHOT_ENGINES = ["podman", "docker", "unified"];

export const STALE_FLAT_SCREENSHOTS = [
  "000-CrossPlatform.png",
  "000-Overview.png",
  "001-Dashboard.png",
  "003-ContainerActions.png",
  "003-ContainerInspect.png",
  "006-ImageActions.png",
  "011-MachineTerminal.png",
  "013-SecretsInspect.png",
  "015-VolumeActions.png",
  "ConnectionManager.png",
  "DockerContainers.png",
  "ImageSecurity.png",
  "Images.png",
  "NetworkCreate.png",
  "PodmanContainers.png",
  "PodmanPods.png",
  "SystemInfo.png",
];

export const screenshotManifest = [
  {
    file: "000-Overview.png",
    route: "/",
    waitFor: '[data-screen="dashboard"]',
  },
  {
    file: "001-Dashboard.png",
    route: "/",
    waitFor: '[data-screen="dashboard"]',
  },
  {
    file: "Containers.png",
    route: "/screens/containers",
    waitFor: "[data-container]",
    minCount: 9,
  },
  {
    file: "Images.png",
    route: "/screens/images",
    waitFor: "[data-image]",
    // unified merges all engines' images, so it has at least docker/container's count.
    minCountByEngine: { podman: 4, docker: 5, unified: 5 },
  },
  {
    // The Build Studio driven to a completed build so the timeline fills. The studio seeds a starter
    // Containerfile and defaults to a native connection, so "Build image" is enabled on load; the runBuild
    // pre-action clicks it and buildFixtures replays engine-shaped output to a succeeded run (Timeline is the
    // default tab, so no image-history mock is needed). Build runs on all native engines → captured for each.
    file: "Build.png",
    route: "/screens/build",
    pre: [{ action: "runBuild" }],
    waitFor: '[data-region="run"][data-build-status="succeeded"]',
    settleMs: 1200,
  },
  {
    file: "Pods.png",
    route: "/screens/pods",
    waitForByEngine: {
      podman: "[data-pod]",
      docker: '[data-screen="pods"]',
      // Pods are Podman-only; in the merged view they come from the podman connection.
      unified: "[data-pod]",
    },
    minCountByEngine: { podman: 12, docker: 1, unified: 12 },
  },
  {
    file: "UserSettings.png",
    route: "/screens/settings/user-settings?category=network",
    waitFor: '[data-screen="settings-settings"] [data-form="network"]',
  },
  {
    // The AI assistant driven into a rendered generative-UI card. Same prompt across engines so the shot is
    // deterministic; "running containers" resolves to the read-only listContainers typed-tool card (no approval).
    file: "AIAssistant.png",
    route: "/screens/ai/assistant",
    waitFor: '[data-screen="ai.assistant"] .AICard',
    pre: [{ action: "askAssistant", prompt: "Show me the running containers" }],
    settleMs: 1500,
  },
  {
    file: "SystemInfo.png",
    route: "/screens/connections/system-info",
    waitFor: '[data-screen="connections.system-info"] .CodeEditor .monaco-editor',
  },
  {
    file: "ConnectionManager.png",
    route: "/screens/connections/manage",
    waitForByEngine: {
      podman:
        'tr[data-connection-id="mock.podman.system"][data-connection-is-default="yes"][data-connection-is-current="yes"][data-connection-is-connected="yes"]',
      docker:
        'tr[data-connection-id="mock.docker.system"][data-connection-is-default="yes"][data-connection-is-current="yes"][data-connection-is-connected="yes"]',
      // Merged view: podman is the primary/default/current (is-connected tracks the current
      // connection only — see ManageScreen isConnected); all system rows are listed.
      unified:
        'tr[data-connection-id="mock.podman.system"][data-connection-is-default="yes"][data-connection-is-current="yes"][data-connection-is-connected="yes"]',
    },
  },
  {
    file: "003-ContainerInspect.png",
    route: "/screens/container/$containerId/inspect",
    resolve: { containerId: { route: "/screens/containers", selector: "[data-container]", attr: "data-container" } },
    waitFor: '[data-table="container.inspect"]',
  },
  {
    file: "003-ContainerActions.png",
    route: "/screens/containers",
    waitFor: ".bp6-portal .bp6-menu",
    pre: [{ action: "openRowActions", rowSelector: "[data-container]" }],
  },
  {
    file: "006-ImageActions.png",
    route: "/screens/images",
    waitFor: ".bp6-portal .bp6-menu",
    pre: [{ action: "openRowActions", rowSelector: "[data-image]" }],
  },
  {
    file: "Secrets.png",
    routeByEngine: {
      podman: "/screens/secrets/$secretId/inspect",
      docker: "/screens/secrets",
      // Merged list view (secrets from every connected engine).
      unified: "/screens/secrets",
    },
    resolveByEngine: {
      podman: {
        secretId: { route: "/screens/secrets", selector: '[data-table="secrets"] tbody tr code', attr: "text" },
      },
    },
    waitForByEngine: {
      podman: '[data-screen="secret.inspect"]',
      docker: '[data-screen="secrets"]',
      unified: '[data-screen="secrets"]',
    },
  },
  {
    file: "015-VolumeActions.png",
    route: "/screens/volumes",
    waitFor: ".bp6-portal .bp6-menu",
    pre: [{ action: "openRowActions", rowSelector: '[data-table="volumes"] tbody tr' }],
  },
  {
    file: "ImageSecurity.png",
    route: "/screens/image/$imageId/security",
    resolve: { imageId: { route: "/screens/images", selector: "[data-image]", attr: "data-image" } },
    waitFor: '[data-table="image.scanning.report"] tbody tr[data-severity]',
    minCount: 2,
  },
  {
    file: "NetworkCreate.png",
    route: "/screens/networks",
    waitFor: '[data-form="network.create"]',
    pre: [{ action: "openNetworkCreate" }],
  },
  {
    file: "011-MachineTerminal.png",
    route: "/screens/container/$containerId/terminal",
    resolve: { containerId: { route: "/screens/containers", selector: "[data-container]", attr: "data-container" } },
    waitFor: '[data-screen="container.terminal"]',
  },
];
