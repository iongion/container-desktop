export enum OperatingSystem {
  Browser = "browser",
  Linux = "Linux",
  Mac = "Darwin",
  Windows = "Windows_NT",
  Unknown = "unknown"
}

export function getWindowsPipePath(scope: string) {
  return `\\\\.\\pipe\\${scope}`;
}
