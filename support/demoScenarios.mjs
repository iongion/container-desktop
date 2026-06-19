// The set of tutorial pseudo-videos rendered on the website, one per engine theme. Each is recorded
// by support/demoReplay.mjs (rrweb) booting the app with CONTAINER_DESKTOP_MOCK=<engine> and writes
// a replay JSON + poster PNG that the site swaps with the color swatch (see website-src/_data/site.js).
//
// - podman: the original hand-tuned walkthrough (kept verbatim, with its existing asset paths).
// - docker / unified: derived tours that share podman's timing but use generic, engine-agnostic
//   selectors (first matching row) so they work against any fixture set; docker drops the
//   Podman-only Pods chapter, unified keeps it (the merged view surfaces pods from podman).

import { demoScenario } from "./demoScenario.mjs";

const { steps: _baseSteps, ...baseConfig } = demoScenario;

// Engine-agnostic walkthrough using first-row selectors so it is fixture-independent.
function buildTourSteps({
  introText,
  pods,
  connectionRowId,
  actionText = "using the action menu Docker users expect, without giving up Podman",
  connectionsText = "managing local, SSH, WSL and LIMA connections for Podman and Docker from one place",
}) {
  const steps = [
    {
      keyword: "Given",
      label: "Auto-detect",
      text: introText,
      actions: [
        { type: "waitReady" },
        { type: "waitFor", selector: '[data-screen="dashboard"]' },
        { type: "hover", selector: 'a[data-screen="dashboard"]', duration: 900 },
        { type: "move", x: 534, y: 280, duration: 1200, hold: 600 },
      ],
      hold: 6000,
    },
    {
      keyword: "When",
      label: "Real workloads",
      text: "browsing a realistic inventory — running, paused and exited containers",
      actions: [
        {
          type: "click",
          selector: 'a[data-screen="containers"]',
          waitFor: "[data-container]",
          minCount: 1,
          duration: 1100,
          resultMs: 600,
        },
        { type: "sidebar", expanded: false, hold: 300 },
        { type: "hover", selector: "[data-container]", duration: 1300, hold: 700 },
      ],
      hold: 7000,
    },
    {
      keyword: "And",
      label: "Fast actions",
      text: actionText,
      actions: [{ type: "pre", pre: [{ action: "openRowActions", rowSelector: "[data-container]" }] }],
      hold: 6000,
    },
    {
      keyword: "Then",
      label: "Deep inspect",
      text: "inspecting container configuration like an operator, not a marketing dashboard",
      actions: [
        { type: "key", key: "Escape", hold: 300 },
        { type: "hover", selector: "[data-container]", duration: 1000, hold: 400 },
        {
          type: "navigate",
          route: "/screens/container/$containerId/inspect",
          resolve: {
            containerId: { route: "/screens/containers", selector: "[data-container]", attr: "data-container" },
          },
          waitFor: '[data-table="container.inspect"]',
        },
      ],
      hold: 7500,
    },
    {
      keyword: "When",
      label: "Security",
      text: "checking image vulnerabilities from the same desktop instead of jumping tools",
      actions: [
        { type: "click", selector: 'a[data-screen="images"]', waitFor: "[data-image]", minCount: 1, duration: 1100 },
        { type: "hover", selector: "[data-image]", duration: 1200, hold: 500 },
        {
          type: "navigate",
          route: "/screens/image/$imageId/security",
          resolve: { imageId: { route: "/screens/images", selector: "[data-image]", attr: "data-image" } },
          waitFor: '[data-table="image.scanning.report"] tbody tr[data-severity]',
          minCount: 1,
        },
      ],
      hold: 7500,
    },
  ];
  if (pods) {
    steps.push({
      keyword: "And",
      label: "Podman-native",
      text: "showing pods for production-style stacks that Docker-first tools usually flatten away",
      actions: [
        { type: "click", selector: 'a[data-screen="pods"]', waitFor: "[data-pod]", minCount: 1, duration: 1100 },
        { type: "hover", selector: "[data-pod]", duration: 1200, hold: 600 },
      ],
      hold: 8000,
    });
  }
  steps.push({
    keyword: "Then",
    label: "Any endpoint",
    text: connectionsText,
    actions: [
      {
        type: "navigate",
        route: "/screens/connections/manage",
        waitFor: `tr[data-connection-id="${connectionRowId}"][data-connection-is-connected="yes"]`,
      },
      { type: "wait", ms: 250 },
    ],
    hold: 8000,
  });
  return steps;
}

// podman: keep the original, polished scenario verbatim; normalize its output/poster to the
// podman|docker|unified naming used everywhere else.
const podman = {
  ...demoScenario,
  output: "website-src/static/replays/podman.json",
  poster: "website-src/static/videos/podman.png",
};

const docker = {
  ...baseConfig,
  id: "container-desktop-demo-docker",
  title: "Container Desktop — Docker walkthrough",
  engine: "docker",
  output: "website-src/static/replays/docker.json",
  poster: "website-src/static/videos/docker.png",
  steps: buildTourSteps({
    introText: "Container Desktop starts cleanly and auto-detects the mock Docker engine",
    pods: false,
    connectionRowId: "mock.docker.system",
  }),
};

const unified = {
  ...baseConfig,
  id: "container-desktop-demo-unified",
  title: "Container Desktop — merged Podman + Docker + Apple Container walkthrough",
  engine: "unified",
  output: "website-src/static/replays/unified.json",
  poster: "website-src/static/videos/unified.png",
  steps: buildTourSteps({
    introText: "Container Desktop starts cleanly and auto-detects the mock Podman, Docker, and Apple Container engines",
    pods: true,
    connectionRowId: "mock.podman.system",
    actionText: "using familiar actions across Podman and Docker-compatible workloads",
    connectionsText: "managing local, SSH, WSL, LIMA, and Apple native endpoints from one place",
  }),
};

export const demoScenarios = [podman, docker, unified];
