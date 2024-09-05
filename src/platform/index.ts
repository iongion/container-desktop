export function getWindowsPipePath(scope: string) {
  return `\\\\.\\pipe\\${scope}`;
}
