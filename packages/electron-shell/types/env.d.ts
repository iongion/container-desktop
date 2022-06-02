interface ImportMeta {
  env: {
    APP_ENV: string;
    PROJECT_VERSION: string;
  };
}

// temporary alternative
declare module imports {
  const meta: ImportMeta;
}
