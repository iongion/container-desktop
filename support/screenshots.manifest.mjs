export const SCREENSHOT_VIEWPORT = { width: 1068, height: 718 };

export const SCREENSHOT_ENGINES = ["podman", "docker"];

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
    minCountByEngine: { podman: 4, docker: 5 },
  },
  {
    file: "Pods.png",
    route: "/screens/pods",
    waitForByEngine: {
      podman: "[data-pod]",
      docker: '[data-screen="pods"]',
    },
    minCountByEngine: { podman: 12, docker: 1 },
  },
  {
    file: "SystemInfo.png",
    route: "/screens/settings/system-info",
    waitFor: '[data-screen="settings.system-info"] .CodeEditor .monaco-editor',
  },
  {
    file: "ConnectionManager.png",
    route: "/screens/settings/user-settings",
    waitForByEngine: {
      podman:
        'tr[data-connection-id="mock.podman.system"][data-connection-is-default="yes"][data-connection-is-current="yes"][data-connection-is-connected="yes"]',
      docker:
        'tr[data-connection-id="mock.docker.system"][data-connection-is-default="yes"][data-connection-is-current="yes"][data-connection-is-connected="yes"]',
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
    },
    resolveByEngine: {
      podman: {
        secretId: { route: "/screens/secrets", selector: '[data-table="secrets"] tbody tr code', attr: "text" },
      },
    },
    waitForByEngine: {
      podman: '[data-screen="secret.inspect"]',
      docker: '[data-screen="secrets"]',
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
