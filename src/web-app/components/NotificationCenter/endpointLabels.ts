// Map common Docker/Podman engine REST routes to human-friendly labels, so the Activity
// log reads as documentation ("List containers") next to the raw call ("GET /containers/json").
// Pure + order-sensitive (specific patterns before generic ones); unit-tested.

import i18n from "@/i18n";

interface EndpointRule {
  re: RegExp;
  methods?: string[];
  label: string;
}

const RULES: EndpointRule[] = [
  { re: /_ping$/, label: i18n.t("Ping engine") },
  { re: /\/version$/, label: i18n.t("Engine version") },
  { re: /\/info$/, label: i18n.t("Engine info") },
  { re: /\/events\b/, label: i18n.t("Stream events") },
  { re: /\/system\/df/, label: i18n.t("Disk usage") },
  // containers
  { re: /\/containers\/create/, methods: ["POST"], label: i18n.t("Create container") },
  { re: /\/containers\/prune/, label: i18n.t("Prune containers") },
  { re: /\/containers\/json/, label: i18n.t("List containers") },
  { re: /\/containers\/[^/]+\/start/, label: i18n.t("Start container") },
  { re: /\/containers\/[^/]+\/stop/, label: i18n.t("Stop container") },
  { re: /\/containers\/[^/]+\/restart/, label: i18n.t("Restart container") },
  { re: /\/containers\/[^/]+\/kill/, label: i18n.t("Kill container") },
  { re: /\/containers\/[^/]+\/pause/, label: i18n.t("Pause container") },
  { re: /\/containers\/[^/]+\/unpause/, label: i18n.t("Unpause container") },
  { re: /\/containers\/[^/]+\/logs/, label: i18n.t("Container logs") },
  { re: /\/containers\/[^/]+\/stats/, label: i18n.t("Container stats") },
  { re: /\/containers\/[^/]+\/top/, label: i18n.t("Container processes") },
  { re: /\/containers\/[^/]+\/exec/, label: i18n.t("Exec in container") },
  { re: /\/containers\/[^/]+\/json/, label: i18n.t("Inspect container") },
  { re: /\/containers\/[^/]+$/, methods: ["DELETE"], label: i18n.t("Remove container") },
  // images
  { re: /\/images\/create/, label: i18n.t("Pull image") },
  { re: /\/images\/prune/, label: i18n.t("Prune images") },
  { re: /\/images\/search/, label: i18n.t("Search images") },
  { re: /\/images\/json/, label: i18n.t("List images") },
  { re: /\/images\/[^/]+\/history/, label: i18n.t("Image history") },
  { re: /\/images\/[^/]+\/push/, label: i18n.t("Push image") },
  { re: /\/images\/[^/]+\/tag/, label: i18n.t("Tag image") },
  { re: /\/images\/[^/]+\/json/, label: i18n.t("Inspect image") },
  { re: /\/images\/[^/]+$/, methods: ["DELETE"], label: i18n.t("Remove image") },
  { re: /\/build\b/, label: i18n.t("Build image") },
  // networks
  { re: /\/networks\/create/, label: i18n.t("Create network") },
  { re: /\/networks\/[^/]+$/, methods: ["DELETE"], label: i18n.t("Remove network") },
  { re: /\/networks\/[^/]+/, label: i18n.t("Inspect network") },
  { re: /\/networks/, label: i18n.t("List networks") },
  // volumes
  { re: /\/volumes\/create/, label: i18n.t("Create volume") },
  { re: /\/volumes\/[^/]+$/, methods: ["DELETE"], label: i18n.t("Remove volume") },
  { re: /\/volumes\/[^/]+/, label: i18n.t("Inspect volume") },
  { re: /\/volumes/, label: i18n.t("List volumes") },
  // secrets / pods (podman) / misc
  { re: /\/secrets\/create/, label: i18n.t("Create secret") },
  { re: /\/secrets/, label: i18n.t("List secrets") },
  { re: /\/pods\/json/, label: i18n.t("List pods") },
  { re: /\/pods\//, label: i18n.t("Pod operation") },
  { re: /\/exec\/[^/]+\/start/, label: i18n.t("Start exec") },
];

export function friendlyEndpoint(method: string, url: string): string | undefined {
  const path = `${url || ""}`.split("?")[0];
  const upper = `${method || ""}`.toUpperCase();
  for (const rule of RULES) {
    if (rule.methods && !rule.methods.includes(upper)) {
      continue;
    }
    if (rule.re.test(path)) {
      return rule.label;
    }
  }
  return undefined;
}
