/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NODE_ENV: "production" | "development";
  readonly ENVIRONMENT: "production" | "development";
  readonly PROJECT_VERSION: string;
  readonly PROJECT_NAME: string;
  readonly PROJECT_CODE: string;
  readonly PROJECT_TITLE: string;
  readonly PROJECT_DESCRIPTION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
