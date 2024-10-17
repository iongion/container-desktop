import { type Environment, Environments } from "@/env/Types";

export const PROJECT_VERSION = import.meta.env.PROJECT_VERSION || "1.0.0";
export const PROJECT_NAME = import.meta.env.PROJECT_NAME;
export const CURRENT_ENVIRONMENT: Environments = (import.meta.env.ENVIRONMENT as any) || Environments.DEVELOPMENT;
export const CONTAINER_DOCS_URL = "https://docs.podman.io/en/latest/index.html";
export const CONTAINER_DOCS_EXAMPLE_CODE = "{program} run -dt -p 8889:80/tcp docker.io/library/httpd:latest";
export const PROGRAM_DOCKER = {
  name: "docker",
  title: "Docker",
  homepage: "https://docker.io",
};
export const PROGRAM_PODMAN = {
  name: "podman",
  title: "Podman",
  homepage: "https://podman.io",
};
export const PROGRAM_DEFAULT = "podman";
export const POLL_RATE_DEFAULT = 2000;
export const API_BASE_URL_DEFAULT = "http://d/v3.0.0/libpod";
export const ENV_DEFAULT: Pick<Environment, "settings" | "features"> = {
  settings: {
    api: {
      baseUrl: API_BASE_URL_DEFAULT,
    },
    poll: {
      rate: POLL_RATE_DEFAULT,
    },
  },
  features: {
    polling: {
      enabled: true,
    },
  },
};

export const EnvironmentsMap: { [key in Environments]: Environment } = {
  [Environments.DEVELOPMENT]: {
    name: Environments.DEVELOPMENT,
    ...ENV_DEFAULT,
    ...{
      features: {
        ...ENV_DEFAULT.features,
        polling: {
          enabled: false,
        },
      },
    },
  },
  [Environments.PRODUCTION]: {
    name: Environments.PRODUCTION,
    ...ENV_DEFAULT,
    ...{
      features: {
        ...ENV_DEFAULT.features,
      },
    },
  },
};

const CurrentEnvironment = EnvironmentsMap[CURRENT_ENVIRONMENT];

export const LOGGING_LEVELS = ["error", "warn", "info", "debug"];

export const API = CurrentEnvironment.settings.api.baseUrl;

export default CurrentEnvironment;
