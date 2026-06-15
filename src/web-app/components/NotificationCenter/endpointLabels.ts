// Map common Docker/Podman engine REST routes to human-friendly labels, so the Activity
// log reads as documentation ("List containers") next to the raw call ("GET /containers/json").
// Pure + order-sensitive (specific patterns before generic ones); unit-tested.

interface EndpointRule {
  re: RegExp;
  methods?: string[];
  label: string;
}

const RULES: EndpointRule[] = [
  { re: /_ping$/, label: "Ping engine" },
  { re: /\/version$/, label: "Engine version" },
  { re: /\/info$/, label: "Engine info" },
  { re: /\/events\b/, label: "Stream events" },
  { re: /\/system\/df/, label: "Disk usage" },
  // containers
  { re: /\/containers\/create/, methods: ["POST"], label: "Create container" },
  { re: /\/containers\/prune/, label: "Prune containers" },
  { re: /\/containers\/json/, label: "List containers" },
  { re: /\/containers\/[^/]+\/start/, label: "Start container" },
  { re: /\/containers\/[^/]+\/stop/, label: "Stop container" },
  { re: /\/containers\/[^/]+\/restart/, label: "Restart container" },
  { re: /\/containers\/[^/]+\/kill/, label: "Kill container" },
  { re: /\/containers\/[^/]+\/pause/, label: "Pause container" },
  { re: /\/containers\/[^/]+\/unpause/, label: "Unpause container" },
  { re: /\/containers\/[^/]+\/logs/, label: "Container logs" },
  { re: /\/containers\/[^/]+\/stats/, label: "Container stats" },
  { re: /\/containers\/[^/]+\/top/, label: "Container processes" },
  { re: /\/containers\/[^/]+\/exec/, label: "Exec in container" },
  { re: /\/containers\/[^/]+\/json/, label: "Inspect container" },
  { re: /\/containers\/[^/]+$/, methods: ["DELETE"], label: "Remove container" },
  // images
  { re: /\/images\/create/, label: "Pull image" },
  { re: /\/images\/prune/, label: "Prune images" },
  { re: /\/images\/search/, label: "Search images" },
  { re: /\/images\/json/, label: "List images" },
  { re: /\/images\/[^/]+\/history/, label: "Image history" },
  { re: /\/images\/[^/]+\/push/, label: "Push image" },
  { re: /\/images\/[^/]+\/tag/, label: "Tag image" },
  { re: /\/images\/[^/]+\/json/, label: "Inspect image" },
  { re: /\/images\/[^/]+$/, methods: ["DELETE"], label: "Remove image" },
  { re: /\/build\b/, label: "Build image" },
  // networks
  { re: /\/networks\/create/, label: "Create network" },
  { re: /\/networks\/[^/]+$/, methods: ["DELETE"], label: "Remove network" },
  { re: /\/networks\/[^/]+/, label: "Inspect network" },
  { re: /\/networks/, label: "List networks" },
  // volumes
  { re: /\/volumes\/create/, label: "Create volume" },
  { re: /\/volumes\/[^/]+$/, methods: ["DELETE"], label: "Remove volume" },
  { re: /\/volumes\/[^/]+/, label: "Inspect volume" },
  { re: /\/volumes/, label: "List volumes" },
  // secrets / pods (podman) / misc
  { re: /\/secrets\/create/, label: "Create secret" },
  { re: /\/secrets/, label: "List secrets" },
  { re: /\/pods\/json/, label: "List pods" },
  { re: /\/pods\//, label: "Pod operation" },
  { re: /\/exec\/[^/]+\/start/, label: "Start exec" },
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
