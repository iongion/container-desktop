/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NODE_ENV: "production" | "development";
  readonly ENVIRONMENT: "production" | "development";
  readonly PROJECT_VERSION: string;
  readonly PROJECT_NAME: string;
  readonly PROJECT_CODE: string;
  readonly PROJECT_TITLE: string;
  readonly PROJECT_DESCRIPTION: string;
  readonly ONLINE_API: string;
  readonly HOST: string;
  readonly PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
